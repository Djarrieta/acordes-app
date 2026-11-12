import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase, setDb } from "../src/db";
import { resetRateLimits } from "../src/core/ratelimit";
import { createSong, getSong, setLineStart, setVideoStatus } from "../src/songs/songs.db";
import {
  resetEnrichmentProviders,
  setEnrichmentProvidersForTests,
  waitForEnrichment,
} from "../src/songs/enrichment/enrichment.service";
import { handleSongsRoutes } from "../src/songs/songs.routes";
import { resetAudioProviders, setAudioProvidersForTests } from "../src/audio/audio.service";
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
  resetAudioProviders();
  setAudioProvidersForTests({ download: async () => null });
  song = createSong(db, {
    sourceKey: "/artista/cancion.shtml",
    sourceUrl: "https://acordes.lacuerda.net/artista/cancion.shtml",
    title: "Canción",
    artist: "Artista",
    lines: [
      { text: "[C]primera [G]linea" },
      { text: "[Am]segunda linea" },
    ],
  });
});

afterEach(() => {
  resetEnrichmentProviders();
  resetAudioProviders();
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

  test("shows only the loader while the song is busy preparing", async () => {
    setVideoStatus(db, song.id, "searching");
    const busy = await route(request(`/songs/${song.id}/player?offset=0`));
    const busyHtml = await busy.text();
    expect(busyHtml).toContain('data-view="loader"');
    expect(busyHtml).toContain('data-view-panel="loader"');
    expect(busyHtml).toContain("Preparando la canción");
    expect(busyHtml).not.toContain("song-lyrics");
    expect(busyHtml).toContain('data-youtube-song="' + song.id + '"');

    setVideoStatus(db, song.id, "failed", "sin video");
    const ready = await route(request(`/songs/${song.id}/player?offset=0`));
    const readyHtml = await ready.text();
    expect(readyHtml).toContain('data-view="player"');
    expect(readyHtml).toContain("song-lyrics");
    expect(readyHtml).not.toContain('data-view-panel="loader" role="status"');
  });

  test("returns the status payload for polling", async () => {
    const response = await route(request(`/songs/${song.id}/status`));
    const payload = (await response.json()) as { id: string; version: number };

    expect(payload.id).toBe(song.id);
    expect(payload.version).toBe(1);
  });

  test("sets and clears a manual line timestamp", async () => {
    const lineId = song.lines[0]!.id;
    const set = await route(
      request(`/songs/${song.id}/lines/${lineId}/timestamp`, "POST", { ms: "42000" }),
    );
    expect(set.status).toBe(200);
    expect(getSong(db, song.id)!.lines[0]!.startMs).toBe(42000);
    expect(getSong(db, song.id)!.lines[0]!.startSource).toBe("manual");
    expect(getSong(db, song.id)!.lines[0]!.text).toBe("[C]primera [G]linea");
    expect(getSong(db, song.id)!.timestampSource).toBe("manual");

    const clear = await route(
      request(`/songs/${song.id}/lines/${lineId}/timestamp/clear`, "POST", {}),
    );
    expect(clear.status).toBe(200);
    expect(getSong(db, song.id)!.lines[0]!.startMs).toBeNull();
  });

  test("rejects invalid timestamps and unknown lines", async () => {
    const bad = await route(
      request(`/songs/${song.id}/lines/${song.lines[0]!.id}/timestamp`, "POST", {
        ms: "-5",
      }),
    );
    expect(bad.status).toBe(400);

    const unknown = await route(
      request(`/songs/${song.id}/lines/00000000-0000-0000-0000-000000000000/timestamp`, "POST", {
        ms: "1000",
      }),
    );
    expect(unknown.status).toBe(404);
  });

  test("renders the editor as a single text area with the whole song", async () => {
    const response = await route(request(`/songs/${song.id}/edit`));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('name="text"');
    expect(html).toContain("[C]primera [G]linea\n[Am]segunda linea</textarea>");
    expect(html).not.toContain("Añadir línea");
    expect(html).not.toContain("Guardar línea");
    expect(html).not.toContain("Eliminar línea");
  });

  test("saves the edited text, keeps line marks and detects stale versions", async () => {
    setLineStart(db, song.id, song.lines[1]!.id, 7000, "manual");
    const ok = await route(
      request(`/songs/${song.id}/edit`, "POST", {
        version: "1",
        title: "Nuevo título",
        artist: "Artista",
        text: "[D]primera [E]linea\n\n[Am]segunda linea\n[F]tercera\n\n",
      }),
    );
    expect(ok.status).toBe(200);
    const saved = getSong(db, song.id)!;
    expect(saved.version).toBe(2);
    expect(saved.title).toBe("Nuevo título");
    expect(saved.lines.map((line) => line.text)).toEqual([
      "[D]primera [E]linea",
      "",
      "[Am]segunda linea",
      "[F]tercera",
    ]);
    expect(saved.lines[0]!.chords[1]!.name).toBe("E");
    expect(saved.lines[2]!.startMs).toBe(7000);

    const stale = await route(
      request(`/songs/${song.id}/edit`, "POST", {
        version: "1",
        title: "Otro",
        artist: "Artista",
        text: "[E]otra edicion",
      }),
    );
    expect(stale.status).toBe(409);
    expect(getSong(db, song.id)!.lines).toHaveLength(4);
  });

  test("rejects invalid text and reports the offending line", async () => {
    const post = (text: string) =>
      route(request(`/songs/${song.id}/edit`, "POST", { version: "1", title: "T", artist: "A", text }));

    const empty = await post("  \n \n");
    expect(empty.status).toBe(400);

    const unclosed = await post("[C]bien\n[D texto");
    expect(unclosed.status).toBe(400);
    expect(await unclosed.text()).toContain("línea 2");

    const badName = await post("[<script>]texto");
    expect(badName.status).toBe(400);

    expect(getSong(db, song.id)!.lines[0]!.text).toBe("[C]primera [G]linea");
    expect(getSong(db, song.id)!.version).toBe(1);
  });

  test("requires confirmation before replacing a video and clears timestamps", async () => {
    setLineStart(db, song.id, song.lines[0]!.id, 1000, "manual");

    const first = await route(
      request(`/songs/${song.id}/video`, "POST", { videoId: "abcdefghijk" }),
    );
    expect(first.status).toBe(200);

    const conflict = await route(
      request(`/songs/${song.id}/video`, "POST", { videoId: "lmnopqrstuv" }),
    );
    expect(conflict.status).toBe(409);
    expect(getSong(db, song.id)!.video?.id).toBe("abcdefghijk");
    expect(getSong(db, song.id)!.lines[0]!.startMs).toBe(1000);

    const confirmed = await route(
      request(`/songs/${song.id}/video`, "POST", {
        videoId: "lmnopqrstuv",
        confirm: "1",
      }),
    );
    expect(confirmed.status).toBe(200);
    expect(getSong(db, song.id)!.video?.id).toBe("lmnopqrstuv");
    expect(getSong(db, song.id)!.lines[0]!.startMs).toBeNull();
    await waitForEnrichment();
  });

  test("returns null for unrelated paths", async () => {
    expect(await handleSongsRoutes(request("/search?q=x"), new URL("http://localhost/search?q=x"), db)).toBeNull();
  });
});
