import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase, setDb } from "../src/db";
import { createSong, getSong, listCandidates } from "../src/songs/songs.db";
import {
  enqueueVideoSearch,
  resetEnrichmentProviders,
  setEnrichmentProvidersForTests,
  waitForEnrichment,
} from "../src/songs/enrichment/enrichment.service";
import { parseJson3 } from "../src/songs/enrichment/youtube.transcript";
import type { Song } from "../src/songs/songs.model";

let db: Database;
let song: Song;

function seed(): Song {
  return createSong(db, {
    sourceKey: "/artista/cancion.shtml",
    sourceUrl: "https://acordes.lacuerda.net/artista/cancion.shtml",
    title: "Canción",
    artist: "Artista",
    lines: [{ lyric: "primera linea", chords: [{ name: "C", column: 0 }] }],
  });
}

beforeEach(() => {
  db = openDatabase(":memory:");
  setDb(db);
  resetEnrichmentProviders();
  song = seed();
});

afterEach(() => {
  resetEnrichmentProviders();
  setDb(null);
  db.close();
});

describe("video search", () => {
  test("marks the best candidate as the linked video", async () => {
    setEnrichmentProvidersForTests({
      transcript: async () => null,
      search: async () => [
        {
          videoId: "abcdefghijk",
          title: "Canción (video oficial)",
          channel: "Artista",
          durationMs: 180_000,
          rank: 0,
        },
        {
          videoId: "lmnopqrstuv",
          title: "Canción en vivo",
          channel: "Otro",
          durationMs: 200_000,
          rank: 1,
        },
      ],
    });

    enqueueVideoSearch(song.id, db);
    expect(getSong(db, song.id)!.videoStatus).toBe("searching");
    await waitForEnrichment();

    const updated = getSong(db, song.id)!;
    expect(updated.videoStatus).toBe("ready");
    expect(updated.video?.id).toBe("abcdefghijk");
    expect(updated.video?.title).toBe("Canción (video oficial)");
    expect(listCandidates(db, song.id)).toHaveLength(2);
  });

  test("reports a failure when YouTube returns no candidates", async () => {
    setEnrichmentProvidersForTests({
      transcript: async () => null,
      search: async () => [],
    });

    enqueueVideoSearch(song.id, db);
    await waitForEnrichment();

    const updated = getSong(db, song.id)!;
    expect(updated.videoStatus).toBe("failed");
    expect(updated.videoError).toContain("No se encontró");
    expect(updated.video).toBeNull();
  });

  test("does not fail the song when the provider throws", async () => {
    setEnrichmentProvidersForTests({
      transcript: async () => null,
      search: async () => {
        throw new Error("network down");
      },
    });

    enqueueVideoSearch(song.id, db);
    await waitForEnrichment();

    const updated = getSong(db, song.id)!;
    expect(updated.videoStatus).toBe("failed");
    expect(updated.videoError).toContain("No se pudo buscar");
  });
});

describe("automatic timestamps", () => {
  const transcript = {
    lang: "es",
    kind: "manual" as const,
    raw: "{}",
    words: [
      { text: "primera", startMs: 1000 },
      { text: "linea", startMs: 2000 },
    ],
  };

  test("generates timestamps automatically once the video is found", async () => {
    setEnrichmentProvidersForTests({
      search: async () => [
        {
          videoId: "abcdefghijk",
          title: "Canción (video oficial)",
          channel: "Artista",
          durationMs: 180_000,
          rank: 0,
        },
      ],
      transcript: async () => transcript,
    });

    enqueueVideoSearch(song.id, db);
    await waitForEnrichment();

    const updated = getSong(db, song.id)!;
    expect(updated.video?.id).toBe("abcdefghijk");
    expect(updated.timestampsStatus).toBe("ready");
    expect(updated.lines[0]!.chords[0]!.timestampMs).toBe(1000);
    expect(updated.lines[0]!.chords[0]!.timestampSource).toBe("auto");
  });

  test("tries the next candidate when the best has no transcript", async () => {
    setEnrichmentProvidersForTests({
      search: async () => [
        {
          videoId: "abcdefghijk",
          title: "Canción sin subtítulos",
          channel: "Artista",
          durationMs: 180_000,
          rank: 0,
        },
        {
          videoId: "lmnopqrstuv",
          title: "Canción con subtítulos",
          channel: "Artista",
          durationMs: 200_000,
          rank: 1,
        },
      ],
      transcript: async (videoId: string) => (videoId === "lmnopqrstuv" ? transcript : null),
    });

    enqueueVideoSearch(song.id, db);
    await waitForEnrichment();

    const updated = getSong(db, song.id)!;
    expect(updated.video?.id).toBe("lmnopqrstuv");
    expect(updated.timestampsStatus).toBe("ready");
    expect(listCandidates(db, song.id)).toHaveLength(2);
  });

  test("surfaces an error when no candidate has a usable transcript", async () => {
    setEnrichmentProvidersForTests({
      search: async () => [
        {
          videoId: "abcdefghijk",
          title: "Canción",
          channel: "Artista",
          durationMs: 180_000,
          rank: 0,
        },
      ],
      transcript: async () => null,
    });

    enqueueVideoSearch(song.id, db);
    await waitForEnrichment();

    const updated = getSong(db, song.id)!;
    expect(updated.video?.id).toBe("abcdefghijk");
    expect(updated.timestampsStatus).toBe("failed");
    expect(updated.timestampsError).toContain("subtítulos");
  });
});

describe("parseJson3", () => {
  test("splits segments into words with interpolated times", () => {
    const words = parseJson3(
      JSON.stringify({
        events: [
          {
            tStartMs: 1000,
            dDurationMs: 900,
            segs: [{ utf8: "hola mundo" }],
          },
          {
            tStartMs: 2500,
            dDurationMs: 400,
            segs: [{ utf8: "[Música]" }],
          },
          {
            tStartMs: 9000,
            dDurationMs: 400,
            segs: [{ utf8: "  hola   mundo " }],
          },
        ],
      }),
    );

    expect(words).toEqual([
      { text: "hola", startMs: 1000 },
      { text: "mundo", startMs: 1450 },
      { text: "hola", startMs: 9000 },
      { text: "mundo", startMs: 9200 },
    ]);
  });

  test("returns an empty list for malformed payloads", () => {
    expect(parseJson3("not json")).toEqual([]);
    expect(parseJson3("{}")).toEqual([]);
  });
});
