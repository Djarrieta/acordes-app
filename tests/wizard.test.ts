import { describe, expect, test } from "bun:test";
import { homePage } from "../src/routes/home";
import { renderSong } from "../src/render/song";
import { makeSong } from "./helpers";

describe("song wizard", () => {
  test("combines search and song selection without a default query", async () => {
    const page = await homePage().text();

    expect(page).toContain('aria-label="Pasos de la canción"');
    expect(page).toContain('href="/public/styles.css?v=editor-4"');
    expect(page).toContain('src="/public/youtube.js?v=20"');
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
    const song = renderSong(
      makeSong({
        title: "Canción de prueba",
        lines: [
          {
            id: "line-1",
            position: 0,
            text: "[C]Letra de prueba",
            lyric: "Letra de prueba",
            isManual: false,
            isBreak: false,
            chords: [
              {
                id: "chord-1",
                position: 0,
                name: "C",
                column: 0,
                timestampMs: null,
                timestampSource: "none",
                confidence: null,
              },
            ],
          },
        ],
      }),
      0,
    );

    expect(song).toContain('<h2 id="selected-song-title" tabindex="-1">Canción de prueba</h2>');
    expect(song).toContain('class="song-back-button secondary" data-wizard-search');
    expect(song).toContain("←</button>");
    expect(song).toContain("aria-label=\"Atrás\"");
    expect(song).not.toContain("Ver canción");
    expect(song).toContain('data-favorite-toggle data-song-id="/artista/cancion.shtml"');
    expect(song).toContain('<svg aria-hidden="true" viewBox="0 0 24 24"');
    expect(song).toContain('aria-pressed="false"');
    expect(song).toContain('data-song-title="Canción de prueba"');
    expect(song).toContain('data-song-artist="Artista"');
    expect(song).toContain('data-song-id="song-id" data-source-key="/artista/cancion.shtml" data-offset="0"');
    expect(song).toContain('data-view="player"');
    expect(song).toContain('data-view-panel="player"');
    expect(song).toContain('data-view-panel="options"');
    expect(song).toContain('data-view-panel="editor"');
    expect(song).not.toContain('data-view-panel="loader"');
    expect(song).toContain('data-song-view="options"');
    expect(song).toContain("Opciones");
    expect(song).toContain('data-song-edit');
    expect(song).toContain("Editar acordes");
    expect(song).not.toContain('id="song-editor"');
    expect(song).not.toContain('class="song-options"');
    expect(song.indexOf('data-view-panel="options"')).toBeLessThan(song.indexOf("data-youtube-song"));
    expect(song).toContain('id="chord-modal"');
    expect(song).toContain('data-youtube-song="song-id"');
    expect(song).toContain('href="https://www.youtube.com/results?search_query=Artista%20Canci%C3%B3n%20de%20prueba"');
    expect(song).toContain('class="song-view song-view-player" data-view-panel="player"');
    expect(song).toContain('class="song-view song-view-options" data-view-panel="options"');
    expect(song).toContain('data-chord-mark-toggle aria-pressed="false"');
    expect(song).toContain('data-chord-index="0"');
    expect(song).toContain('<span class="song-word">');
    expect(song).toContain('<span class="song-word-chords">');
    expect(song.indexOf('id="accompaniment-chord-viewer"')).toBeLessThan(
      song.indexOf('data-youtube-player'),
    );
    expect(song).toContain('data-youtube-playback-controls hidden');
    expect(song).toContain('data-youtube-play disabled aria-label="Reproducir"');
    expect(song).toContain('data-youtube-progress min="0" max="0" step="0.1"');
    expect(song).toContain('aria-label="Posición de la canción"');
    expect(song).toContain("data-youtube-progress-current");
    expect(song).toContain("data-youtube-progress-duration");
    expect(song).not.toContain("data-lyric-mark");
    expect(song).not.toContain("source-link");
    expect(song).not.toContain("https://acordes.lacuerda.net/artista/cancion.shtml");
  });

  test("warns in the player when automatic timestamps fail", () => {
    const song = renderSong(
      makeSong({
        timestampsStatus: "partial",
        timestampsError: "Cobertura baja (23 % de palabras, 69 % de líneas). Revisa la letra o marca los acordes a mano.",
        lines: [
          {
            id: "line-1",
            position: 0,
            text: "[C]Letra",
            lyric: "Letra",
            isManual: false,
            isBreak: false,
            chords: [
              {
                id: "chord-1",
                position: 0,
                name: "C",
                column: 0,
                timestampMs: null,
                timestampSource: "none",
                confidence: null,
              },
            ],
          },
        ],
      }),
      0,
    );

    expect(song).toContain('class="timestamps-warning"');
    expect(song).toContain("Cobertura baja (23 %");
    expect(song).toContain('data-song-view="options">Ir a Opciones para corregirlo');
    expect(song.indexOf('class="timestamps-warning"')).toBeLessThan(song.indexOf("song-lyrics"));
  });

  test("renders the saved transposition offset in the song card", () => {
    const song = renderSong(
      makeSong({
        title: "Canción de prueba",
        lines: [
          {
            id: "line-1",
            position: 0,
            text: "[C]Letra",
            lyric: "Letra",
            isManual: false,
            isBreak: false,
            chords: [
              {
                id: "chord-1",
                position: 0,
                name: "C",
                column: 0,
                timestampMs: null,
                timestampSource: "none",
                confidence: null,
              },
            ],
          },
        ],
      }),
      3,
    );

    expect(song).toContain('data-song-id="song-id" data-source-key="/artista/cancion.shtml" data-offset="3"');
    expect(song).toContain("Re#");
    expect(song).toContain("+3 semitonos");
  });
});
