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
    expect(html).toContain('aria-label="Variante de digitación"');
    expect(html).toContain('<option value="0" selected>1 · Cejilla · traste 1</option>');
    expect(html).toContain('<option value="1"');
    expect(renderGuitarChordDiagram("Fa", 1)).toContain('<option value="1" selected>');
    expect(html).not.toContain('class="voicing-choice" aria-pressed=');
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
    expect(html).toContain('data-lyric-index="0"');
    expect(html).toContain('<span class="song-line-text"><span class="song-word">');
    expect(html).toContain(">Letra</span>");
    expect(html).toContain('data-chord-index="0"');
    expect(html).toContain('data-chord-name="Re"');
  });

  test("assigns an ordered marker target to each chord occurrence", () => {
    const html = renderSong({
      id: "song-id",
      offset: 0,
      url: "https://acordes.lacuerda.net/artista/cancion.shtml",
      parsed: {
        title: "Canción",
        artist: "Artista",
        lines: [
          { chords: [{ chord: "C", column: 0 }, { chord: "G", column: 8 }], lyric: "Primera línea" },
          { chords: [{ chord: "C", column: 0 }], lyric: "Segunda línea" },
        ],
      },
    });

    expect(html).toContain('data-chord-index="0" data-chord-name="Do"');
    expect(html).toContain('data-chord-index="1" data-chord-name="Sol"');
    expect(html).toContain('data-chord-index="2" data-chord-name="Do"');
  });

  test("serves selected voicing fragments and reports unknown chords", async () => {
    const response = chordDiagramRoute(
      new Request("http://localhost/chord-diagram?chord=Do%23"),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Diagrama de guitarra para Do#");

    const accompaniment = chordDiagramRoute(
      new Request("http://localhost/chord-diagram?chord=Fa&target=accompaniment-chord-viewer"),
    );
    expect(accompaniment.status).toBe(200);
    expect(await accompaniment.text()).toContain('hx-target="#accompaniment-chord-viewer"');

    const invalidTarget = chordDiagramRoute(
      new Request("http://localhost/chord-diagram?chord=Fa&target=other"),
    );
    expect(invalidTarget.status).toBe(400);

    const selected = chordDiagramRoute(
      new Request("http://localhost/chord-diagram?chord=Fa&position=1"),
    );
    expect(selected.status).toBe(200);
    expect(await selected.text()).toContain('<option value="1" selected>');

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
