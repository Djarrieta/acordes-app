import { describe, expect, test } from "bun:test";
import { renderSong } from "../src/render/song";
import { isSongBusy, loaderSteps } from "../src/songs/loader-steps";
import type { SongAudio } from "../src/audio/audio.model";
import { makeSong } from "./helpers";

const video = { id: "abcdefghijk", url: "https://www.youtube.com/watch?v=abcdefghijk", title: "t", channel: "c", durationMs: 1000 };

function audio(status: SongAudio["status"]): SongAudio {
  return {
    songId: "s", videoId: "abcdefghijk", status, error: null, mime: null, path: null,
    sizeBytes: null, durationMs: null, attempts: 1, fetchedAt: null,
  };
}

describe("loader informativo", () => {
  test("muestra el cargador (no el reproductor) mientras se descarga el audio", () => {
    const song = makeSong({ video, videoStatus: "ready", timestampsStatus: "none" } as never);
    const html = renderSong(song, 0, audio("fetching"));
    expect(html).toContain('data-view="loader"');
    expect(html).toContain("Descargando y procesando el audio…");
    expect(html).not.toContain("data-youtube-play");
  });

  test("muestra el reproductor cuando el audio está listo o falló", () => {
    const song = makeSong({ video, videoStatus: "ready", timestampsStatus: "none" } as never);
    for (const status of ["ready", "failed"] as const) {
      const html = renderSong(song, 0, audio(status));
      expect(html).toContain('data-view="player"');
      expect(html).toContain("data-youtube-play");
      expect(html).toContain("data-media-toggle");
    }
  });

  test("describe cada fase: video, audio y subtítulos", () => {
    const searching = makeSong({ videoStatus: "searching" } as never);
    const steps = loaderSteps(searching, null);
    expect(steps.map((step) => step.key)).toContain("lacuerda");
    expect(steps.find((step) => step.key === "video")).toMatchObject({
      state: "active",
      label: "Buscando el video en YouTube…",
    });

    const aligning = makeSong({ video, videoStatus: "ready", timestampsStatus: "aligning" } as never);
    expect(loaderSteps(aligning, audio("ready")).find((step) => step.key === "timestamps")?.label)
      .toBe("Sincronizando la letra con el video…");
    expect(isSongBusy(aligning, audio("ready"))).toBe(true);
    expect(isSongBusy(makeSong({ video, videoStatus: "ready" } as never), audio("ready"))).toBe(false);
  });
});
