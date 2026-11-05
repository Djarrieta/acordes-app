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

const OPEN_STRINGS = [40, 45, 50, 55, 59, 64];
const STRING_NAMES = ["E", "A", "D", "G", "B", "e"];
const FRET_COUNT = 5;
const SUPPORTED_SUFFIXES = new Set([
  "",
  "m",
  "min",
  "minor",
  "maj",
  "major",
  "7",
  "maj7",
  "major7",
  "m7",
  "min7",
  "minor7",
  "6",
  "m6",
  "min6",
  "9",
  "maj9",
  "major9",
  "m9",
  "min9",
  "add9",
  "madd9",
  "sus",
  "sus2",
  "sus4",
  "7sus2",
  "7sus4",
  "dim",
  "dim7",
  "°",
  "°7",
  "ø",
  "ø7",
  "m7b5",
  "aug",
  "aug7",
  "+",
  "7b5",
  "7#5",
  "7b9",
  "7#9",
  "11",
  "m11",
  "maj11",
  "13",
  "m13",
  "maj13",
]);

type ParsedNote = { pitch: number; label: string };
type ParsedChord = { root: ParsedNote; bass: ParsedNote | null; intervals: number[] };
type Position = { fret: number | null; pitch: number };

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
    label: value,
  };
}

function chordIntervals(suffix: string): number[] | null {
  const quality = suffix.toLowerCase();
  if (!SUPPORTED_SUFFIXES.has(quality)) return null;
  let intervals: number[];

  if (quality.includes("ø")) {
    intervals = [0, 3, 6, 10];
  } else if (quality.includes("dim") || quality.includes("°")) {
    intervals = quality.includes("7") ? [0, 3, 6, 9] : [0, 3, 6];
  } else if (quality.includes("aug") || quality.includes("+")) {
    intervals = [0, 4, 8];
  } else if (quality.includes("sus2")) {
    intervals = [0, 2, 7];
  } else if (quality === "sus" || quality.includes("sus4")) {
    intervals = [0, 5, 7];
  } else if (/^(m|min|minor)/.test(quality)) {
    intervals = [0, 3, 7];
  } else {
    intervals = [0, 4, 7];
  }

  if (/maj(?:or)?(?:7|9|11|13)/.test(quality)) {
    intervals.push(11);
  } else if (
    !quality.includes("dim") &&
    !quality.includes("°") &&
    !quality.includes("ø") &&
    quality.includes("7")
  ) {
    intervals.push(10);
  }
  if (quality.includes("6")) intervals.push(9);
  if (quality.includes("9")) intervals.push(quality.includes("b9") ? 1 : quality.includes("#9") ? 3 : 2);
  if (quality.includes("11")) intervals.push(5);
  if (quality.includes("13")) intervals.push(9);
  if (quality.includes("b5")) {
    intervals = intervals.filter((interval) => interval !== 7);
    intervals.push(6);
  }
  if (quality.includes("#5")) {
    intervals = intervals.filter((interval) => interval !== 7);
    intervals.push(8);
  }

  return [...new Set(intervals)];
}

function parseChord(value: string): ParsedChord | null {
  if (value.length > 32) return null;
  const match = /^(DO|RE|MI|FA|SOL|LA|SI|[A-G])([#b]{0,2})([^/]*)(?:\/((?:DO|RE|MI|FA|SOL|LA|SI|[A-G])[#b]{0,2}))?$/i.exec(
    value,
  );
  if (!match) return null;

  const root = parseNote(`${match[1]}${match[2]}`);
  const bass = match[4] ? parseNote(match[4]) : null;
  const intervals = chordIntervals(match[3]!);
  if (!root || (match[4] && !bass) || !intervals) return null;
  return { root, bass, intervals };
}

function findVoicing(chord: ParsedChord): (number | null)[] | null {
  const choices = OPEN_STRINGS.map((openPitch) => [
    { fret: null, pitch: -1 },
    ...Array.from({ length: 8 }, (_, fret) => ({ fret, pitch: openPitch + fret })),
  ]);
  const required = new Set([0]);
  const bassInterval = chord.bass
    ? (chord.bass.pitch - chord.root.pitch + 12) % 12
    : null;
  const third = chord.intervals.includes(3) ? 3 : chord.intervals.includes(4) ? 4 : chord.intervals.includes(2) ? 2 : 5;
  required.add(third);
  const seventh = chord.intervals.find((interval) => [9, 10, 11].includes(interval));
  if (seventh !== undefined && chord.intervals.length > 3) required.add(seventh);

  let best: (number | null)[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const current: Position[] = [];

  function search(string: number, tones: Set<number>): void {
    if (string === OPEN_STRINGS.length) {
      const sounding = current.filter((position) => position.fret !== null);
      if (sounding.length < 4 || ![...required].every((interval) => tones.has(interval))) return;
      const pitches = current.filter((position) => position.fret !== null).map((position) => position.pitch);
      const lowest = Math.min(...pitches);
      if (chord.bass && lowest % 12 !== chord.bass.pitch) return;

      const frets = sounding.map((position) => position.fret!);
      const frettedPositions = frets.filter((fret) => fret > 0);
      if (
        frettedPositions.length > 0 &&
        Math.max(...frettedPositions) - Math.min(...frettedPositions) >= FRET_COUNT
      ) {
        return;
      }
      const fretted = frets.filter((fret) => fret > 0);
      const uniqueFrets = new Set(fretted);
      const nonOpen = frets.filter((fret) => fret > 0).length;
      const score =
        [...frets].reduce((total, fret) => total + fret, 0) +
        Math.max(...frets) * 1.5 +
        uniqueFrets.size * 2 +
        (6 - sounding.length) * 1.5 +
        Math.max(0, nonOpen - 4) * 3;
      if (score < bestScore) {
        bestScore = score;
        best = current.map((position) => position.fret);
      }
      return;
    }

    for (const option of choices[string]!) {
      if (option.fret !== null) {
        const interval = ((option.pitch % 12) - chord.root.pitch + 12) % 12;
        if (!chord.intervals.includes(interval) && interval !== bassInterval) continue;
        current.push(option);
        const nextTones = new Set(tones);
        nextTones.add(interval);
        search(string + 1, nextTones);
        current.pop();
      } else {
        current.push(option);
        search(string + 1, tones);
        current.pop();
      }
    }
  }

  search(0, new Set());
  return best;
}

function renderDiagram(chordName: string, frets: (number | null)[]): string {
  const fretted = frets.filter((fret): fret is number => fret !== null && fret > 0);
  const lowestFret = Math.min(...fretted);
  const baseFret = lowestFret > FRET_COUNT ? lowestFret : 1;
  const left = 34;
  const top = 42;
  const stringGap = 24;
  const fretGap = 24;
  const right = left + stringGap * 5;
  const bottom = top + fretGap * FRET_COUNT;
  const strings = frets
    .map((fret, index) => {
      const x = left + index * stringGap;
      if (fret === null) {
        return `<text class="string-mark" x="${x}" y="${top - 9}">×</text>`;
      }
      if (fret === 0) {
        return `<circle class="open-string" cx="${x}" cy="${top - 8}" r="4"/>`;
      }
      const y = top + (fret - baseFret + 0.5) * fretGap;
      if (y < top || y > bottom) return "";
      return `<circle class="finger-dot" cx="${x}" cy="${y}" r="7"/>`;
    })
    .join("");
  const verticalStrings = STRING_NAMES.map((name, index) => {
    const x = left + index * stringGap;
    return `<line class="fret-string" x1="${x}" y1="${top}" x2="${x}" y2="${bottom}"/><text class="string-name" x="${x}" y="${bottom + 17}">${name}</text>`;
  }).join("");
  const horizontalFrets = Array.from({ length: FRET_COUNT + 1 }, (_, index) => {
    const y = top + index * fretGap;
    const className = index === 0 && baseFret === 1 ? "fret-wire nut" : "fret-wire";
    return `<line class="${className}" x1="${left}" y1="${y}" x2="${right}" y2="${y}"/>`;
  }).join("");
  const fretLabel =
    baseFret > 1
      ? `<text class="fret-label" x="${left - 15}" y="${top + fretGap / 2 + 4}">${baseFret}</text>`
      : "";

  return `<div class="chord-diagram">
  <h3>${escapeHtml(chordName)}</h3>
  <p>Vista desde el frente de la guitarra</p>
  <svg viewBox="0 0 180 190" role="img" aria-label="Diagrama de guitarra para ${escapeHtml(chordName)}">
    ${verticalStrings}${horizontalFrets}${strings}${fretLabel}
  </svg>
  <p class="diagram-help">De 6ª cuerda (grave) a 1ª (aguda). ● pisar · ○ al aire · × no tocar</p>
</div>`;
}

export function renderGuitarChordDiagram(chordName: string): string | null {
  const chord = parseChord(chordName);
  if (!chord) return null;
  const voicing = findVoicing(chord);
  return voicing ? renderDiagram(chordName, voicing) : null;
}
