import { describe, expect, test } from "bun:test";
import { transposeChord } from "../src/transpose/chords";

describe("transposeChord", () => {
  test("transposes roots and preserves chord qualities", () => {
    expect(transposeChord("C", 2)).toBe("Re");
    expect(transposeChord("Am7", 1)).toBe("La#m7");
    expect(transposeChord("Fadd9", 1)).toBe("Fa#add9");
    expect(transposeChord("Fmaj7", -2)).toBe("Re#maj7");
    expect(transposeChord("Gsus4", 2)).toBe("Lasus4");
    expect(transposeChord("Bdim", 1)).toBe("Dodim");
  });

  test("transposes slash chord roots and bass notes", () => {
    expect(transposeChord("Cmaj7/G", 2)).toBe("Remaj7/La");
    expect(transposeChord("Bb/D", 1)).toBe("Si/Re#");
  });

  test("keeps the original flat spelling at zero offset", () => {
    expect(transposeChord("Bb", 0)).toBe("Sib");
    expect(transposeChord("C#", 0)).toBe("Do#");
  });

  test("parses LaCuerda's Latin note names without treating them as chord qualities", () => {
    expect(transposeChord("FA", 0)).toBe("Fa");
    expect(transposeChord("DO", 0)).toBe("Do");
    expect(transposeChord("REm", 0)).toBe("Rem");
    expect(transposeChord("LAm", 0)).toBe("Lam");
    expect(transposeChord("SIb", 0)).toBe("Sib");
    expect(transposeChord("DO", 1)).toBe("Do#");
  });

  test("normalizes accidentals and negative offsets", () => {
    expect(transposeChord("Cb", 1)).toBe("Do");
    expect(transposeChord("C", -1)).toBe("Si");
    expect(transposeChord("F##", 0)).toBe("Fa##");
  });

  test("transposes slash chords written with Latin note names", () => {
    expect(transposeChord("FA/DO", 2)).toBe("Sol/Re");
  });

  test("leaves non-chords and parenthesized riffs untouched", () => {
    expect(transposeChord("N.C.", 2)).toBe("N.C.");
    expect(transposeChord("(B1)", 2)).toBe("(B1)");
    expect(transposeChord("(A#m)(B)", 2)).toBe("(A#m)(B)");
  });

  test("rejects fractional semitone offsets", () => {
    expect(() => transposeChord("C", 0.5)).toThrow(TypeError);
  });
});
