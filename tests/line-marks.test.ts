import { describe, expect, test } from "bun:test";
import { renderSong } from "../src/render/song";
import { makeSong } from "./helpers";

describe("line timestamp rendering", () => {
  test("exposes the line mark and chord columns for client-side estimation", () => {
    const html = renderSong(
      makeSong({
        lines: [
          {
            id: "line-1",
            position: 0,
            text: "[C]Primera [G]línea",
            lyric: "Primera línea",
            isManual: false,
            isBreak: false,
            startMs: 65_500,
            startSource: "manual",
            startConfidence: null,
            chords: [
              { id: "c1", position: 0, name: "C", column: 0 },
              { id: "c2", position: 1, name: "G", column: 8 },
            ],
          },
        ],
      }),
      0,
    );

    expect(html).toContain('data-line-start="65500"');
    expect(html).toContain('data-lyric-length="13"');
    expect(html).toContain('<span class="song-line-time" aria-hidden="true">1:05</span>');
    expect(html).toContain('data-chord-column="8"');
    expect(html).not.toContain("data-chord-time");
  });
});
