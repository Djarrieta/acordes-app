import { describe, expect, test } from "bun:test";
import { alignLyrics } from "../src/songs/enrichment/align";

describe("alignLyrics", () => {
  test("maps each chord to the first word at or after its column", () => {
    const result = alignLyrics(
      {
        lines: [
          {
            id: "line-1",
            lyric: "brilla la mañana",
            chords: [
              { id: "chord-1", column: 0 },
              { id: "chord-2", column: 7 },
            ],
          },
        ],
      },
      [
        { text: "Brilla", startMs: 1000 },
        { text: "la", startMs: 1500 },
        { text: "manana", startMs: 2000 },
      ],
    );

    expect(result.coverage).toBe(1);
    expect(result.lineCoverage).toBe(1);
    expect(result.updates).toEqual([
      { chordId: "chord-1", timestampMs: 1000, confidence: 1 },
      { chordId: "chord-2", timestampMs: 1500, confidence: 1 },
    ]);
  });

  test("tolerates small transcription errors and repeated choruses", () => {
    const result = alignLyrics(
      {
        lines: [
          {
            id: "line-1",
            lyric: "corazon herido",
            chords: [{ id: "chord-1", column: 0 }],
          },
          {
            id: "line-2",
            lyric: "corazon herido",
            chords: [{ id: "chord-2", column: 0 }],
          },
        ],
      },
      [
        { text: "corason", startMs: 500 },
        { text: "herido", startMs: 900 },
        { text: "corazon", startMs: 3000 },
        { text: "herido", startMs: 3400 },
      ],
    );

    expect(result.updates.find((update) => update.chordId === "chord-1")?.timestampMs).toBe(500);
    expect(result.updates.find((update) => update.chordId === "chord-2")?.timestampMs).toBe(3000);
  });

  test("ignores noise lines and reports low coverage", () => {
    const result = alignLyrics(
      {
        lines: [
          { id: "noise", lyric: "Corrección", chords: [] },
          {
            id: "line-1",
            lyric: "palabras que no aparecen",
            chords: [{ id: "chord-1", column: 0 }],
          },
        ],
      },
      [{ text: "otra cosa", startMs: 1000 }],
    );

    expect(result.totalLyricLines).toBe(1);
    expect(result.coverage).toBe(0);
    expect(result.updates).toHaveLength(0);
  });

  test("falls back to neighbouring line times for chord-only lines", () => {
    const result = alignLyrics(
      {
        lines: [
          { id: "line-1", lyric: "primera linea", chords: [{ id: "chord-1", column: 0 }] },
          { id: "line-2", lyric: "", chords: [{ id: "chord-2", column: 0 }] },
          { id: "line-3", lyric: "tercera linea", chords: [{ id: "chord-3", column: 0 }] },
        ],
      },
      [
        { text: "primera", startMs: 1000 },
        { text: "linea", startMs: 1200 },
        { text: "tercera", startMs: 5000 },
        { text: "linea", startMs: 5200 },
      ],
    );

    const interlude = result.updates.find((update) => update.chordId === "chord-2");
    expect(interlude?.timestampMs).toBe(3100);
  });
});
