const NATURAL_SEMITONES: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const LATIN_SHARPS = [
  "Do",
  "Do#",
  "Re",
  "Re#",
  "Mi",
  "Fa",
  "Fa#",
  "Sol",
  "Sol#",
  "La",
  "La#",
  "Si",
] as const;

const LATIN_NATURAL: Record<string, string> = {
  C: "Do",
  D: "Re",
  E: "Mi",
  F: "Fa",
  G: "Sol",
  A: "La",
  B: "Si",
};

type ParsedNote = {
  letter: string;
  accidental: string;
};

function parseNote(value: string): ParsedNote | null {
  const match = /^([A-G])([#b]{0,2})$/.exec(value);
  return match ? { letter: match[1]!, accidental: match[2]! } : null;
}

function noteIndex(note: ParsedNote): number {
  const accidentalOffset = [...note.accidental].reduce(
    (total, accidental) => total + (accidental === "#" ? 1 : -1),
    0,
  );
  return ((NATURAL_SEMITONES[note.letter]! + accidentalOffset) % 12 + 12) % 12;
}

function formatNote(note: ParsedNote, offset: number): string {
  if (offset === 0) {
    return `${LATIN_NATURAL[note.letter]}${note.accidental}`;
  }
  const index = (noteIndex(note) + offset % 12 + 12) % 12;
  return LATIN_SHARPS[index]!;
}

export function transposeChord(chord: string, offset: number): string {
  if (!Number.isInteger(offset)) {
    throw new TypeError("El desplazamiento debe ser un número entero de semitonos.");
  }

  const match = /^([A-G](?:#{1,2}|b{1,2})?)([^/]*)(?:\/([A-G](?:#{1,2}|b{1,2})?))?$/.exec(
    chord,
  );
  if (!match) {
    return chord;
  }

  const root = parseNote(match[1]!);
  const bass = match[3] ? parseNote(match[3]) : null;
  if (!root || (match[3] && !bass)) {
    return chord;
  }

  return `${formatNote(root, offset)}${match[2]}${bass ? `/${formatNote(bass, offset)}` : ""}`;
}
