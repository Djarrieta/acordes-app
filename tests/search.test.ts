import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  parseArtistSearchHtml,
  parseArtistSongsHtml,
  parseSongSearchHtml,
} from "../src/parser/search";
import { renderSongResults } from "../src/render/search";

async function fixture(name: string): Promise<string> {
  return readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

describe("parseSongSearchHtml", () => {
  test("pairs each result with the exact song file from LaCuerda", async () => {
    const songs = parseSongSearchHtml(await fixture("search-songs.html"));

    expect(songs).toHaveLength(12);
    expect(songs[0]).toEqual({
      title: "Cuando pase el temblor",
      artist: "Soda Stereo",
      artistSlug: "soda_stereo",
      url: "https://acordes.lacuerda.net/soda_stereo/cuando_pase_el_temblor.shtml",
    });
    expect(songs[1]).toEqual({
      title: "Cuando pase el temblor (unplugged)",
      artist: "Soda Stereo",
      artistSlug: "soda_stereo",
      url: "https://acordes.lacuerda.net/soda_stereo/cuando_pase_el_temblor_unplugged.shtml",
    });
    expect(songs.at(-1)).toEqual({
      title: "Cuando todo pase amor",
      artist: "Norecomendable",
      artistSlug: "norecomendable",
      url: "https://acordes.lacuerda.net/norecomendable/cuando_todo_pase_amor.shtml",
    });
  });
});

describe("parseArtistSearchHtml", () => {
  test("extracts artist names, slugs and song counts", async () => {
    const artists = parseArtistSearchHtml(await fixture("search-artists.html"));

    expect(artists).toEqual([
      { name: "Egon Soda", slug: "egon_soda", songCount: 4 },
      { name: "Soda Stereo", slug: "soda_stereo", songCount: 89 },
    ]);
  });
});

describe("parseArtistSongsHtml", () => {
  test("builds song URLs from the artist page", async () => {
    const result = parseArtistSongsHtml(await fixture("artist-soda.html"), "soda_stereo");

    expect(result.name).toBe("Soda Stereo");
    expect(result.songs.length).toBeGreaterThan(50);
    expect(result.songs[0]).toEqual({
      title: "1990",
      artist: "Soda Stereo",
      artistSlug: "soda_stereo",
      url: "https://acordes.lacuerda.net/soda_stereo/1990.shtml",
    });
    expect(result.songs).toContainEqual({
      title: "De Música Ligera",
      artist: "Soda Stereo",
      artistSlug: "soda_stereo",
      url: "https://acordes.lacuerda.net/soda_stereo/de_musica_ligera.shtml",
    });
  });

  describe("renderSongResults", () => {
    test("renders song metadata for the favorites list without hearts", () => {
      const results = renderSongResults("prueba", [
        {
          title: "Canción de prueba",
          artist: "Artista",
          artistSlug: "artista",
          url: "https://acordes.lacuerda.net/artista/cancion.shtml",
        },
      ]);

      expect(results).toContain('data-song-id="/artista/cancion.shtml"');
      expect(results).toContain('data-song-title="Canción de prueba"');
      expect(results).toContain('data-song-artist="Artista"');
      expect(results).not.toContain("data-favorite-toggle");
      expect(results).not.toContain("favorite-filter");
    });
  });
});
