import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { parseLacuerdaHtml } from "../src/parser/lacuerda";

const fixtureUrl = new URL(
  "https://acordes.lacuerda.net/los_chalchaleros/tierra_mala.shtml",
);

describe("parseLacuerdaHtml", () => {
  test("parses lyrics, chord positions, and skips tabs", async () => {
    const html = await readFile(new URL("./fixtures/tierra-mala.html", import.meta.url), "utf8");
    const song = parseLacuerdaHtml(html, fixtureUrl);

    expect(song.title).toBe("Tierra Mala");
    expect(song.artist).toBe("Los Chalchaleros");
    expect(song.lines).toHaveLength(4);
    expect(song.lines[0]).toEqual({
      chords: [
        { chord: "C", column: 0 },
        { chord: "G7", column: 14 },
      ],
      lyric: "Tierra mala, tierra mía",
    });
    expect(song.lines[1]).toEqual({
      chords: [
        { chord: "Am", column: 0 },
        { chord: "F", column: 14 },
      ],
      lyric: "cuánto cuesta regresar",
    });
    expect(song.lines[2]).toEqual({ chords: [], lyric: "" });
    expect(song.lines[3]).toEqual({
      chords: [{ chord: "D7", column: 0 }],
      lyric: "con mi canto por el aire",
    });
  });

  test("reports a missing song block", () => {
    expect(() => parseLacuerdaHtml("<html></html>", fixtureUrl)).toThrow(
      "No se encontró el bloque",
    );
  });

  test("prefers the structured song header for title and artist", () => {
    const html = `<div id=tH1><h1><a href='cancion'>Cuando pase el temblor</a></h1><h2><a href=./>Soda Stereo</a></h2></div>
<div id=t_body><PRE>
<A>C</A>
Letra
</PRE></div>`;

    expect(parseLacuerdaHtml(html, fixtureUrl)).toMatchObject({
      title: "Cuando pase el temblor",
      artist: "Soda Stereo",
    });
  });
});
