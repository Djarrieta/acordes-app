import { copyFile, mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { config } from "../config";
import { runCommand, type CommandRunner } from "../songs/enrichment/youtube.transcript";

export type DownloadedAudio = {
  mime: string;
  path: string;
  sizeBytes: number;
};

const MIME_BY_EXT: Record<string, string> = {
  webm: "audio/webm",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  opus: "audio/ogg",
};

export function mimeForExt(ext: string): string | null {
  return MIME_BY_EXT[ext.toLowerCase()] ?? null;
}

export async function downloadAudio(
  videoId: string,
  destDir: string,
  options: {
    runner?: CommandRunner;
    ytdlpPath?: string;
    ffmpegPath?: string;
    timeoutMs?: number;
    maxBytes?: number;
  } = {},
): Promise<DownloadedAudio | null> {
  const runner = options.runner ?? runCommand;
  const ytdlp = options.ytdlpPath ?? config.ytdlpPath;
  const ffmpeg = options.ffmpegPath ?? config.ffmpegPath;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxBytes = options.maxBytes ?? config.audioMaxBytes;
  const directory = await mkdtemp(join(tmpdir(), "acordes-audio-"));
  try {
    await mkdir(destDir, { recursive: true });
    const command = [
      ytdlp,
      "--no-warnings",
      "-f",
      // M4A (AAC) es el único formato que Safari/iOS reproduce de forma fiable en <audio>.
      "bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio",
      "-o",
      join(directory, "%(id)s.%(ext)s"),
      `https://www.youtube.com/watch?v=${videoId}`,
    ];

    let result = await runner(command, { timeoutMs });
    if (result.exitCode !== 0 && /429|too many requests/i.test(result.stderr)) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      result = await runner(command, { timeoutMs });
    }
    if (result.exitCode !== 0) {
      console.error("No se pudo descargar el audio del video:", result.stderr.slice(0, 500));
      return null;
    }

    const files = (await readdir(directory)).filter((file) => !file.endsWith(".part"));
    if (files.length === 0) return null;
    let source = join(directory, files[0]!);
    let ext = extname(source).replace(".", "").toLowerCase();

    if (!mimeForExt(ext)) {
      const converted = join(directory, `${videoId}.opus`);
      const conv = await runner(
        [ffmpeg, "-y", "-i", source, "-vn", "-c:a", "libopus", "-b:a", "96k", converted],
        { timeoutMs },
      );
      if (conv.exitCode !== 0) {
        console.error("No se pudo convertir el audio del video:", conv.stderr.slice(0, 500));
        return null;
      }
      source = converted;
      ext = "opus";
    }

    const mime = mimeForExt(ext);
    if (!mime) return null;
    const info = await stat(source);
    if (!info.isFile() || info.size === 0 || info.size > maxBytes) return null;

    const dest = join(destDir, `${videoId}.${ext}`);
    await copyFile(source, dest);
    return { mime, path: dest, sizeBytes: info.size };
  } catch (error) {
    console.error("No se pudo descargar el audio del video:", error);
    return null;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
