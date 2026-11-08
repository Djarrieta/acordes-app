import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../../config";
import type { TranscriptKind } from "../songs.model";

export type TranscriptWord = { text: string; startMs: number };

export type Transcript = {
  lang: string;
  kind: TranscriptKind;
  raw: string;
  words: TranscriptWord[];
};

export type CommandResult = { exitCode: number; stdout: string; stderr: string };
export type CommandRunner = (
  command: string[],
  options: { timeoutMs: number },
) => Promise<CommandResult>;

export async function runCommand(
  command: string[],
  { timeoutMs }: { timeoutMs: number },
): Promise<CommandResult> {
  const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exitCode, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

type Json3Event = {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: { utf8?: string; tOffsetMs?: number }[];
};

const NOISE = /^\[(m[uú]sica|music|aplausos|applause|risas|laughter|silencio|silence)\]$/i;

export function parseJson3(raw: string): TranscriptWord[] {
  let payload: { events?: Json3Event[] };
  try {
    payload = JSON.parse(raw) as { events?: Json3Event[] };
  } catch {
    return [];
  }
  if (!Array.isArray(payload.events)) return [];

  const segments: { text: string; startMs: number; durationMs: number }[] = [];
  for (const event of payload.events) {
    if (!Array.isArray(event.segs)) continue;
    const text = event.segs
      .map((seg) => seg.utf8 ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!text || NOISE.test(text) || /^\[[^\]]+\]$/.test(text)) continue;
    const startMs = Math.max(0, (event.tStartMs ?? 0) + (event.segs[0]?.tOffsetMs ?? 0));
    const durationMs = Math.max(0, event.dDurationMs ?? 0);
    const previous = segments.at(-1);
    if (previous && previous.text === text && startMs - previous.startMs < 7000) continue;
    segments.push({ text, startMs, durationMs });
  }

  const words: TranscriptWord[] = [];
  for (const segment of segments) {
    const parts = segment.text.split(" ").filter(Boolean);
    if (parts.length === 0) continue;
    const step = parts.length > 1 ? segment.durationMs / parts.length : 0;
    parts.forEach((part, index) => {
      words.push({ text: part, startMs: Math.round(segment.startMs + step * index) });
    });
  }
  return words;
}

export async function fetchTranscript(
  videoId: string,
  options: { runner?: CommandRunner; ytdlpPath?: string; timeoutMs?: number } = {},
): Promise<Transcript | null> {
  const runner = options.runner ?? runCommand;
  const ytdlp = options.ytdlpPath ?? config.ytdlpPath;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const directory = await mkdtemp(join(tmpdir(), "acordes-yt-"));
  try {
    const command = [
      ytdlp,
      "--no-warnings",
      "--skip-download",
      "--write-subs",
      "--write-auto-subs",
      "--sub-langs",
      "es,es-orig",
      "--sub-format",
      "json3",
      "-o",
      join(directory, "%(id)s.%(ext)s"),
      `https://www.youtube.com/watch?v=${videoId}`,
    ];

    let result: CommandResult | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      result = await runner(command, { timeoutMs });
      if (result.exitCode === 0) break;
      if (!/429|too many requests/i.test(result.stderr) || attempt === 1) return null;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    if (!result || result.exitCode !== 0) return null;

    const files = (await readdir(directory)).filter((file) => file.endsWith(".json3"));
    if (files.length === 0) return null;
    const preferred =
      files.find((file) => /\.es\.json3$/i.test(file)) ??
      files.find((file) => /\.es-orig\.json3$/i.test(file)) ??
      files[0]!;
    const raw = await readFile(join(directory, preferred), "utf8");
    const words = parseJson3(raw);
    if (words.length === 0) return null;
    const lang = /\.es-orig\.json3$/i.test(preferred) ? "es-orig" : "es";
    return {
      lang,
      kind: lang === "es-orig" ? "asr" : "manual",
      raw,
      words,
    };
  } catch (error) {
    console.error("No se pudo obtener la transcripción del video:", error);
    return null;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
