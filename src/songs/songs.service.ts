import type { Database } from "bun:sqlite";
import { getDb } from "../db";
import {
  fetchLacuerdaSong,
  parseLacuerdaSongUrl,
} from "../parser/lacuerda";
import { serializeChordProLine, validateChordProLine } from "../parser/chordpro";
import { enqueueVideoSearch } from "./enrichment/enrichment.service";
import {
  createSong,
  findSongIdBySourceKey,
  getSong,
  recordEdit,
} from "./songs.db";
import type { Song } from "./songs.model";

export const MAX_LINE_LENGTH = 2000;
export const MAX_LINES = 500;
export const MAX_CHORDS_PER_LINE = 20;
export const MAX_CHORD_LENGTH = 30;
export const MAX_WRITE_LENGTH = 256;

export type LoadResult = { song: Song; created: boolean };

export async function loadSong(
  inputUrl: string,
  offset: number,
  db: Database = getDb(),
): Promise<LoadResult> {
  const url = parseLacuerdaSongUrl(inputUrl);
  const sourceKey = url.pathname;
  const existingId = findSongIdBySourceKey(db, sourceKey);
  if (existingId) {
    const song = getSong(db, existingId);
    if (song) return { song, created: false };
  }

  const parsed = await fetchLacuerdaSong(url.toString());
  try {
    const song = createSong(db, {
      sourceKey,
      sourceUrl: url.toString(),
      title: parsed.title,
      artist: parsed.artist,
      lines: parsed.lines.map((line) => ({
        text: serializeChordProLine(
          line.lyric,
          line.chords.map((chord) => ({ name: chord.chord, column: chord.column })),
        ),
      })),
    });
    recordEdit(db, song.id, "song.import", { sourceKey });
    enqueueVideoSearch(song.id, db);
    return { song: getSong(db, song.id) ?? song, created: true };
  } catch (error) {
    const racedId = findSongIdBySourceKey(db, sourceKey);
    if (racedId) {
      const song = getSong(db, racedId);
      if (song) return { song, created: false };
    }
    throw error;
  }
}

export function validateOffset(value: unknown): number | null {
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) return null;
  const offset = Number(value);
  return Number.isSafeInteger(offset) ? offset : null;
}

export function readTrimmedString(value: unknown, max = MAX_WRITE_LENGTH): string | null {
  if (typeof value !== "string") return null;
  if (value.length > max) return null;
  return value;
}

export function validateLineText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\r\n?/g, "\n");
  if (text.length > MAX_LINE_LENGTH) return null;
  return text;
}

export function validateChordProText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length > MAX_LINE_LENGTH) return null;
  if (!validateChordProLine(value, MAX_CHORDS_PER_LINE)) return null;
  return value;
}

export function readVersion(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const version = Number(value);
  return Number.isSafeInteger(version) && version > 0 ? version : null;
}

export function currentSong(id: string, db: Database = getDb()): Song | null {
  return getSong(db, id);
}
