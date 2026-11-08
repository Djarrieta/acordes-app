export type ChordProChord = {
  name: string;
  column: number;
  timestampMs: number | null;
  timestampManual: boolean;
  index: number;
};

export type ParsedChordProLine = { lyric: string; chords: ChordProChord[] };

const CHORD_NAME = /^[A-Za-z0-9#b/().*+\-\s]{1,30}$/;
const MAX_TIMESTAMP_SECONDS = 24 * 60 * 60;

function parseToken(inner: string): { name: string; timestampMs: number | null; manual: boolean } | null {
  const at = inner.indexOf("@");
  const rawName = at === -1 ? inner : inner.slice(0, at);
  const name = rawName.trim();
  if (!name || !CHORD_NAME.test(name)) return null;
  if (at === -1) return { name, timestampMs: null, manual: false };
  let suffix = inner.slice(at + 1);
  let manual = false;
  if (suffix.endsWith("!")) {
    manual = true;
    suffix = suffix.slice(0, -1);
  }
  if (!/^\d+(\.\d{1,3})?$/.test(suffix)) return null;
  const seconds = Number(suffix);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_TIMESTAMP_SECONDS) return null;
  return { name, timestampMs: Math.round(seconds * 1000), manual };
}

function formatSeconds(ms: number): string {
  const raw = (ms / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, ".0");
  return raw.includes(".") ? raw : `${raw}.0`;
}

function escapeLyric(lyric: string): string {
  return lyric.replace(/\\/g, "\\\\").replace(/\[/g, "\\[");
}

export function parseChordProLine(text: string): ParsedChordProLine {
  let lyric = "";
  const chords: ChordProChord[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf("[", cursor);
    if (open === -1) {
      lyric += unescape(text.slice(cursor));
      break;
    }
    if (open > 0 && text[open - 1] === "\\") {
      lyric += unescape(text.slice(cursor, open + 1));
      cursor = open + 1;
      continue;
    }
    lyric += unescape(text.slice(cursor, open));
    const close = text.indexOf("]", open + 1);
    if (close === -1) {
      lyric += unescape(text.slice(open));
      break;
    }
    const token = parseToken(text.slice(open + 1, close));
    if (!token) {
      lyric += `[${text.slice(open + 1, close)}]`;
      cursor = close + 1;
      continue;
    }
    chords.push({
      name: token.name,
      column: lyric.length,
      timestampMs: token.timestampMs,
      timestampManual: token.manual,
      index: chords.length,
    });
    cursor = close + 1;
  }
  return { lyric, chords };
}

function unescape(value: string): string {
  return value.replace(/\\(.)/g, "$1");
}

export function serializeChordProLine(
  lyric: string,
  chords: { name: string; column: number; timestampMs?: number | null; timestampManual?: boolean }[],
): string {
  const sorted = chords
    .map((chord, order) => ({ ...chord, order }))
    .sort((a, b) => a.column - b.column || a.order - b.order);
  let output = "";
  let cursor = 0;
  for (const chord of sorted) {
    const column = Math.max(0, Math.min(chord.column, lyric.length));
    output += escapeLyric(lyric.slice(cursor, column));
    const stamp =
      chord.timestampMs === null || chord.timestampMs === undefined
        ? ""
        : `@${formatSeconds(chord.timestampMs)}${chord.timestampManual ? "!" : ""}`;
    output += `[${chord.name}${stamp}]`;
    cursor = column;
  }
  output += escapeLyric(lyric.slice(cursor));
  return output;
}

export function validateChordProLine(text: string, maxChords: number): ParsedChordProLine | null {
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf("[", cursor);
    if (open === -1) break;
    if (open > 0 && text[open - 1] === "\\") {
      cursor = open + 1;
      continue;
    }
    const close = text.indexOf("]", open + 1);
    if (close === -1) return null;
    const inner = text.slice(open + 1, close);
    if (!inner.trim() || !parseToken(inner)) return null;
    cursor = close + 1;
  }
  const parsed = parseChordProLine(text);
  if (parsed.chords.length > maxChords) return null;
  return parsed;
}

export function setChordProTimestamp(
  text: string,
  chordIndex: number,
  timestampMs: number | null,
  manual = true,
): string | null {
  const parsed = parseChordProLine(text);
  if (chordIndex < 0 || chordIndex >= parsed.chords.length) return null;
  const target = parsed.chords[chordIndex]!;
  const updated = parsed.chords.map((chord) =>
    chord.index === chordIndex ? { ...chord, timestampMs, timestampManual: manual } : chord,
  );
  return serializeChordProLine(parsed.lyric, updated);
}

export function stripChordProTimestamps(text: string, onlyAuto = false): string {
  const parsed = parseChordProLine(text);
  const updated = parsed.chords.map((chord) => {
    if (onlyAuto && chord.timestampManual) return chord;
    return { ...chord, timestampMs: null, timestampManual: false };
  });
  return serializeChordProLine(parsed.lyric, updated);
}
