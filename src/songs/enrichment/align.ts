import type { TranscriptWord } from "./youtube.transcript";

export type AlignLine = { id: string; lyric: string; chordCount: number };
export type AlignInput = { lines: AlignLine[] };

export type AlignUpdate = { lineId: string; startMs: number; confidence: number };
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
  normalized: string;
};

const DEFAULT_WORD_MS = 300;
const MAX_LEAD_MS = 1500;

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
      lyricWords.push({ lineIndex, normalized });
      const list = wordsByLine.get(lineIndex) ?? [];
      list.push(wordIndex);
      wordsByLine.set(lineIndex, list);
    }
  });

  const mapping = alignSequences(lyricWords, transcriptWords);
  const matchedWords = mapping.filter((value) => value !== null).length;
  const totalWords = lyricWords.length;
  const coverage = totalWords === 0 ? 0 : matchedWords / totalWords;

  type LineTiming = {
    start: number | null;
    confidence: number;
    words: number;
    interpolated: boolean;
  };
  const timings: (LineTiming | null)[] = input.lines.map((line, lineIndex) => {
    // Los saltos de línea (sin letra ni acordes) no participan.
    if (!line.lyric.trim() && line.chordCount === 0) return null;
    const indexes = wordsByLine.get(lineIndex) ?? [];
    const hits: { time: number; position: number }[] = [];
    indexes.forEach((wordIndex, position) => {
      const transcriptIndex = mapping[wordIndex];
      if (transcriptIndex === null || transcriptIndex === undefined) return;
      hits.push({ time: transcriptWords[transcriptIndex]!.startMs, position });
    });
    const matched = hits.length;
    const firstMatch = hits[0];
    const lastMatch = hits[hits.length - 1];
    if (!firstMatch || !lastMatch) {
      return { start: null, confidence: 0, words: Math.max(indexes.length, 1), interpolated: false };
    }
    // Si las primeras palabras no casaron, retrocede lo que habrían tardado.
    let wordMs = DEFAULT_WORD_MS;
    if (lastMatch.position > firstMatch.position && lastMatch.time > firstMatch.time) {
      wordMs = (lastMatch.time - firstMatch.time) / (lastMatch.position - firstMatch.position);
    }
    const lead = Math.min(firstMatch.position * wordMs, MAX_LEAD_MS);
    return {
      start: Math.max(0, Math.round(firstMatch.time - lead)),
      confidence: indexes.length === 0 ? 0 : matched / indexes.length,
      words: Math.max(indexes.length, 1),
      interpolated: false,
    };
  });

  const totalLyricLines = lyricLineIndexes.size;
  let alignedLines = 0;
  for (const lineIndex of lyricLineIndexes) {
    if (timings[lineIndex]?.start !== null && timings[lineIndex]?.start !== undefined) alignedLines += 1;
  }
  const lineCoverage = totalLyricLines === 0 ? 0 : alignedLines / totalLyricLines;

  // Las líneas sin coincidencia (solo acordes, intros) se reparten entre sus
  // vecinas con marca, ponderadas por número de palabras.
  let previousIndex: number | null = null;
  for (let index = 0; index < timings.length; index += 1) {
    const timing = timings[index];
    if (!timing) continue;
    if (timing.start !== null) {
      previousIndex = index;
      continue;
    }
    let runEnd = index;
    let nextIndex: number | null = null;
    for (let probe = index; probe < timings.length; probe += 1) {
      const candidate = timings[probe];
      if (!candidate) continue;
      if (candidate.start !== null) {
        nextIndex = probe;
        break;
      }
      runEnd = probe;
    }
    if (previousIndex === null || nextIndex === null) {
      index = runEnd;
      continue;
    }
    const before = timings[previousIndex]!;
    const after = timings[nextIndex]!;
    const run = timings.slice(index, runEnd + 1).filter((item): item is LineTiming => item !== null);
    const total = before.words + run.reduce((sum, item) => sum + item.words, 0);
    let accumulated = before.words;
    for (const item of run) {
      item.start = Math.round(before.start! + ((after.start! - before.start!) * accumulated) / total);
      item.interpolated = true;
      accumulated += item.words;
    }
    index = runEnd;
  }

  // Las marcas nunca retroceden.
  let floor = 0;
  const updates: AlignUpdate[] = [];
  input.lines.forEach((line, lineIndex) => {
    const timing = timings[lineIndex];
    if (!timing || timing.start === null) return;
    const startMs = Math.max(timing.start, floor);
    floor = startMs;
    updates.push({ lineId: line.id, startMs, confidence: timing.interpolated ? 0 : timing.confidence });
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
