import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase, setDb } from "../src/db";
import {
  createSong,
  getSong,
  setChordTimestamp,
  setVideo,
} from "../src/songs/songs.db";
import {
  enqueueAlignment,
  resetEnrichmentProviders,
  setEnrichmentProvidersForTests,
  waitForEnrichment,
} from "../src/songs/enrichment/enrichment.service";
import type { Transcript } from "../src/songs/enrichment/youtube.transcript";
import type { Song } from "../src/songs/songs.model";

let db: Database;
let song: Song;

const transcript: Transcript = {
  lang: "es",
  kind: "manual",
  raw: "json3",
  words: [
    { text: "primera", startMs: 1000 },
    { text: "linea", startMs: 1200 },
    { text: "segunda", startMs: 3000 },
    { text: "linea", startMs: 3200 },
  ],
};

function seed(): Song {
  const created = createSong(db, {
    sourceKey: "/artista/cancion.shtml",
    sourceUrl: "https://acordes.lacuerda.net/artista/cancion.shtml",
    title: "Canción",
    artist: "Artista",
    lines: [
      { text: "[C]primera [G]linea" },
      { text: "[Am]segunda linea" },
    ],
  });
  setVideo(db, created.id, {
    id: "abcdefghijk",
    url: "https://www.youtube.com/watch?v=abcdefghijk",
    title: "Canción",
    channel: "Artista",
    durationMs: 180_000,
  });
  return getSong(db, created.id)!;
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

describe("automatic timestamps", () => {
  test("aligns the transcript and marks the song as ready", async () => {
    setEnrichmentProvidersForTests({ transcript: async () => transcript });

    enqueueAlignment(song.id, db);
    await waitForEnrichment();

    const updated = getSong(db, song.id)!;
    expect(updated.timestampsStatus).toBe("ready");
    expect(updated.timestampSource).toBe("auto");
    expect(updated.lines[0]!.chords.map((chord) => chord.timestampMs)).toEqual([1000, 1200]);
    expect(updated.lines[1]!.chords[0]!.timestampMs).toBe(3000);
    expect(updated.lines[0]!.text).toContain("[C@1.0]");
  });

  test("does not overwrite manual marks when regenerating", async () => {
    const chordId = song.lines[0]!.chords[0]!.id;
    setChordTimestamp(db, song.id, chordId, 777, "manual");
    setEnrichmentProvidersForTests({ transcript: async () => transcript });

    enqueueAlignment(song.id, db, true);
    await waitForEnrichment();

    const updated = getSong(db, song.id)!;
    expect(updated.lines[0]!.chords[0]!.timestampMs).toBe(777);
    expect(updated.lines[0]!.chords[0]!.timestampSource).toBe("manual");
    expect(updated.lines[0]!.chords[1]!.timestampMs).toBe(1200);
    expect(updated.timestampSource).toBe("mixed");
    expect(updated.timestampsStatus).toBe("ready");
  });

  test("fails gracefully when the video has no usable transcript", async () => {
    setEnrichmentProvidersForTests({ transcript: async () => null });

    enqueueAlignment(song.id, db);
    await waitForEnrichment();

    const updated = getSong(db, song.id)!;
    expect(updated.timestampsStatus).toBe("failed");
    expect(updated.timestampsError).toContain("subtítulos");
    expect(updated.timestampsAttempts).toBe(1);
    expect(updated.lines[0]!.chords[0]!.timestampMs).toBeNull();
  });

  test("does not apply timestamps when coverage is too low", async () => {
    setEnrichmentProvidersForTests({
      transcript: async () => ({
        lang: "es",
        kind: "manual",
        raw: "json3",
        words: [{ text: "nada", startMs: 1000 }],
      }),
    });

    enqueueAlignment(song.id, db);
    await waitForEnrichment();

    const updated = getSong(db, song.id)!;
    expect(updated.timestampsStatus).toBe("partial");
    expect(updated.lines[0]!.chords[0]!.timestampMs).toBeNull();
  });
});
