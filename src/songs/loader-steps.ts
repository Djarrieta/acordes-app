import type { SongAudio } from "../audio/audio.model";
import type { Song } from "./songs.model";

export type LoaderStepState = "pending" | "active" | "done" | "failed";
export type LoaderStep = { key: string; label: string; state: LoaderStepState };

const TIMESTAMP_BUSY = ["pending", "transcribing", "aligning"];

export function isSongBusy(song: Song, audio: SongAudio | null): boolean {
  return (
    song.videoStatus === "searching"
    || audio?.status === "fetching"
    || TIMESTAMP_BUSY.includes(song.timestampsStatus)
  );
}

// Pasos que ve el usuario mientras la canción se prepara. El primero (La Cuerda)
// siempre está hecho: si hay canción, ya se obtuvo la letra con acordes.
export function loaderSteps(song: Song, audio: SongAudio | null): LoaderStep[] {
  const searching = song.videoStatus === "searching";
  const audioFetching = audio?.status === "fetching";
  const timestampsBusy = TIMESTAMP_BUSY.includes(song.timestampsStatus);

  const steps: LoaderStep[] = [
    { key: "lacuerda", label: "Letra y acordes de La Cuerda", state: "done" },
    {
      key: "video",
      label: searching ? "Buscando el video en YouTube…" : song.video ? "Video de YouTube encontrado" : "Video de YouTube",
      state: searching ? "active" : song.video ? "done" : song.videoStatus === "failed" ? "failed" : "pending",
    },
  ];

  if (searching || audioFetching || audio) {
    steps.push({
      key: "audio",
      label: audioFetching
        ? "Descargando y procesando el audio…"
        : audio?.status === "ready"
          ? "Audio listo para transponer"
          : audio?.status === "failed"
            ? "Audio transpuesto no disponible"
            : "Preparar el audio",
      state: audioFetching ? "active" : audio?.status === "ready" ? "done" : audio?.status === "failed" ? "failed" : "pending",
    });
  }

  if (timestampsBusy || (searching && song.timestampsStatus === "none")) {
    steps.push({
      key: "timestamps",
      label:
        song.timestampsStatus === "aligning"
          ? "Sincronizando la letra con el video…"
          : song.timestampsStatus === "transcribing"
            ? "Leyendo los subtítulos del video…"
            : "Sincronizar la letra con el video",
      state: timestampsBusy ? "active" : "pending",
    });
  }
  return steps;
}
