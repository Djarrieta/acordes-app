import type { Database } from "bun:sqlite";
import { getDb } from "../db";
import {
  fetchLacuerdaSong,
  parseLacuerdaSongUrl,
} from "../parser/lacuerda";
import { serializeChordProLine, validateChordProLine } from "../parser/chordpro";
import { enqueueVideoSearch } from "./enrichment/enrichment.service";
import { enqueueAudioDownload } from "../audio/audio.service";
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
    if (song) {
      enqueueAudioDownload(song.id, db);
      return { song, created: false };
    }
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
    enqueueAudioDownload(song.id, db);
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

export function readVersion(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const version = Number(value);
  return Number.isSafeInteger(version) && version > 0 ? version : null;
}

export function currentSong(id: string, db: Database = getDb()): Song | null {
  return getSong(db, id);
}

export type EditorTextResult = { lines: string[] } | { error: string };

/** Convierte el texto del editor (una línea por renglón, ChordPro) en las líneas de la canción. */
export function parseEditorText(value: unknown): EditorTextResult {
  if (typeof value !== "string") return { error: "Falta el texto de la canción." };
  const lines = value.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd());
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  while (lines.length > 0 && lines[0] === "") lines.shift();
  if (lines.length === 0) return { error: "La canción no puede quedar vacía." };
  if (lines.length > MAX_LINES) {
    return { error: `La canción no puede tener más de ${MAX_LINES} líneas.` };
  }
  for (const [index, line] of lines.entries()) {
    const number = index + 1;
    if (line.length > MAX_LINE_LENGTH) {
      return { error: `La línea ${number} es demasiado larga (máximo ${MAX_LINE_LENGTH} caracteres).` };
    }
    if (line !== "" && !validateChordProLine(line, MAX_CHORDS_PER_LINE)) {
      return {
        error: `La línea ${number} no es válida: revisa los corchetes de los acordes (p. ej. [Am]) y que no pase de ${MAX_CHORDS_PER_LINE} acordes.`,
      };
    }
  }
  return { lines };
}

export function songToEditorText(song: Song): string {
  return song.lines.map((line) => line.text).join("\n");
}
