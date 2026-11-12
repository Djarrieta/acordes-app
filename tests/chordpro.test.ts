import { describe, expect, test } from "bun:test";
import {
  parseChordProLine,
  serializeChordProLine,
  validateChordProLine,
} from "../src/parser/chordpro";

describe("parseChordProLine", () => {
  test("extracts chords and columns", () => {
    const parsed = parseChordProLine("[Am]Debajo de la [G]morera, [F]debajo");

    expect(parsed.lyric).toBe("Debajo de la morera, debajo");
    expect(parsed.chords).toEqual([
      { name: "Am", column: 0, index: 0 },
      { name: "G", column: 13, index: 1 },
      { name: "F", column: 21, index: 2 },
    ]);
  });

  test("no longer accepts timestamps inside chords", () => {
    const parsed = parseChordProLine("[Am@12.3]Debajo");
    expect(parsed.chords).toHaveLength(0);
    expect(validateChordProLine("[Am@12.3]Debajo", 20)).toBeNull();
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
      { name: "C", column: 0 },
      { name: "G", column: 8 },
    ]);
    expect(text).toBe("[C]primera [G]linea");
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
  test("accepts valid text", () => {
    expect(validateChordProLine("[Am]Debajo [G]la", 20)).not.toBeNull();
  });

  test("rejects unclosed brackets, bad names and bad timestamps", () => {
    expect(validateChordProLine("[D texto", 20)).toBeNull();
    expect(validateChordProLine("[<script>]texto", 20)).toBeNull();
    expect(validateChordProLine("[]texto", 20)).toBeNull();
  });

  test("rejects more chords than allowed", () => {
    expect(validateChordProLine("[C][D][E]", 2)).toBeNull();
  });
});
