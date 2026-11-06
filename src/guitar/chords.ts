import chordDatabase from "./voicings.json";

type GuitarVoicing = {
  frets: number[];
  fingers: number[];
  barres: number[];
  baseFret: number;
  midi: number[];
};

type GuitarDatabase = {
  roots: Record<string, Record<string, GuitarVoicing[]>>;
};

type ParsedNote = { pitch: number };
type ParsedChord = {
  root: ParsedNote;
  bass: ParsedNote | null;
  suffix: string;
};

const database: GuitarDatabase = chordDatabase;
const NOTE_VALUES: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};
const LATIN_NOTES: Record<string, string> = {
  DO: "C",
  RE: "D",
  MI: "E",
  FA: "F",
  SOL: "G",
  LA: "A",
  SI: "B",
};
const ROOTS_BY_PITCH = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const CHORD_QUALITIES: Record<string, string> = {
  "": "major",
  maj: "major",
  major: "major",
  m: "minor",
  min: "minor",
  minor: "minor",
  "7": "7",
  maj7: "maj7",
  major7: "maj7",
  m7: "m7",
  min7: "m7",
  minor7: "m7",
  "6": "6",
  m6: "m6",
  sus: "sus",
  sus2: "sus2",
  sus4: "sus4",
  dim: "dim",
  dim7: "dim7",
  m7b5: "m7b5",
  add9: "add9",
  madd9: "madd9",
  "9": "9",
  m9: "m9",
  maj9: "maj9",
  major9: "maj9",
  aug: "aug",
  "+": "aug",
};
const STRING_NAMES = ["E", "A", "D", "G", "B", "e"];
const FRET_COUNT = 4;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character]!;
  });
}

function parseNote(value: string): ParsedNote | null {
  const match = /^(DO|RE|MI|FA|SOL|LA|SI|[A-G])([#b]{0,2})$/i.exec(value);
  if (!match) return null;

  const name = LATIN_NOTES[match[1]!.toUpperCase()] ?? match[1]!.toUpperCase();
  const accidental = [...match[2]!].reduce(
    (total, mark) => total + (mark === "#" ? 1 : -1),
    0,
  );
  return {
    pitch: ((NOTE_VALUES[name]! + accidental) % 12 + 12) % 12,
  };
}

function parseChord(value: string): ParsedChord | null {
  if (value.length > 32) return null;
  const match =
    /^(DO|RE|MI|FA|SOL|LA|SI|[A-G])([#b]{0,2})([^/]*)(?:\/((?:DO|RE|MI|FA|SOL|LA|SI|[A-G])[#b]{0,2}))?$/i.exec(
      value,
    );
  if (!match) return null;

  const root = parseNote(`${match[1]}${match[2]}`);
  const bass = match[4] ? parseNote(match[4]) : null;
  if (!root || (match[4] && !bass)) return null;
  return { root, bass, suffix: match[3]!.toLowerCase() };
}

function voicingScore(voicing: GuitarVoicing): number {
  const fingers = new Set(voicing.fingers.filter((finger) => finger > 0));
  const barreStrings = voicing.barres.reduce(
    (total, finger) => total + voicing.fingers.filter((value) => value === finger).length,
    0,
  );
  const mutedStrings = voicing.frets.filter((fret) => fret < 0).length;
  const openStrings = voicing.frets.filter((fret) => fret === 0).length;
  const highestFret = Math.max(...voicing.frets);
  return (
    (voicing.baseFret - 1) * 1.4 +
    voicing.barres.length * 2 +
    barreStrings * 0.5 +
    fingers.size * 1.3 +
    mutedStrings * 0.25 -
    openStrings * 0.8 +
    highestFret * 0.3
  );
}

function getVoicings(chordName: string): GuitarVoicing[] | null {
  const chord = parseChord(chordName);
  if (!chord) return null;

  const root = ROOTS_BY_PITCH[chord.root.pitch]!;
  const quality = CHORD_QUALITIES[chord.suffix];
  if (!quality) return null;
  const voicings = database.roots[root]?.[quality];
  if (!voicings) return null;

  let matchingBass = voicings;
  if (chord.bass) {
    matchingBass = voicings.filter((voicing) => {
      const lowestNote = Math.min(...voicing.midi);
      return lowestNote % 12 === chord.bass!.pitch;
    });
  }
  if (matchingBass.length === 0) return null;
  return [...matchingBass].sort((a, b) => voicingScore(a) - voicingScore(b));
}

function fretY(fret: number, top: number, fretGap: number): number {
  return top + (fret - 0.5) * fretGap;
}

function renderDiagram(chordName: string, voicing: GuitarVoicing): string {
  const left = 46;
  const top = 38;
  const stringGap = 25;
  const fretGap = 27;
  const right = left + stringGap * 5;
  const bottom = top + fretGap * FRET_COUNT;
  const barres = voicing.barres
    .map((finger) => {
      const strings = voicing.fingers
        .map((value, index) => (value === finger ? index : -1))
        .filter((index) => index >= 0);
      if (strings.length < 2) return "";
      const fret = voicing.frets[strings[0]!]!;
      const y = fretY(fret, top, fretGap);
      const x1 = left + Math.min(...strings) * stringGap;
      const x2 = left + Math.max(...strings) * stringGap;
      return `<line class="barre-line" x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/>`;
    })
    .join("");
  const fingerPositions = voicing.frets
    .map((fret, index) => {
      const x = left + index * stringGap;
      if (fret < 0) {
        return `<text class="string-mark" x="${x}" y="${top - 11}">×</text>`;
      }
      if (fret === 0) {
        return `<circle class="open-string" cx="${x}" cy="${top - 9}" r="5"/>`;
      }
      if (fret > FRET_COUNT) return "";
      const finger = voicing.fingers[index]!;
      const y = fretY(fret, top, fretGap);
      return `<circle class="finger-dot" cx="${x}" cy="${y}" r="9"/><text class="finger-number" x="${x}" y="${y + 3.5}">${finger || ""}</text>`;
    })
    .join("");
  const verticalStrings = STRING_NAMES.map((name, index) => {
    const x = left + index * stringGap;
    return `<line class="fret-string" x1="${x}" y1="${top}" x2="${x}" y2="${bottom}"/><text class="string-name" x="${x}" y="${bottom + 20}">${name}</text>`;
  }).join("");
  const horizontalFrets = Array.from({ length: FRET_COUNT + 1 }, (_, index) => {
    const y = top + index * fretGap;
    const className = index === 0 && voicing.baseFret === 1 ? "fret-wire nut" : "fret-wire";
    return `<line class="${className}" x1="${left}" y1="${y}" x2="${right}" y2="${y}"/>`;
  }).join("");
  const fretLabel =
    voicing.baseFret > 1
      ? `<text class="fret-label" x="${left - 18}" y="${top + fretGap / 2 + 4}">${voicing.baseFret}º</text>`
      : "";

  return `<div class="chord-diagram">
  <h3>${escapeHtml(chordName)}</h3>
  <p>Digitación conocida · afinación estándar</p>
  <svg viewBox="0 0 210 190" role="img" aria-label="Diagrama de guitarra para ${escapeHtml(chordName)}">
    ${verticalStrings}${horizontalFrets}${barres}${fingerPositions}${fretLabel}
  </svg>
  <p class="diagram-help">Cuerdas de 6ª (grave) a 1ª (aguda). Números = dedos. ○ al aire · × no tocar</p>
</div>`;
}

function positionLabel(voicing: GuitarVoicing): string {
  const hasOpenStrings = voicing.frets.includes(0);
  if (voicing.baseFret <= 3 && hasOpenStrings) return "Abierta";
  return voicing.barres.length > 0
    ? `Cejilla · traste ${voicing.baseFret}`
    : `Traste ${voicing.baseFret}`;
}

export function renderGuitarChordDiagram(
  chordName: string,
  selectedPosition = 0,
): string | null {
  const voicings = getVoicings(chordName);
  if (
    !voicings ||
    !Number.isInteger(selectedPosition) ||
    selectedPosition < 0 ||
    selectedPosition >= voicings.length
  ) {
    return null;
  }

  const positionOptions =
    voicings.length > 1
      ? `<nav class="voicing-options" aria-label="Variantes de digitación">${voicings
          .map(
            (voicing, index) =>
              `<button type="button" class="voicing-choice" aria-pressed="${index === selectedPosition}" hx-get="/chord-diagram?chord=${encodeURIComponent(chordName)}&amp;position=${index}" hx-target="#chord-viewer" hx-swap="innerHTML">${index + 1} · ${escapeHtml(positionLabel(voicing))}</button>`,
          )
          .join("")}</nav>`
      : "";

  return `${positionOptions}${renderDiagram(chordName, voicings[selectedPosition]!)}`;
}

export function getGuitarChordPositionCount(chordName: string): number {
  return getVoicings(chordName)?.length ?? 0;
}
