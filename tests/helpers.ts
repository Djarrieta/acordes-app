import type { Song } from "../src/songs/songs.model";

export function makeSong(overrides: Partial<Song> = {}): Song {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: "song-id",
    source: "lacuerda",
    sourceKey: "/artista/cancion.shtml",
    sourceUrl: "https://acordes.lacuerda.net/artista/cancion.shtml",
    title: "Canción",
    artist: "Artista",
    video: null,
    timestampSource: "none",
    timestampConfidence: null,
    videoStatus: "none",
    videoError: null,
    timestampsStatus: "none",
    timestampsError: null,
    timestampsAttempts: 0,
    liked: false,
    likedAt: null,
    preferredOffset: 0,
    version: 1,
    lines: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
