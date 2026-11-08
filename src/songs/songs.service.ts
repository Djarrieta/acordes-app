import type { Database } from "bun:sqlite";
import { getDb } from "../db";
import {
  fetchLacuerdaSong,
  parseLacuerdaSongUrl,
} from "../parser/lacuerda";
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
        lyric: line.lyric,
        chords: line.chords.map((chord) => ({ name: chord.chord, column: chord.column })),
      })),
    });
    recordEdit(db, song.id, "song.import", { sourceKey });
    enqueueVideoSearch(song.id, db);
    // La búsqueda de video cambia el estado en la base; se relee para que la vista muestre "buscando".
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

const CHORD_NAME = /^[A-Za-z0-9#b/().*+\-\s]{1,30}$/;

export function validateChordName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (!name || name.length > MAX_CHORD_LENGTH || !CHORD_NAME.test(name)) return null;
  return name;
}

export function validateColumn(value: unknown, lyricLength: number): number | null {
  const raw = typeof value === "number" ? String(value) : value;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  const column = Number(raw);
  if (!Number.isSafeInteger(column) || column < 0) return null;
  return Math.min(column, Math.max(lyricLength, 0) + 40);
}

export function readVersion(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const version = Number(value);
  return Number.isSafeInteger(version) && version > 0 ? version : null;
}

export function currentSong(id: string, db: Database = getDb()): Song | null {
  return getSong(db, id);
}
