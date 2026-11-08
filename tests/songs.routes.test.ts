import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase, setDb } from "../src/db";
import { resetRateLimits } from "../src/core/ratelimit";
import { createSong, getSong, setChordTimestamp, setVideoStatus } from "../src/songs/songs.db";
import {
  resetEnrichmentProviders,
  setEnrichmentProvidersForTests,
  waitForEnrichment,
} from "../src/songs/enrichment/enrichment.service";
import { handleSongsRoutes } from "../src/songs/songs.routes";
import type { Song } from "../src/songs/songs.model";

let db: Database;
let song: Song;

function request(path: string, method = "GET", body?: Record<string, string>) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: body ? { "content-type": "application/x-www-form-urlencoded" } : undefined,
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
}

async function route(req: Request) {
  const response = await handleSongsRoutes(req, new URL(req.url), db);
  if (!response) throw new Error("La ruta no coincide.");
  return response;
}

beforeEach(() => {
  db = openDatabase(":memory:");
  setDb(db);
  resetRateLimits();
  resetEnrichmentProviders();
  setEnrichmentProvidersForTests({ transcript: async () => null });
  song = createSong(db, {
    sourceKey: "/artista/cancion.shtml",
    sourceUrl: "https://acordes.lacuerda.net/artista/cancion.shtml",
    title: "Canción",
    artist: "Artista",
    lines: [
      { lyric: "primera linea", chords: [{ name: "C", column: 0 }, { name: "G", column: 7 }] },
      { lyric: "segunda linea", chords: [{ name: "Am", column: 0 }] },
    ],
  });
});

afterEach(() => {
  resetEnrichmentProviders();
  setDb(null);
  db.close();
});

describe("song routes", () => {
  test("renders the player fragment from persisted data", async () => {
    const response = await route(request(`/songs/${song.id}/player?offset=0`));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<h2 id="selected-song-title" tabindex="-1">Canción</h2>');
    expect(html).toContain(`data-chord-id="${song.lines[0]!.chords[0]!.id}"`);
    expect(html).toContain('data-song-id="' + song.id + '"');
    expect(html).not.toContain("https://acordes.lacuerda.net/artista/cancion.shtml");
  });

  test("persists the transposition offset in the database", async () => {
    const response = await route(
      request(`/songs/${song.id}/transpose`, "POST", { offset: "0", delta: "2" }),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("+2 semitonos");
    expect(getSong(db, song.id)!.preferredOffset).toBe(2);

    await route(request(`/songs/${song.id}/transpose`, "POST", { offset: "2", reset: "1" }));
    expect(getSong(db, song.id)!.preferredOffset).toBe(0);
  });

  test("shows the loading overlay while the song is busy preparing", async () => {
    setVideoStatus(db, song.id, "searching");
    const busy = await route(request(`/songs/${song.id}/player?offset=0`));
    const busyHtml = await busy.text();
    expect(busyHtml).toContain("song-loading-overlay");
    expect(busyHtml).toContain("Preparando la canción");

    setVideoStatus(db, song.id, "failed", "sin video");
    const ready = await route(request(`/songs/${song.id}/player?offset=0`));
    const readyHtml = await ready.text();
    expect(readyHtml).not.toContain("song-loading-overlay");
  });

  test("returns the status payload for polling", async () => {
    const response = await route(request(`/songs/${song.id}/status`));
    const payload = (await response.json()) as { id: string; version: number };

    expect(payload.id).toBe(song.id);
    expect(payload.version).toBe(1);
  });

  test("sets and clears a manual chord timestamp", async () => {
    const chordId = song.lines[0]!.chords[0]!.id;
    const set = await route(
      request(`/songs/${song.id}/chords/${chordId}/timestamp`, "POST", { ms: "42000" }),
    );
    expect(set.status).toBe(200);
    expect(getSong(db, song.id)!.lines[0]!.chords[0]!.timestampMs).toBe(42000);
    expect(getSong(db, song.id)!.timestampSource).toBe("manual");

    const clear = await route(
      request(`/songs/${song.id}/chords/${chordId}/timestamp/clear`, "POST", {}),
    );
    expect(clear.status).toBe(200);
    expect(getSong(db, song.id)!.lines[0]!.chords[0]!.timestampMs).toBeNull();
  });

  test("rejects invalid timestamps and unknown chords", async () => {
    const bad = await route(
      request(`/songs/${song.id}/chords/${song.lines[0]!.chords[0]!.id}/timestamp`, "POST", {
        ms: "-5",
      }),
    );
    expect(bad.status).toBe(400);

    const unknown = await route(
      request(`/songs/${song.id}/chords/00000000-0000-0000-0000-000000000000/timestamp`, "POST", {
        ms: "1000",
      }),
    );
    expect(unknown.status).toBe(404);
  });

  test("updates a line and detects stale editor versions", async () => {
    const lineId = song.lines[0]!.id;
    const ok = await route(
      request(`/songs/${song.id}/lines/${lineId}`, "POST", {
        version: "1",
        lyric: "linea editada",
      }),
    );
    expect(ok.status).toBe(200);
    expect(getSong(db, song.id)!.version).toBe(2);
    expect(getSong(db, song.id)!.lines[0]!.lyric).toBe("linea editada");

    const stale = await route(
      request(`/songs/${song.id}/lines/${lineId}`, "POST", {
        version: "1",
        lyric: "otra edicion",
      }),
    );
    expect(stale.status).toBe(409);
    expect(getSong(db, song.id)!.lines[0]!.lyric).toBe("linea editada");
  });

  test("validates chord names and columns in the editor", async () => {
    const lineId = song.lines[0]!.id;
    const badName = await route(
      request(`/songs/${song.id}/lines/${lineId}/chords`, "POST", {
        version: "1",
        name: "<script>",
        column: "0",
      }),
    );
    expect(badName.status).toBe(400);

    const badColumn = await route(
      request(`/songs/${song.id}/lines/${lineId}/chords`, "POST", {
        version: "1",
        name: "D",
        column: "abc",
      }),
    );
    expect(badColumn.status).toBe(400);

    const ok = await route(
      request(`/songs/${song.id}/lines/${lineId}/chords`, "POST", {
        version: "1",
        name: "D",
        column: "3",
      }),
    );
    expect(ok.status).toBe(200);
    expect(getSong(db, song.id)!.lines[0]!.chords).toHaveLength(3);
  });

  test("requires confirmation before replacing a video and clears timestamps", async () => {
    const chordId = song.lines[0]!.chords[0]!.id;
    setChordTimestamp(db, song.id, chordId, 1000, "manual");

    const first = await route(
      request(`/songs/${song.id}/video`, "POST", { videoId: "abcdefghijk" }),
    );
    expect(first.status).toBe(200);

    const conflict = await route(
      request(`/songs/${song.id}/video`, "POST", { videoId: "lmnopqrstuv" }),
    );
    expect(conflict.status).toBe(409);
    expect(getSong(db, song.id)!.video?.id).toBe("abcdefghijk");
    expect(getSong(db, song.id)!.lines[0]!.chords[0]!.timestampMs).toBe(1000);

    const confirmed = await route(
      request(`/songs/${song.id}/video`, "POST", {
        videoId: "lmnopqrstuv",
        confirm: "1",
      }),
    );
    expect(confirmed.status).toBe(200);
    expect(getSong(db, song.id)!.video?.id).toBe("lmnopqrstuv");
    expect(getSong(db, song.id)!.lines[0]!.chords[0]!.timestampMs).toBeNull();
    await waitForEnrichment();
  });

  test("returns null for unrelated paths", async () => {
    expect(await handleSongsRoutes(request("/search?q=x"), new URL("http://localhost/search?q=x"), db)).toBeNull();
  });
});
