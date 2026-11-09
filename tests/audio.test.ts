import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openDatabase, setDb } from "../src/db";
import { createSong, getSong } from "../src/songs/songs.db";
import { clearAudio, getAudio, listSongsNeedingAudio, setAudioReady } from "../src/audio/audio.db";
import { downloadAudio, mimeForExt } from "../src/audio/audio.download";
import { clampSemitones, pitchRatio } from "../src/audio/audio.model";
import {
  enqueueAudioDownload,
  resetAudioProviders,
  setAudioProvidersForTests,
  waitForAudioDownloads,
} from "../src/audio/audio.service";
import { handleAudioRoutes } from "../src/audio/audio.routes";
import { config } from "../src/config";
import { setVideo } from "../src/songs/songs.db";

let db: Database;
let songId: string;
let tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "acordes-audio-test-"));
  tempDirs.push(dir);
  return dir;
}

function seed() {
  const song = createSong(db, {
    sourceKey: "/artista/cancion.shtml",
    sourceUrl: "https://acordes.lacuerda.net/artista/cancion.shtml",
    title: "Canción",
    artist: "Artista",
    lines: [{ text: "[C]primera linea" }],
  });
  songId = song.id;
  setVideo(db, songId, {
    id: "abcdefghijk",
    url: "https://www.youtube.com/watch?v=abcdefghijk",
    title: "Canción",
    channel: "Artista",
    durationMs: 180_000,
  });
}

beforeEach(() => {
  db = openDatabase(":memory:");
  setDb(db);
  resetAudioProviders();
  seed();
});

afterEach(async () => {
  resetAudioProviders();
  setDb(null);
  db.close();
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("audio model", () => {
  test("converts semitones to pitch ratios within ±12", () => {
    expect(pitchRatio(0)).toBe(1);
    expect(pitchRatio(12)).toBeCloseTo(2);
    expect(pitchRatio(-12)).toBeCloseTo(0.5);
    expect(pitchRatio(1)).toBeCloseTo(Math.pow(2, 1 / 12));
    expect(clampSemitones(20)).toBe(12);
    expect(clampSemitones(-20)).toBe(-12);
    expect(clampSemitones(1.5)).toBe(0);
  });

  test("maps extensions to mime types", () => {
    expect(mimeForExt("webm")).toBe("audio/webm");
    expect(mimeForExt("m4a")).toBe("audio/mp4");
    expect(mimeForExt("opus")).toBe("audio/ogg");
    expect(mimeForExt("flac")).toBeNull();
  });
});

describe("audio download", () => {
  test("stores the downloaded file under the destination directory", async () => {
    const dest = await tempDir();
    const runner = async (command: string[]) => {
      const out = command[command.indexOf("-o") + 1]!;
      const dir = dirname(out);
      const file = join(dir, "abcdefghijk.webm");
      await writeFile(file, "fake-audio-bytes");
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    const downloaded = await downloadAudio("abcdefghijk", dest, { runner });

    expect(downloaded).not.toBeNull();
    expect(downloaded!.mime).toBe("audio/webm");
    expect(downloaded!.sizeBytes).toBe(16);
    expect(downloaded!.path).toBe(join(dest, "abcdefghijk.webm"));
  });

  test("returns null when yt-dlp fails", async () => {
    const dest = await tempDir();
    const downloaded = await downloadAudio("abcdefghijk", dest, {
      runner: async () => ({ exitCode: 1, stdout: "", stderr: "error" }),
    });
    expect(downloaded).toBeNull();
  });
});

describe("audio service", () => {
  test("downloads audio in the background and marks it ready", async () => {
    const dest = await tempDir();
    const file = join(dest, "abcdefghijk.webm");
    await writeFile(file, "fake-audio-bytes");
    setAudioProvidersForTests({
      download: async () => ({ mime: "audio/webm", path: file, sizeBytes: 16 }),
    });

    enqueueAudioDownload(songId, db);
    expect(getAudio(db, songId)!.status).toBe("fetching");
    await waitForAudioDownloads();

    const audio = getAudio(db, songId)!;
    expect(audio.status).toBe("ready");
    expect(audio.videoId).toBe("abcdefghijk");
    expect(audio.mime).toBe("audio/webm");
    expect(getSong(db, songId)!.video?.id).toBe("abcdefghijk");
  });

  test("marks audio as failed when the download fails", async () => {
    setAudioProvidersForTests({ download: async () => null });

    enqueueAudioDownload(songId, db);
    await waitForAudioDownloads();

    const audio = getAudio(db, songId)!;
    expect(audio.status).toBe("failed");
    expect(audio.error).toContain("audio transpuesto");
  });

  test("lists songs with a video but no audio as needing audio", () => {
    expect(listSongsNeedingAudio(db, 3).map((job) => job.id)).toContain(songId);
    setAudioReady(db, songId, "abcdefghijk", {
      mime: "audio/webm",
      path: "/tmp/x.webm",
      sizeBytes: 10,
      durationMs: 180_000,
    });
    expect(listSongsNeedingAudio(db, 3)).toHaveLength(0);
  });

  test("clearAudio removes the row", () => {
    setAudioReady(db, songId, "abcdefghijk", {
      mime: "audio/webm",
      path: "/tmp/x.webm",
      sizeBytes: 10,
      durationMs: null,
    });
    expect(clearAudio(db, songId)).not.toBeNull();
    expect(getAudio(db, songId)).toBeNull();
  });
});

describe("audio routes", () => {
  test("serves the audio file with range support headers", async () => {
    const dest = await tempDir();
    const file = join(dest, "abcdefghijk.webm");
    await writeFile(file, "fake-audio-bytes");
    const originalDir = config.audioDir;
    (config as { audioDir: string }).audioDir = dest;
    try {
      setAudioProvidersForTests({
        download: async () => ({ mime: "audio/webm", path: file, sizeBytes: 16 }),
      });
      enqueueAudioDownload(songId, db);
      await waitForAudioDownloads();

      const request = new Request(`http://localhost/songs/${songId}/audio`);
      const response = await handleAudioRoutes(request, new URL(request.url), db);
      expect(response).not.toBeNull();
      expect(response!.status).toBe(200);
      expect(response!.headers.get("Content-Type")).toBe("audio/webm");
      expect(response!.headers.get("Accept-Ranges")).toBe("bytes");
      expect(await response!.text()).toBe("fake-audio-bytes");
    } finally {
      (config as { audioDir: string }).audioDir = originalDir;
    }
  });

  test("returns 404 when audio is not ready", async () => {
    const request = new Request(`http://localhost/songs/${songId}/audio`);
    const response = await handleAudioRoutes(request, new URL(request.url), db);
    expect(response!.status).toBe(404);
  });
});
