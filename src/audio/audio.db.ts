import type { Database } from "bun:sqlite";
import { now } from "../db";
import type { AudioStatus, SongAudio } from "./audio.model";

type AudioRow = {
  song_id: string;
  video_id: string;
  status: AudioStatus;
  error: string | null;
  mime: string | null;
  path: string | null;
  size_bytes: number | null;
  duration_ms: number | null;
  attempts: number;
  fetched_at: string | null;
};

function mapAudio(row: AudioRow): SongAudio {
  return {
    songId: row.song_id,
    videoId: row.video_id,
    status: row.status,
    error: row.error,
    mime: row.mime,
    path: row.path,
    sizeBytes: row.size_bytes,
    durationMs: row.duration_ms,
    attempts: row.attempts,
    fetchedAt: row.fetched_at,
  };
}

export function getAudio(db: Database, songId: string): SongAudio | null {
  const row = db.query("SELECT * FROM song_audio WHERE song_id = ?").get(songId) as AudioRow | null;
  return row ? mapAudio(row) : null;
}

export function beginAudioFetch(db: Database, songId: string, videoId: string): void {
  const existing = getAudio(db, songId);
  const attempts = existing && existing.videoId === videoId ? existing.attempts + 1 : 1;
  db.query(
    `INSERT INTO song_audio (song_id, video_id, status, error, attempts)
     VALUES (?, ?, 'fetching', NULL, ?)
     ON CONFLICT (song_id) DO UPDATE SET
       video_id = excluded.video_id,
       status = 'fetching',
       error = NULL,
       attempts = excluded.attempts`,
  ).run(songId, videoId, attempts);
}

export function setAudioReady(
  db: Database,
  songId: string,
  videoId: string,
  input: { mime: string; path: string; sizeBytes: number; durationMs: number | null },
): void {
  db.query(
    `INSERT INTO song_audio (song_id, video_id, status, mime, path, size_bytes, duration_ms, fetched_at, attempts)
     VALUES (?, ?, 'ready', ?, ?, ?, ?, ?, 1)
     ON CONFLICT (song_id) DO UPDATE SET
       video_id = excluded.video_id,
       status = 'ready',
       error = NULL,
       mime = excluded.mime,
       path = excluded.path,
       size_bytes = excluded.size_bytes,
       duration_ms = excluded.duration_ms,
       fetched_at = excluded.fetched_at`,
  ).run(songId, videoId, input.mime, input.path, input.sizeBytes, input.durationMs, now());
}

export function setAudioFailed(
  db: Database,
  songId: string,
  videoId: string,
  error: string,
): void {
  db.query(
    `INSERT INTO song_audio (song_id, video_id, status, error, attempts)
     VALUES (?, ?, 'failed', ?, 1)
     ON CONFLICT (song_id) DO UPDATE SET
       video_id = excluded.video_id,
       status = 'failed',
       error = excluded.error`,
  ).run(songId, videoId, error);
}

export function clearAudio(db: Database, songId: string): SongAudio | null {
  const existing = getAudio(db, songId);
  if (existing) db.query("DELETE FROM song_audio WHERE song_id = ?").run(songId);
  return existing;
}

export function listSongsNeedingAudio(
  db: Database,
  maxAttempts: number,
): { id: string; videoId: string }[] {
  return db
    .query(
      `SELECT songs.id AS id, songs.video_id AS videoId
       FROM songs
       LEFT JOIN song_audio ON song_audio.song_id = songs.id
       WHERE songs.video_id IS NOT NULL
         AND (song_audio.song_id IS NULL OR song_audio.status = 'fetching')
         AND COALESCE(song_audio.attempts, 0) < ?`,
    )
    .all(maxAttempts) as { id: string; videoId: string }[];
}

export function listReadyAudios(db: Database): SongAudio[] {
  const rows = db
    .query("SELECT * FROM song_audio WHERE status = 'ready' ORDER BY fetched_at ASC")
    .all() as AudioRow[];
  return rows.map(mapAudio);
}
