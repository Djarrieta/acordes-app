import { describe, expect, test } from "bun:test";
import { homePage } from "../src/routes/home";
import { renderSong } from "../src/render/song";

describe("song wizard", () => {
  test("combines search and song selection and starts with the default query", async () => {
    const page = await homePage().text();

    expect(page).toContain('aria-label="Pasos de la canción"');
    expect(page).toContain('data-wizard-step="2"');
    expect(page).toContain(">Busca</span>");
    expect(page).toContain(">Reproducir</span>");
    expect(page).toContain('value="De música ligera"');
    expect(page).toContain('hx-get="/search?q=De%20m%C3%BAsica%20ligera&amp;mode=songs"');
    expect(page).not.toContain("Cargar una canción directamente");
    expect(page).not.toContain("lacuerda");
    expect(page.indexOf('id="search-results"')).toBeLessThan(
      page.indexOf('id="song-container"'),
    );
  });

  test("renders the selected song title without revealing its source", () => {
    const song = renderSong({
      id: "song-id",
      parsed: { title: "Canción de prueba", artist: "Artista", lines: [] },
      offset: 0,
      url: "https://acordes.lacuerda.net/artista/cancion.shtml",
    });

    expect(song).toContain('<h2 id="selected-song-title" tabindex="-1">Canción de prueba</h2>');
    expect(song).not.toContain("source-link");
    expect(song).not.toContain("lacuerda");
  });
});
