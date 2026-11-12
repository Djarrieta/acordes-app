import { describe, expect, test } from "bun:test";
import { alignLyrics } from "../src/songs/enrichment/align";

describe("alignLyrics", () => {
  test("marks each line with the start of its first matched word", () => {
    const result = alignLyrics(
      {
        lines: [
          { id: "line-1", lyric: "brilla la mañana", chordCount: 2 },
          { id: "line-2", lyric: "cae la tarde", chordCount: 1 },
        ],
      },
      [
        { text: "Brilla", startMs: 1000 },
        { text: "la", startMs: 1500 },
        { text: "manana", startMs: 2000 },
        { text: "cae", startMs: 4000 },
        { text: "la", startMs: 4300 },
        { text: "tarde", startMs: 4600 },
      ],
    );

    expect(result.coverage).toBe(1);
    expect(result.lineCoverage).toBe(1);
    expect(result.updates).toEqual([
      { lineId: "line-1", startMs: 1000, confidence: 1 },
      { lineId: "line-2", startMs: 4000, confidence: 1 },
    ]);
  });

  test("tolerates small transcription errors and repeated choruses", () => {
    const result = alignLyrics(
      {
        lines: [
          { id: "line-1", lyric: "corazon herido", chordCount: 1 },
          { id: "line-2", lyric: "corazon herido", chordCount: 1 },
        ],
      },
      [
        { text: "corason", startMs: 500 },
        { text: "herido", startMs: 900 },
        { text: "corazon", startMs: 3000 },
        { text: "herido", startMs: 3400 },
      ],
    );

    expect(result.updates.find((update) => update.lineId === "line-1")?.startMs).toBe(500);
    expect(result.updates.find((update) => update.lineId === "line-2")?.startMs).toBe(3000);
  });

  test("steps back when the first words of a line were not matched", () => {
    const result = alignLyrics(
      { lines: [{ id: "line-1", lyric: "ay ay ay cantaba", chordCount: 0 }] },
      [{ text: "cantaba", startMs: 5000 }],
    );

    // 3 palabras sin casar * 300 ms por defecto
    expect(result.updates[0]?.startMs).toBe(4100);
  });

  test("ignores noise lines and reports low coverage", () => {
    const result = alignLyrics(
      {
        lines: [
          { id: "noise", lyric: "Corrección", chordCount: 0 },
          { id: "line-1", lyric: "palabras que no aparecen", chordCount: 1 },
        ],
      },
      [{ text: "otra cosa", startMs: 1000 }],
    );

    expect(result.totalLyricLines).toBe(1);
    expect(result.coverage).toBe(0);
    expect(result.updates).toHaveLength(0);
  });

  test("spreads chord-only lines between neighbours weighted by words", () => {
    const result = alignLyrics(
      {
        lines: [
          { id: "line-1", lyric: "primera linea", chordCount: 1 },
          { id: "line-2", lyric: "", chordCount: 1 },
          { id: "line-3", lyric: "tercera linea", chordCount: 1 },
        ],
      },
      [
        { text: "primera", startMs: 1000 },
        { text: "linea", startMs: 1200 },
        { text: "tercera", startMs: 5000 },
        { text: "linea", startMs: 5200 },
      ],
    );

    const interlude = result.updates.find((update) => update.lineId === "line-2");
    // 1000 + 4000 * 2/3
    expect(interlude?.startMs).toBe(3667);
    expect(interlude?.confidence).toBe(0);
  });

  test("skips empty break lines and never goes backwards", () => {
    const result = alignLyrics(
      {
        lines: [
          { id: "line-1", lyric: "primera linea", chordCount: 0 },
          { id: "break", lyric: "", chordCount: 0 },
          { id: "line-2", lyric: "segunda linea", chordCount: 0 },
        ],
      },
      [
        { text: "primera", startMs: 1000 },
        { text: "linea", startMs: 1200 },
        { text: "segunda", startMs: 3000 },
        { text: "linea", startMs: 3200 },
      ],
    );

    expect(result.updates.map((update) => update.lineId)).toEqual(["line-1", "line-2"]);
    const times = result.updates.map((update) => update.startMs);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});
