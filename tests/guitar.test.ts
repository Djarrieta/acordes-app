import { describe, expect, test } from "bun:test";
import { renderGuitarChordDiagram } from "../src/guitar/chords";
import { renderSong } from "../src/render/song";
import { chordDiagramRoute } from "../src/routes/chord-diagram";

describe("renderGuitarChordDiagram", () => {
  test("renders a guitar diagram for common and transposed chord names", () => {
    for (const chord of ["C", "Rem", "La#m7", "Sol7", "Do#/Fa#"]) {
      const diagram = renderGuitarChordDiagram(chord);
      expect(diagram).not.toBeNull();
      expect(diagram).toContain(`aria-label="Diagrama de guitarra para ${chord}"`);
      expect(diagram).toContain('class="finger-dot"');
    }
  });

  test("rejects chord names that cannot be interpreted safely", () => {
    expect(renderGuitarChordDiagram("<script>")).toBeNull();
    expect(renderGuitarChordDiagram("C".repeat(33))).toBeNull();
    expect(renderGuitarChordDiagram("Cfoo")).toBeNull();
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

  test("serves a diagram fragment for HTMX and reports unsupported chords", async () => {
    const response = chordDiagramRoute(
      new Request("http://localhost/chord-diagram?chord=Do%23"),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Diagrama de guitarra para Do#");

    const unsupported = chordDiagramRoute(
      new Request("http://localhost/chord-diagram?chord=N.C."),
    );
    expect(unsupported.status).toBe(422);
    expect(await unsupported.text()).toContain("No hay una digitación disponible");
  });
});
