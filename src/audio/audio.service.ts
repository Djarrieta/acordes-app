import type { Database } from "bun:sqlite";
import { rm } from "node:fs/promises";
import { config } from "../config";
import { getDb } from "../db";
import { getSong, recordEdit } from "../songs/songs.db";
import {
  beginAudioFetch,
  clearAudio,
  getAudio,
  listReadyAudios,
  listSongsNeedingAudio,
  setAudioFailed,
  setAudioReady,
} from "./audio.db";
import { downloadAudio } from "./audio.download";

type Providers = {
  download: typeof downloadAudio;
};

const defaultProviders: Providers = { download: downloadAudio };

let providers: Providers = defaultProviders;

export function setAudioProvidersForTests(next: Partial<Providers>): void {
  providers = { ...defaultProviders, ...next };
}

export function resetAudioProviders(): void {
  providers = defaultProviders;
}

let audioChain: Promise<void> = Promise.resolve();
const pending = new Set<Promise<unknown>>();
const fetching = new Set<string>();

function track<T>(promise: Promise<T>): Promise<T> {
  pending.add(promise);
  void promise.finally(() => pending.delete(promise));
  return promise;
}

function enqueueAudio(task: () => Promise<void>): Promise<void> {
  const run = audioChain.then(task).catch((error) => {
    console.error("Error en un trabajo de descarga de audio:", error);
  });
  audioChain = run;
  return track(run);
}

export async function waitForAudioDownloads(): Promise<void> {
  while (pending.size > 0) {
    await Promise.allSettled([...pending]);
  }
}

export function enqueueAudioDownload(songId: string, db = getDb(), force = false): void {
  if (!config.audioEnabled) return;
  const song = getSong(db, songId);
  if (!song?.video) return;
  if (fetching.has(songId)) return;
  const existing = getAudio(db, songId);
  if (existing && existing.videoId === song.video.id && existing.status === "ready") return;
  if (!force && existing && existing.videoId === song.video.id && existing.attempts >= config.audioMaxAttempts) {
    return;
  }
  fetching.add(songId);
  beginAudioFetch(db, songId, song.video.id);
  void enqueueAudio(() => runAudioDownload(db, songId, song.video!.id)).finally(() => {
    fetching.delete(songId);
  });
}

async function runAudioDownload(
  db: Database,
  songId: string,
  videoId: string,
): Promise<void> {
  const song = getSong(db, songId);
  if (!song?.video || song.video.id !== videoId) return;
  const downloaded = await providers.download(videoId, config.audioDir, {
    maxBytes: config.audioMaxBytes,
  });
  const current = getSong(db, songId);
  if (!current?.video || current.video.id !== videoId) {
    if (downloaded) await rm(downloaded.path, { force: true });
    return;
  }
  if (!downloaded) {
    setAudioFailed(
      db,
      songId,
      videoId,
      "No se pudo preparar el audio transpuesto. Se usa el video de YouTube.",
    );
    return;
  }
  setAudioReady(db, songId, videoId, {
    mime: downloaded.mime,
    path: downloaded.path,
    sizeBytes: downloaded.sizeBytes,
    durationMs: current.video.durationMs,
  });
  recordEdit(db, songId, "audio.ready", { videoId });
  await evictOldAudios(db, songId);
}

async function evictOldAudios(db: Database, keepSongId: string): Promise<void> {
  const ready = listReadyAudios(db);
  let total = ready.reduce((sum, audio) => sum + (audio.sizeBytes ?? 0), 0);
  for (const audio of ready) {
    if (total <= config.audioMaxTotalBytes) break;
    if (audio.songId === keepSongId || !audio.path) continue;
    await rm(audio.path, { force: true });
    clearAudio(db, audio.songId);
    total -= audio.sizeBytes ?? 0;
  }
}

export async function invalidateSongAudio(songId: string, db = getDb()): Promise<void> {
  const existing = clearAudio(db, songId);
  if (existing?.path) await rm(existing.path, { force: true });
}

export function resumePendingAudioDownloads(db = getDb()): void {
  if (!config.audioEnabled) return;
  for (const job of listSongsNeedingAudio(db, config.audioMaxAttempts)) {
    enqueueAudioDownload(job.id, db);
  }
}
