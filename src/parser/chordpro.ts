export type ChordProChord = {
  name: string;
  column: number;
  index: number;
};

export type ParsedChordProLine = { lyric: string; chords: ChordProChord[] };

const CHORD_NAME = /^[A-Za-z0-9#b/().*+\-\s]{1,30}$/;

function parseToken(inner: string): { name: string } | null {
  const name = inner.trim();
  if (!name || !CHORD_NAME.test(name)) return null;
  return { name };
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
    chords.push({ name: token.name, column: lyric.length, index: chords.length });
    cursor = close + 1;
  }
  return { lyric, chords };
}

function unescape(value: string): string {
  return value.replace(/\\(.)/g, "$1");
}

export function serializeChordProLine(
  lyric: string,
  chords: { name: string; column: number }[],
): string {
  const sorted = chords
    .map((chord, order) => ({ ...chord, order }))
    .sort((a, b) => a.column - b.column || a.order - b.order);
  let output = "";
  let cursor = 0;
  for (const chord of sorted) {
    const column = Math.max(0, Math.min(chord.column, lyric.length));
    output += escapeLyric(lyric.slice(cursor, column));
    output += `[${chord.name}]`;
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
