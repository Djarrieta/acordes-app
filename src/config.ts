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
  youtubeApiKey: Bun.env.YOUTUBE_API_KEY?.trim() || null,
  googleClientId: Bun.env.GOOGLE_CLIENT_ID?.trim() || null,
  googleClientSecret: Bun.env.GOOGLE_CLIENT_SECRET?.trim() || null,
  oauthRedirectUri: Bun.env.OAUTH_REDIRECT_URI?.trim() || null,
} as const;
