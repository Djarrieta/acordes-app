import { describe, expect, test } from "bun:test";
import { homePage } from "../src/routes/home";
import { renderSong } from "../src/render/song";

describe("song wizard", () => {
  test("combines search and song selection without a default query", async () => {
    const page = await homePage().text();

    expect(page).toContain('aria-label="Pasos de la canción"');
    expect(page).toContain('data-wizard-step="2"');
    expect(page).toContain(">Busca</span>");
    expect(page).toContain(">Reproducir</span>");
    expect(page).toContain('id="favorite-filter"');
    expect(page).not.toContain('value="De música ligera"');
    expect(page).not.toContain('hx-get="/search?q=');
    expect(page).not.toContain("Cargar una canción directamente");
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
    expect(song).toContain('data-favorite-toggle data-song-id="/artista/cancion.shtml"');
    expect(song).toContain('<svg aria-hidden="true" viewBox="0 0 24 24"');
    expect(song).toContain('aria-pressed="false"');
    expect(song).toContain('data-song-title="Canción de prueba"');
    expect(song).toContain('data-song-artist="Artista"');
    expect(song).not.toContain("source-link");
    expect(song).not.toContain("https://acordes.lacuerda.net/artista/cancion.shtml");
  });
});
