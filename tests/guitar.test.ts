import { describe, expect, test } from "bun:test";
import { renderGuitarChordDiagram } from "../src/guitar/chords";
import { renderSong } from "../src/render/song";
import { chordDiagramRoute } from "../src/routes/chord-diagram";

describe("renderGuitarChordDiagram", () => {
  test("uses known guitar voicings for common and transposed chord names", () => {
    for (const chord of ["C", "Rem", "La#m7", "Sol7", "Do#"]) {
      const diagram = renderGuitarChordDiagram(chord);
      expect(diagram).not.toBeNull();
      expect(diagram).toContain(`aria-label="Diagrama de guitarra para ${chord}"`);
      expect(diagram).toContain('class="finger-dot"');
      expect(diagram).toContain("Digitación conocida");
    }
    for (const chord of ["Fa", "Sib", "Do", "Rem", "Lam"]) {
      expect(renderGuitarChordDiagram(chord)).not.toBeNull();
    }
  });

  test("does not invent a position for unsupported chord names or qualities", () => {
    expect(renderGuitarChordDiagram("<script>")).toBeNull();
    expect(renderGuitarChordDiagram("C".repeat(33))).toBeNull();
    expect(renderGuitarChordDiagram("Cfoo")).toBeNull();
    expect(renderGuitarChordDiagram("C/G")).not.toBeNull();
    expect(renderGuitarChordDiagram("C/E")).toBeNull();
    expect(renderGuitarChordDiagram("C/B")).toBeNull();
  });

  test("offers multiple database positions ordered for easier play", () => {
    const html = renderGuitarChordDiagram("Fa");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("1 · Cejilla · traste 1");
    expect(html).toContain("Cejilla");
    expect(renderGuitarChordDiagram("Fa", 1)).toContain('aria-pressed="false"');
  });

  test("makes the displayed, transposed chord selectable in the song", () => {
    const html = renderSong({
      id: "song-id",
      offset: 2,
      url: "https://acordes.lacuerda.net/artista/cancion.shtml",
      parsed: {
        title: "Canción",
        artist: "Artista",
        lines: [{ chords: [{ chord: "C", column: 0 }], lyric: "Letra" }],
      },
    });

    expect(html).toContain('id="chord-viewer"');
    expect(html).toContain('<dialog id="chord-modal"');
    expect(html).toContain('hx-get="/chord-diagram?chord=Re"');
    expect(html).toContain('aria-label="Ver diagrama de Re"');
    expect(html).toContain("\nLetra\n");
  });

  test("serves selected voicing fragments and reports unknown chords", async () => {
    const response = chordDiagramRoute(
      new Request("http://localhost/chord-diagram?chord=Do%23"),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Diagrama de guitarra para Do#");

    const selected = chordDiagramRoute(
      new Request("http://localhost/chord-diagram?chord=Fa&position=1"),
    );
    expect(selected.status).toBe(200);
    expect(await selected.text()).toContain('aria-pressed="false"');

    const unsupported = chordDiagramRoute(
      new Request("http://localhost/chord-diagram?chord=N.C."),
    );
    expect(unsupported.status).toBe(422);
    expect(await unsupported.text()).toContain("No encontré digitaciones conocidas");

    const invalidPosition = chordDiagramRoute(
      new Request("http://localhost/chord-diagram?chord=C&position=-1"),
    );
    expect(invalidPosition.status).toBe(400);
  });
});
