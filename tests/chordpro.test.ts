import { describe, expect, test } from "bun:test";
import {
  parseChordProLine,
  serializeChordProLine,
  setChordProTimestamp,
  stripChordProTimestamps,
  validateChordProLine,
} from "../src/parser/chordpro";

describe("parseChordProLine", () => {
  test("extracts chords, columns and timestamps", () => {
    const parsed = parseChordProLine("[Am@12.3]Debajo de la [G]morera, [F@15.0]debajo");

    expect(parsed.lyric).toBe("Debajo de la morera, debajo");
    expect(parsed.chords).toEqual([
      { name: "Am", column: 0, timestampMs: 12300, timestampManual: false, index: 0 },
      { name: "G", column: 13, timestampMs: null, timestampManual: false, index: 1 },
      { name: "F", column: 21, timestampMs: 15000, timestampManual: false, index: 2 },
    ]);
  });

  test("treats the ! suffix as a manual mark", () => {
    const parsed = parseChordProLine("[Am@12.3!]Debajo");
    expect(parsed.chords[0]!.timestampMs).toBe(12300);
    expect(parsed.chords[0]!.timestampManual).toBe(true);
  });

  test("keeps chords inside words and unescapes brackets", () => {
    const parsed = parseChordProLine("Pa[Am]ra \\[literal]");
    expect(parsed.lyric).toBe("Para [literal]");
    expect(parsed.chords[0]!.column).toBe(2);
  });

  test("keeps invalid tokens as literal text", () => {
    const parsed = parseChordProLine("[<script>]texto");
    expect(parsed.lyric).toBe("[<script>]texto");
    expect(parsed.chords).toHaveLength(0);
  });
});

describe("serializeChordProLine", () => {
  test("round-trips through parse", () => {
    const text = serializeChordProLine("primera linea", [
      { name: "C", column: 0, timestampMs: 1000 },
      { name: "G", column: 8 },
    ]);
    expect(text).toBe("[C@1.0]primera [G]linea");
    expect(parseChordProLine(text).lyric).toBe("primera linea");
  });

  test("supports multiple chords at one column and chord-only lines", () => {
    const text = serializeChordProLine("texto", [
      { name: "F", column: 0 },
      { name: "C", column: 0 },
    ]);
    expect(text).toBe("[F][C]texto");
    expect(serializeChordProLine("", [{ name: "A", column: 0 }])).toBe("[A]");
  });

  test("appends chords beyond the end of the lyric", () => {
    expect(serializeChordProLine("hola", [{ name: "A", column: 99 }])).toBe("hola[A]");
  });
});

describe("validateChordProLine", () => {
  test("accepts valid text with timestamps", () => {
    expect(validateChordProLine("[Am@12.3]Debajo [G]la", 20)).not.toBeNull();
  });

  test("rejects unclosed brackets, bad names and bad timestamps", () => {
    expect(validateChordProLine("[D texto", 20)).toBeNull();
    expect(validateChordProLine("[<script>]texto", 20)).toBeNull();
    expect(validateChordProLine("[D@abc]texto", 20)).toBeNull();
    expect(validateChordProLine("[]texto", 20)).toBeNull();
  });

  test("rejects more chords than allowed", () => {
    expect(validateChordProLine("[C][D][E]", 2)).toBeNull();
  });
});

describe("setChordProTimestamp / stripChordProTimestamps", () => {
  test("rewrites a single token", () => {
    const next = setChordProTimestamp("[C]primera [G]linea", 1, 42000, true);
    expect(next).toBe("[C]primera [G@42.0!]linea");
    expect(setChordProTimestamp("[C]primera", 5, 1000)).toBeNull();
  });

  test("strips all timestamps or only automatic ones", () => {
    expect(stripChordProTimestamps("[C@1.0]a [G@2.0!]b")).toBe("[C]a [G]b");
    expect(stripChordProTimestamps("[C@1.0]a [G@2.0!]b", true)).toBe("[C]a [G@2.0!]b");
  });
});
