import { join } from "node:path";

function integerEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = Bun.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} debe ser un entero entre ${min} y ${max}.`);
  }
  return value;
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const raw = Bun.env[name];
  if (raw === undefined || raw === "") return fallback;
  return !["0", "false", "no", "off"].includes(raw.toLowerCase());
}

export const config = {
  port: integerEnv("PORT", 4173, 1, 65535),
  host: Bun.env.HOST ?? "0.0.0.0",
  dbPath: Bun.env.DB_PATH?.trim() || join(process.cwd(), "data", "app.sqlite"),
  videoSearchEnabled: booleanEnv("VIDEO_SEARCH_ENABLED", true),
  videoMaxCandidates: integerEnv("VIDEO_MAX_CANDIDATES", 5, 1, 20),
  timestampsEnabled: booleanEnv("TIMESTAMPS_ENABLED", true),
  timestampsMaxAttempts: integerEnv("TIMESTAMPS_MAX_ATTEMPTS", 3, 1, 10),
  ytdlpPath: Bun.env.YTDLP_PATH?.trim() || "yt-dlp",
  ffmpegPath: Bun.env.FFMPEG_PATH?.trim() || "ffmpeg",
  audioEnabled: booleanEnv("AUDIO_TRANSPOSE_ENABLED", true),
  audioMaxAttempts: integerEnv("AUDIO_MAX_ATTEMPTS", 3, 1, 10),
  audioMaxBytes: integerEnv("AUDIO_MAX_BYTES", 50 * 1024 * 1024, 1024 * 1024, 500 * 1024 * 1024),
  audioMaxTotalBytes: integerEnv("AUDIO_MAX_TOTAL_BYTES", 2 * 1024 * 1024 * 1024, 10 * 1024 * 1024, 100 * 1024 * 1024 * 1024),
  audioDir: Bun.env.AUDIO_DIR?.trim() || join(process.cwd(), "data", "audio"),
  youtubeApiKey: Bun.env.YOUTUBE_API_KEY?.trim() || null,
  googleClientId: Bun.env.GOOGLE_CLIENT_ID?.trim() || null,
  googleClientSecret: Bun.env.GOOGLE_CLIENT_SECRET?.trim() || null,
  oauthRedirectUri: Bun.env.OAUTH_REDIRECT_URI?.trim() || null,
} as const;
