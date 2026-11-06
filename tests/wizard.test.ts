import { describe, expect, test } from "bun:test";
import { homePage } from "../src/routes/home";
import { renderSong } from "../src/render/song";

describe("song wizard", () => {
  test("places the selected song before search results", async () => {
    const page = await homePage().text();

    expect(page).toContain('aria-label="Pasos para encontrar una canción"');
    expect(page).toContain('data-wizard-step="3"');
    expect(page.indexOf('id="song-container"')).toBeLessThan(
      page.indexOf('id="search-results"'),
    );
  });

  test("renders the selected song title as a focus target", () => {
    const song = renderSong({
      id: "song-id",
      parsed: { title: "Canción de prueba", artist: "Artista", lines: [] },
      offset: 0,
      url: "https://acordes.lacuerda.net/artista/cancion.shtml",
    });

    expect(song).toContain('<h2 id="selected-song-title" tabindex="-1">Canción de prueba</h2>');
  });
});
