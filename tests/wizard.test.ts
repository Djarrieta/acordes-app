import { describe, expect, test } from "bun:test";
import { homePage } from "../src/routes/home";
import { renderSong } from "../src/render/song";

describe("song wizard", () => {
  test("combines search and song selection without a default query", async () => {
    const page = await homePage().text();

    expect(page).toContain('aria-label="Pasos de la canción"');
    expect(page).toContain('href="/public/styles.css?v=youtube-10"');
    expect(page).toContain('src="/public/youtube.js?v=9"');
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
      parsed: {
        title: "Canción de prueba",
        artist: "Artista",
        lines: [{ chords: [{ chord: "C", column: 0 }], lyric: "Letra de prueba" }],
      },
      offset: 0,
      url: "https://acordes.lacuerda.net/artista/cancion.shtml",
    });

    expect(song).toContain('<h2 id="selected-song-title" tabindex="-1">Canción de prueba</h2>');
    expect(song).toContain('class="song-back-button secondary" data-wizard-search');
    expect(song).toContain('data-favorite-toggle data-song-id="/artista/cancion.shtml"');
    expect(song).toContain('<svg aria-hidden="true" viewBox="0 0 24 24"');
    expect(song).toContain('aria-pressed="false"');
    expect(song).toContain('data-song-title="Canción de prueba"');
    expect(song).toContain('data-song-artist="Artista"');
    expect(song).toContain('data-song-id="/artista/cancion.shtml" data-offset="0"');
    expect(song).toContain('data-youtube-song="/artista/cancion.shtml"');
    expect(song).toContain('href="https://www.youtube.com/results?search_query=Artista%20Canci%C3%B3n%20de%20prueba"');
    expect(song).toContain("<details class=\"youtube-section\"");
    expect(song).not.toContain("<details class=\"youtube-section\" open");
    expect(song).toContain('data-chord-mark-toggle aria-pressed="false"');
    expect(song).toContain('data-chord-index="0"');
    expect(song.indexOf('id="accompaniment-chord-viewer"')).toBeLessThan(
      song.indexOf('data-youtube-player'),
    );
    expect(song).toContain('data-youtube-playback-controls hidden');
    expect(song).toContain('data-youtube-play disabled aria-label="Reproducir audio"');
    expect(song).toContain('data-youtube-progress min="0" max="0" step="0.1"');
    expect(song).toContain('aria-label="Posición de la canción"');
    expect(song).toContain("data-youtube-progress-current");
    expect(song).toContain("data-youtube-progress-duration");
    expect(song).toContain("data-youtube-progress-marks");
    expect(song).not.toContain("data-lyric-mark");
    expect(song).not.toContain("source-link");
    expect(song).not.toContain("https://acordes.lacuerda.net/artista/cancion.shtml");
  });

  test("renders the saved transposition offset in the song card", () => {
    const song = renderSong({
      id: "song-id",
      parsed: {
        title: "Canción de prueba",
        artist: "Artista",
        lines: [{ chords: [{ chord: "C", column: 0 }], lyric: "Letra" }],
      },
      offset: 3,
      url: "https://acordes.lacuerda.net/artista/cancion.shtml",
    });

    expect(song).toContain('data-song-id="/artista/cancion.shtml" data-offset="3"');
    expect(song).toContain("Re#");
    expect(song).toContain("+3 semitonos");
  });
});
