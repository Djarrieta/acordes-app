import { config } from "../../config";

export type VideoCandidate = {
  videoId: string;
  title: string;
  channel: string;
  durationMs: number | null;
  rank: number;
};

const INNERTUBE_SEARCH = "https://www.youtube.com/youtubei/v1/search?prettyPrint=false";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function textOf(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.simpleText === "string") return record.simpleText;
  if (Array.isArray(record.runs)) {
    return record.runs
      .map((run) =>
        run && typeof run === "object" && typeof (run as { text?: unknown }).text === "string"
          ? (run as { text: string }).text
          : "",
      )
      .join("");
  }
  return "";
}

function parseDuration(value: string): number | null {
  const parts = value.trim().split(":").map((part) => Number(part));
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isInteger(part))) {
    return null;
  }
  return parts.reduce((total, part) => total * 60 + part, 0) * 1000;
}

function collectVideoRenderers(value: unknown, output: Record<string, unknown>[]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectVideoRenderers(item, output);
    return;
  }
  const record = value as Record<string, unknown>;
  const renderer = record.videoRenderer;
  if (renderer && typeof renderer === "object") output.push(renderer as Record<string, unknown>);
  for (const child of Object.values(record)) collectVideoRenderers(child, output);
}

function scoreCandidate(
  candidate: { title: string; channel: string; durationMs: number | null },
  artist: string,
  title: string,
): number {
  const haystackTitle = normalize(candidate.title);
  const haystackChannel = normalize(candidate.channel);
  const wantedTitle = normalize(title);
  const wantedArtist = normalize(artist);
  let score = 0;

  if (wantedTitle && haystackTitle.includes(wantedTitle)) score += 6;
  else {
    const words = wantedTitle.split(" ").filter((word) => word.length > 3);
    score += words.filter((word) => haystackTitle.includes(word)).length;
  }
  if (wantedArtist && haystackChannel.includes(wantedArtist)) score += 4;
  if (wantedArtist && haystackTitle.includes(wantedArtist)) score += 2;
  if (/\bletra\b|\blyrics?\b/.test(haystackTitle)) score += 2;
  if (/\b(cover|karaoke|instrumental|tutorial|reacci[oó]n|reaction)\b/.test(haystackTitle)) score -= 4;
  if (/\b(live|en vivo|concierto)\b/.test(haystackTitle)) score -= 2;
  if (candidate.durationMs !== null && candidate.durationMs < 60_000) score -= 1;
  return score;
}

export async function searchYoutubeVideos(
  artist: string,
  title: string,
  max = config.videoMaxCandidates,
): Promise<VideoCandidate[]> {
  const query = `${artist} ${title}`.trim();
  const response = await fetch(INNERTUBE_SEARCH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.6",
      Origin: "https://www.youtube.com",
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: "WEB",
          clientVersion: "2.20240101.00.00",
          hl: "es",
          gl: "ES",
        },
      },
      query,
    }),
  });
  if (!response.ok) {
    throw new Error(`YouTube respondió con el estado HTTP ${response.status}.`);
  }
  const payload = (await response.json()) as unknown;
  const renderers: Record<string, unknown>[] = [];
  collectVideoRenderers(payload, renderers);

  const seen = new Set<string>();
  const candidates: VideoCandidate[] = [];
  for (const renderer of renderers) {
    const videoId = renderer.videoId;
    if (typeof videoId !== "string" || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) continue;
    if (seen.has(videoId)) continue;
    seen.add(videoId);
    candidates.push({
      videoId,
      title: textOf(renderer.title).trim(),
      channel: textOf(renderer.ownerText).trim(),
      durationMs: parseDuration(textOf(renderer.lengthText)),
      rank: 0,
    });
  }

  return candidates
    .map((candidate) => ({
      ...candidate,
      rank: scoreCandidate(candidate, artist, title),
    }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, max)
    .map((candidate, index) => ({ ...candidate, rank: index }));
}
