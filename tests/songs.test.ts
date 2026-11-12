import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase, setDb } from "../src/db";
import {
  applyAutoTimestamps,
  clearAllTimestamps,
  createSong,
  findSongIdBySourceKey,
  getSong,
  isSongLiked,
  listLikedSongs,
  listPreferences,
  setPreferredOffset,
  setSongLike,
  listCandidates,
  refreshNonManualLines,
  replaceCandidates,
  setLineStart,
  setVideo,
  replaceSongLines,
} from "../src/songs/songs.db";

let db: Database;

function seed() {
  return createSong(db, {
    sourceKey: "/artista/cancion.shtml",
    sourceUrl: "https://acordes.lacuerda.net/artista/cancion.shtml",
    title: "Canción",
    artist: "Artista",
    lines: [
      { text: "[C]primera [G]linea" },
      { text: "[Am]segunda linea" },
    ],
  });
}

beforeEach(() => {
  db = openDatabase(":memory:");
  setDb(db);
});

afterEach(() => {
  setDb(null);
  db.close();
});

describe("song repository", () => {
  test("stores lines and chords and finds the song by source key", () => {
    const song = seed();

    expect(findSongIdBySourceKey(db, "/artista/cancion.shtml")).toBe(song.id);
    expect(findSongIdBySourceKey(db, "/artista/otra.shtml")).toBeNull();
    expect(song.lines).toHaveLength(2);
    expect(song.lines[0]!.text).toBe("[C]primera [G]linea");
    expect(song.lines[0]!.lyric).toBe("primera linea");
    expect(song.lines[0]!.chords.map((chord) => chord.name)).toEqual(["C", "G"]);
    expect(song.lines[0]!.chords[1]!.column).toBe(8);
    expect(song.version).toBe(1);
  });

  test("keeps manual line marks when applying automatic ones", () => {
    const song = seed();
    const first = song.lines[0]!.id;
    const second = song.lines[1]!.id;

    setLineStart(db, song.id, first, 900, "manual");
    applyAutoTimestamps(db, song.id, [
      { lineId: first, startMs: 1000, confidence: 0.9 },
      { lineId: second, startMs: 2000, confidence: 0.9 },
    ]);

    const updated = getSong(db, song.id)!;
    expect(updated.lines[0]!.startMs).toBe(900);
    expect(updated.lines[0]!.startSource).toBe("manual");
    expect(updated.lines[1]!.startMs).toBe(2000);
    expect(updated.lines[1]!.startSource).toBe("auto");
    expect(updated.timestampSource).toBe("mixed");
    expect(updated.lines[0]!.text).toBe("[C]primera [G]linea");
  });

  test("clearAllTimestamps removes every mark when the video changes", () => {
    const song = seed();

    setLineStart(db, song.id, song.lines[0]!.id, 900, "manual");
    setLineStart(db, song.id, song.lines[1]!.id, 2000, "auto");
    clearAllTimestamps(db, song.id);

    const updated = getSong(db, song.id)!;
    expect(updated.lines[0]!.startMs).toBeNull();
    expect(updated.lines[1]!.startMs).toBeNull();
    expect(updated.lines[0]!.startSource).toBe("none");
    expect(updated.timestampSource).toBe("none");
    expect(updated.timestampsStatus).toBe("none");
    expect(updated.timestampsAttempts).toBe(0);
  });

  test("replaceSongLines keeps ids and marks of unchanged and edited lines", () => {
    const song = seed();
    const [first, second] = song.lines;
    setLineStart(db, song.id, first!.id, 1500, "manual");
    setLineStart(db, song.id, second!.id, 4000, "manual");

    const result = replaceSongLines(db, song.id, [
      "[D]primera [G]linea",
      "",
      "[Am]segunda linea",
      "[E]linea nueva",
    ]);

    const updated = getSong(db, song.id)!;
    expect(updated.lines.map((line) => line.text)).toEqual([
      "[D]primera [G]linea",
      "",
      "[Am]segunda linea",
      "[E]linea nueva",
    ]);
    expect(updated.lines.map((line) => line.position)).toEqual([0, 1, 2, 3]);
    // La primera línea cambió de acorde pero conserva id y marca.
    expect(updated.lines[0]!.id).toBe(first!.id);
    expect(updated.lines[0]!.startMs).toBe(1500);
    expect(updated.lines[0]!.isManual).toBe(true);
    // La segunda no cambió: mismo id y marca.
    expect(updated.lines[2]!.id).toBe(second!.id);
    expect(updated.lines[2]!.startMs).toBe(4000);
    expect(updated.lines[1]!.startMs).toBeNull();
    expect(updated.lines[3]!.startMs).toBeNull();
    expect(result).toEqual({ kept: 2, added: 2, removed: 0 });
  });

  test("replaceSongLines removes deleted lines and renumbers", () => {
    const song = seed();
    const result = replaceSongLines(db, song.id, ["[Am]segunda linea"]);

    const updated = getSong(db, song.id)!;
    expect(updated.lines).toHaveLength(1);
    expect(updated.lines[0]!.id).toBe(song.lines[1]!.id);
    expect(updated.lines[0]!.position).toBe(0);
    expect(result.removed).toBe(1);
  });

  test("refresh keeps manual lines and replaces the rest", () => {
    const song = seed();
    replaceSongLines(db, song.id, ["[D]linea editada a mano", song.lines[1]!.text]);

    const result = refreshNonManualLines(db, song.id, {
      sourceKey: "/artista/cancion.shtml",
      sourceUrl: "https://acordes.lacuerda.net/artista/cancion.shtml",
      title: "Canción",
      artist: "Artista",
      lines: [
        { text: "[D]primera linea" },
        { text: "[E]segunda linea nueva" },
        { text: "[F]tercera linea" },
      ],
    });

    const updated = getSong(db, song.id)!;
    expect(updated.lines[0]!.text).toBe("[D]linea editada a mano");
    expect(updated.lines[0]!.isManual).toBe(true);
    expect(updated.lines.map((line) => line.text)).toEqual([
      "[D]linea editada a mano",
      "[E]segunda linea nueva",
      "[F]tercera linea",
    ]);
    expect(result.preserved).toBe(1);
  });

  test("stores video candidates and links the selected video", () => {
    const song = seed();
    replaceCandidates(db, song.id, [
      {
        videoId: "abcdefghijk",
        title: "Canción (video oficial)",
        channel: "Artista",
        durationMs: 180_000,
        rank: 0,
        hasTranscript: true,
        transcriptLang: "es",
        coverage: 0.9,
      },
    ]);

    const candidates = listCandidates(db, song.id);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.title).toBe("Canción (video oficial)");

    setVideo(db, song.id, {
      id: "abcdefghijk",
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      title: candidates[0]!.title,
      channel: candidates[0]!.channel,
      durationMs: candidates[0]!.durationMs,
    });
    const updated = getSong(db, song.id)!;
    expect(updated.video?.id).toBe("abcdefghijk");
    expect(updated.videoStatus).toBe("ready");
  });

  test("stores likes and preferred offsets in the database", () => {
    const song = seed();

    expect(isSongLiked(db, song.id)).toBe(false);
    expect(listLikedSongs(db)).toHaveLength(0);

    expect(setSongLike(db, song.id, true)).toBe(true);
    expect(isSongLiked(db, song.id)).toBe(true);
    setPreferredOffset(db, song.id, 2);

    const updated = getSong(db, song.id)!;
    expect(updated.liked).toBe(true);
    expect(updated.likedAt).toBeString();
    expect(updated.preferredOffset).toBe(2);

    const liked = listLikedSongs(db);
    expect(liked).toHaveLength(1);
    expect(liked[0]!.sourceKey).toBe("/artista/cancion.shtml");

    const preferences = listPreferences(db);
    expect(preferences.liked).toEqual(["/artista/cancion.shtml"]);
    expect(preferences.offsets).toEqual({ "/artista/cancion.shtml": 2 });

    setSongLike(db, song.id, false);
    expect(listLikedSongs(db)).toHaveLength(0);
    expect(setSongLike(db, "missing-id", true)).toBe(false);
  });
});
