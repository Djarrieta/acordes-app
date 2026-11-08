import type { TranscriptWord } from "./youtube.transcript";

export type AlignChord = { id: string; column: number };
export type AlignLine = { id: string; lyric: string; chords: AlignChord[] };
export type AlignInput = { lines: AlignLine[] };

export type AlignUpdate = { chordId: string; timestampMs: number; confidence: number };
export type AlignResult = {
  updates: AlignUpdate[];
  coverage: number;
  lineCoverage: number;
  matchedWords: number;
  totalWords: number;
  alignedLines: number;
  totalLyricLines: number;
};

type LyricWord = {
  lineIndex: number;
  start: number;
  normalized: string;
};

const NOISE_LINE =
  /^(correcci[oó]n|tablatura|tab|acordes|intro|solo|puente|final|outro|repetir|bis|estribillo|coro|instrumental)\b/i;

export function normalizeWord(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, "")
    .trim();
}

function isNoiseLine(lyric: string): boolean {
  const trimmed = lyric.trim();
  if (!trimmed) return true;
  return NOISE_LINE.test(trimmed) || /^\[[^\]]*\]$/.test(trimmed);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return previous[b.length]!;
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 2;
  const longest = Math.max(a.length, b.length);
  if (longest < 3) return 0;
  const distance = levenshtein(a, b);
  return distance <= Math.max(1, Math.floor(longest * 0.34)) ? 1 : 0;
}

function alignSequences(
  lyricWords: LyricWord[],
  transcriptWords: TranscriptWord[],
): (number | null)[] {
  const n = lyricWords.length;
  const m = transcriptWords.length;
  const mapping: (number | null)[] = new Array(n).fill(null);
  if (n === 0 || m === 0) return mapping;

  const width = m + 1;
  const scores = new Int16Array((n + 1) * width);
  for (let i = 1; i <= n; i += 1) scores[i * width] = -i;
  for (let j = 1; j <= m; j += 1) scores[j] = -j;

  const transcriptNormalized = transcriptWords.map((word) => normalizeWord(word.text));

  for (let i = 1; i <= n; i += 1) {
    const lyricNormalized = lyricWords[i - 1]!.normalized;
    for (let j = 1; j <= m; j += 1) {
      const match = similarity(lyricNormalized, transcriptNormalized[j - 1]!);
      const diagonal = scores[(i - 1) * width + (j - 1)]! + (match > 0 ? match : -1);
      const up = scores[(i - 1) * width + j]! - 1;
      const left = scores[i * width + (j - 1)]! - 1;
      scores[i * width + j] = Math.max(diagonal, up, left);
    }
  }

  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const current = scores[i * width + j]!;
    const match = similarity(lyricWords[i - 1]!.normalized, transcriptNormalized[j - 1]!);
    const diagonal = scores[(i - 1) * width + (j - 1)]! + (match > 0 ? match : -1);
    if (current === diagonal) {
      if (match > 0) mapping[i - 1] = j - 1;
      i -= 1;
      j -= 1;
      continue;
    }
    if (current === scores[(i - 1) * width + j]! - 1) {
      i -= 1;
      continue;
    }
    j -= 1;
  }

  return mapping;
}

export function alignLyrics(input: AlignInput, transcriptWords: TranscriptWord[]): AlignResult {
  const lyricWords: LyricWord[] = [];
  const wordsByLine = new Map<number, number[]>();
  const lyricLineIndexes = new Set<number>();

  input.lines.forEach((line, lineIndex) => {
    if (isNoiseLine(line.lyric)) return;
    lyricLineIndexes.add(lineIndex);
    for (const match of line.lyric.matchAll(/\S+/g)) {
      const normalized = normalizeWord(match[0]);
      if (!normalized) continue;
      const wordIndex = lyricWords.length;
      lyricWords.push({ lineIndex, start: match.index, normalized });
      const list = wordsByLine.get(lineIndex) ?? [];
      list.push(wordIndex);
      wordsByLine.set(lineIndex, list);
    }
  });

  const mapping = alignSequences(lyricWords, transcriptWords);
  const matchedWords = mapping.filter((value) => value !== null).length;
  const totalWords = lyricWords.length;
  const coverage = totalWords === 0 ? 0 : matchedWords / totalWords;

  const lineTimes = new Map<number, { start: number | null; end: number | null }>();
  let alignedLines = 0;
  for (const lineIndex of lyricLineIndexes) {
    const indexes = wordsByLine.get(lineIndex) ?? [];
    let start: number | null = null;
    let end: number | null = null;
    for (const wordIndex of indexes) {
      const transcriptIndex = mapping[wordIndex];
      if (transcriptIndex === null || transcriptIndex === undefined) continue;
      const time = transcriptWords[transcriptIndex]!.startMs;
      if (start === null || time < start) start = time;
      if (end === null || time > end) end = time;
    }
    lineTimes.set(lineIndex, { start, end });
    if (start !== null) alignedLines += 1;
  }

  const totalLyricLines = lyricLineIndexes.size;
  const lineCoverage = totalLyricLines === 0 ? 0 : alignedLines / totalLyricLines;

  const nearestLineTime = (lineIndex: number, direction: -1 | 1): number | null => {
    for (let index = lineIndex + direction; index >= 0 && index < input.lines.length; index += direction) {
      const times = lineTimes.get(index);
      if (!times) continue;
      const value = direction === -1 ? times.end : times.start;
      if (value !== null) return value;
    }
    return null;
  };

  const updates: AlignUpdate[] = [];
  input.lines.forEach((line, lineIndex) => {
    if (line.chords.length === 0) return;
    const times = lineTimes.get(lineIndex);
    const wordIndexes = wordsByLine.get(lineIndex) ?? [];

    for (const chord of line.chords) {
      let timestamp: number | null = null;
      for (const wordIndex of wordIndexes) {
        const word = lyricWords[wordIndex]!;
        if (word.start < chord.column) continue;
        const transcriptIndex = mapping[wordIndex];
        if (transcriptIndex === null || transcriptIndex === undefined) continue;
        timestamp = transcriptWords[transcriptIndex]!.startMs;
        break;
      }
      if (timestamp === null && times) {
        if (times.start !== null) timestamp = times.start;
        else if (times.end !== null) timestamp = times.end;
      }
      if (timestamp === null) {
        const previous = nearestLineTime(lineIndex, -1);
        const next = nearestLineTime(lineIndex, 1);
        if (previous !== null && next !== null) timestamp = Math.round((previous + next) / 2);
        else timestamp = previous ?? next;
      }
      if (timestamp === null) continue;
      updates.push({ chordId: chord.id, timestampMs: timestamp, confidence: coverage });
    }
  });

  return {
    updates,
    coverage,
    lineCoverage,
    matchedWords,
    totalWords,
    alignedLines,
    totalLyricLines,
  };
}
