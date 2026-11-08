import { Database } from "bun:sqlite";
import { newId, now, transaction } from "../db";
import type {
  Song,
  SongCandidate,
  SongChord,
  SongLine,
  SongTimestampSource,
  TimestampsStatus,
  TranscriptKind,
  VideoStatus,
} from "./songs.model";
import { youtubeWatchUrl as watchUrl } from "./songs.model";

type SongRow = {
  id: string;
  source: "lacuerda";
  source_key: string;
  source_url: string;
  title: string;
  artist: string;
  video_id: string | null;
  video_url: string | null;
  video_title: string | null;
  video_channel: string | null;
  video_duration_ms: number | null;
  timestamp_source: SongTimestampSource;
  timestamp_confidence: number | null;
  video_status: VideoStatus;
  video_error: string | null;
  timestamps_status: TimestampsStatus;
  timestamps_error: string | null;
  timestamps_attempts: number;
  liked: number;
  liked_at: string | null;
  preferred_offset: number;
  version: number;
  created_at: string;
  updated_at: string;
};

type LineRow = {
  id: string;
  position: number;
  lyric: string;
  is_manual: number;
};

type ChordRow = {
  id: string;
  line_id: string;
  position: number;
  name: string;
  column: number;
  timestamp_ms: number | null;
  timestamp_source: "none" | "auto" | "manual";
  confidence: number | null;
};

type CandidateRow = {
  id: string;
  video_id: string;
  title: string | null;
  channel: string | null;
  duration_ms: number | null;
  rank: number;
  has_transcript: number | null;
  transcript_lang: string | null;
  coverage: number | null;
};

function mapChord(row: ChordRow): SongChord {
  return {
    id: row.id,
    position: row.position,
    name: row.name,
    column: row.column,
    timestampMs: row.timestamp_ms,
    timestampSource: row.timestamp_source,
    confidence: row.confidence,
  };
}

function mapSong(row: SongRow, lines: SongLine[]): Song {
  return {
    id: row.id,
    source: row.source,
    sourceKey: row.source_key,
    sourceUrl: row.source_url,
    title: row.title,
    artist: row.artist,
    video: row.video_id
      ? {
          id: row.video_id,
          url: row.video_url ?? watchUrl(row.video_id),
          title: row.video_title,
          channel: row.video_channel,
          durationMs: row.video_duration_ms,
        }
      : null,
    timestampSource: row.timestamp_source,
    timestampConfidence: row.timestamp_confidence,
    videoStatus: row.video_status,
    videoError: row.video_error,
    timestampsStatus: row.timestamps_status,
    timestampsError: row.timestamps_error,
    timestampsAttempts: row.timestamps_attempts,
    liked: row.liked === 1,
    likedAt: row.liked_at,
    preferredOffset: row.preferred_offset ?? 0,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lines,
  };
}

export function findSongIdBySourceKey(
  db: Database,
  sourceKey: string,
  source = "lacuerda",
): string | null {
  const row = db
    .query("SELECT id FROM songs WHERE source = ? AND source_key = ?")
    .get(source, sourceKey) as { id: string } | null;
  return row?.id ?? null;
}

export function getSong(db: Database, id: string): Song | null {
  const row = db.query("SELECT * FROM songs WHERE id = ?").get(id) as SongRow | null;
  if (!row) return null;

  const lineRows = db
    .query("SELECT * FROM song_lines WHERE song_id = ? ORDER BY position ASC")
    .all(id) as LineRow[];
  const chordRows = db
    .query(
      `SELECT c.* FROM song_chords c
       JOIN song_lines l ON l.id = c.line_id
       WHERE l.song_id = ?
       ORDER BY l.position ASC, c.position ASC`,
    )
    .all(id) as ChordRow[];

  const chordsByLine = new Map<string, SongChord[]>();
  for (const chord of chordRows) {
    const list = chordsByLine.get(chord.line_id) ?? [];
    list.push(mapChord(chord));
    chordsByLine.set(chord.line_id, list);
  }

  const lines: SongLine[] = lineRows.map((line) => ({
    id: line.id,
    position: line.position,
    lyric: line.lyric,
    isManual: line.is_manual === 1,
    chords: chordsByLine.get(line.id) ?? [],
  }));

  return mapSong(row, lines);
}

export type CreateSongInput = {
  sourceKey: string;
  sourceUrl: string;
  title: string;
  artist: string;
  lines: { lyric: string; chords: { name: string; column: number }[] }[];
};

export function createSong(db: Database, input: CreateSongInput): Song {
  const id = newId();
  const timestamp = now();
  transaction(db, () => {
    db.query(
      `INSERT INTO songs (
        id, source, source_key, source_url, title, artist,
        created_at, updated_at, version
      ) VALUES (?, 'lacuerda', ?, ?, ?, ?, ?, ?, 1)`,
    ).run(id, input.sourceKey, input.sourceUrl, input.title, input.artist, timestamp, timestamp);

    input.lines.forEach((line, lineIndex) => {
      const lineId = newId();
      db.query(
        `INSERT INTO song_lines (id, song_id, position, lyric, is_manual, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
      ).run(lineId, id, lineIndex, line.lyric, timestamp, timestamp);
      line.chords.forEach((chord, chordIndex) => {
        db.query(
          `INSERT INTO song_chords (
            id, line_id, position, name, column, timestamp_source, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'none', ?, ?)`,
        ).run(newId(), lineId, chordIndex, chord.name, chord.column, timestamp, timestamp);
      });
    });
  });
  const song = getSong(db, id);
  if (!song) throw new Error("No se pudo crear la canción.");
  return song;
}

export function recordEdit(
  db: Database,
  songId: string,
  action: string,
  payload: unknown,
  actor: string | null = null,
): void {
  db.query(
    "INSERT INTO song_edits (id, song_id, actor, action, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(newId(), songId, actor, action, payload === undefined ? null : JSON.stringify(payload), now());
}

export function bumpVersion(db: Database, songId: string): void {
  db.query("UPDATE songs SET version = version + 1, updated_at = ? WHERE id = ?").run(
    now(),
    songId,
  );
}

export function updateSongMeta(
  db: Database,
  songId: string,
  title: string,
  artist: string,
): void {
  db.query("UPDATE songs SET title = ?, artist = ?, updated_at = ? WHERE id = ?").run(
    title,
    artist,
    now(),
    songId,
  );
}

function assertSongLine(db: Database, songId: string, lineId: string): LineRow | null {
  return (db
    .query("SELECT * FROM song_lines WHERE id = ? AND song_id = ?")
    .get(lineId, songId) as LineRow | null);
}

export function updateLine(
  db: Database,
  songId: string,
  lineId: string,
  lyric: string,
  isManual = true,
): void {
  db.query(
    "UPDATE song_lines SET lyric = ?, is_manual = ?, updated_at = ? WHERE id = ? AND song_id = ?",
  ).run(lyric, isManual ? 1 : 0, now(), lineId, songId);
}

export function setLinePosition(
  db: Database,
  songId: string,
  lineId: string,
  target: number,
): void {
  const lines = db
    .query("SELECT id, position FROM song_lines WHERE song_id = ? ORDER BY position ASC")
    .all(songId) as { id: string; position: number }[];
  const current = lines.findIndex((line) => line.id === lineId);
  if (current === -1) return;
  const clamped = Math.max(0, Math.min(target, lines.length - 1));
  const [moved] = lines.splice(current, 1);
  if (!moved) return;
  lines.splice(clamped, 0, moved);

  transaction(db, () => {
    for (const [index, line] of lines.entries()) {
      db.query("UPDATE song_lines SET position = ? WHERE id = ?").run(-(index + 1), line.id);
    }
    for (const [index, line] of lines.entries()) {
      db.query("UPDATE song_lines SET position = ?, updated_at = ? WHERE id = ?").run(
        index,
        now(),
        line.id,
      );
    }
  });
}

export function deleteLine(db: Database, songId: string, lineId: string): boolean {
  const line = assertSongLine(db, songId, lineId);
  if (!line) return false;
  transaction(db, () => {
    db.query("DELETE FROM song_lines WHERE id = ?").run(lineId);
    renumberLines(db, songId);
  });
  return true;
}

function renumberLines(db: Database, songId: string): void {
  const lines = db
    .query("SELECT id FROM song_lines WHERE song_id = ? ORDER BY position ASC")
    .all(songId) as { id: string }[];
  for (const [index, line] of lines.entries()) {
    db.query("UPDATE song_lines SET position = ? WHERE id = ?").run(-(index + 1), line.id);
  }
  for (const [index, line] of lines.entries()) {
    db.query("UPDATE song_lines SET position = ? WHERE id = ?").run(index, line.id);
  }
}

export function addLine(db: Database, songId: string): string {
  const row = db
    .query("SELECT COALESCE(MAX(position), -1) AS position FROM song_lines WHERE song_id = ?")
    .get(songId) as { position: number };
  const id = newId();
  const timestamp = now();
  db.query(
    `INSERT INTO song_lines (id, song_id, position, lyric, is_manual, created_at, updated_at)
     VALUES (?, ?, ?, '', 1, ?, ?)`,
  ).run(id, songId, row.position + 1, timestamp, timestamp);
  return id;
}

export type ChordInput = { name: string; column: number };

function assertChord(db: Database, songId: string, chordId: string): ChordRow | null {
  return (db
    .query(
      `SELECT c.* FROM song_chords c
       JOIN song_lines l ON l.id = c.line_id
       WHERE c.id = ? AND l.song_id = ?`,
    )
    .get(chordId, songId) as ChordRow | null);
}

export function addChord(db: Database, songId: string, lineId: string, chord: ChordInput): boolean {
  if (!assertSongLine(db, songId, lineId)) return false;
  const row = db
    .query("SELECT COALESCE(MAX(position), -1) AS position FROM song_chords WHERE line_id = ?")
    .get(lineId) as { position: number };
  const timestamp = now();
  db.query(
    `INSERT INTO song_chords (
      id, line_id, position, name, column, timestamp_source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'none', ?, ?)`,
  ).run(newId(), lineId, row.position + 1, chord.name, chord.column, timestamp, timestamp);
  return true;
}

export function updateChord(
  db: Database,
  songId: string,
  chordId: string,
  chord: ChordInput,
): boolean {
  if (!assertChord(db, songId, chordId)) return false;
  db.query("UPDATE song_chords SET name = ?, column = ?, updated_at = ? WHERE id = ?").run(
    chord.name,
    chord.column,
    now(),
    chordId,
  );
  return true;
}

export function deleteChord(db: Database, songId: string, chordId: string): boolean {
  const chord = assertChord(db, songId, chordId);
  if (!chord) return false;
  db.query("DELETE FROM song_chords WHERE id = ?").run(chordId);
  const rows = db
    .query("SELECT id FROM song_chords WHERE line_id = ? ORDER BY position ASC")
    .all(chord.line_id) as { id: string }[];
  for (const [index, row] of rows.entries()) {
    db.query("UPDATE song_chords SET position = ? WHERE id = ?").run(-(index + 1), row.id);
  }
  for (const [index, row] of rows.entries()) {
    db.query("UPDATE song_chords SET position = ? WHERE id = ?").run(index, row.id);
  }
  recalcSongTimestampSource(db, songId);
  return true;
}

export function setChordTimestamp(
  db: Database,
  songId: string,
  chordId: string,
  timestampMs: number | null,
  source: "auto" | "manual",
  confidence: number | null = null,
): boolean {
  const chord = assertChord(db, songId, chordId);
  if (!chord) return false;
  db.query(
    `UPDATE song_chords
     SET timestamp_ms = ?, timestamp_source = ?, confidence = ?, updated_at = ?
     WHERE id = ?`,
  ).run(timestampMs, timestampMs === null ? "none" : source, confidence, now(), chordId);
  recalcSongTimestampSource(db, songId);
  return true;
}

export function clearChordTimestamp(db: Database, songId: string, chordId: string): boolean {
  const chord = assertChord(db, songId, chordId);
  if (!chord) return false;
  db.query(
    `UPDATE song_chords
     SET timestamp_ms = NULL, timestamp_source = 'none', confidence = NULL, updated_at = ?
     WHERE id = ?`,
  ).run(now(), chordId);
  recalcSongTimestampSource(db, songId);
  return true;
}

export function clearAutoTimestamps(db: Database, songId: string): void {
  db.query(
    `UPDATE song_chords
     SET timestamp_ms = NULL, timestamp_source = 'none', confidence = NULL, updated_at = ?
     WHERE line_id IN (SELECT id FROM song_lines WHERE song_id = ?)`,
  ).run(now(), songId);
  recalcSongTimestampSource(db, songId);
}

export function applyAutoTimestamps(
  db: Database,
  songId: string,
  updates: { chordId: string; timestampMs: number; confidence: number }[],
): void {
  const timestamp = now();
  transaction(db, () => {
    for (const update of updates) {
      db.query(
        `UPDATE song_chords
         SET timestamp_ms = ?, timestamp_source = 'auto', confidence = ?, updated_at = ?
         WHERE id = ? AND timestamp_source IN ('none', 'auto')`,
      ).run(update.timestampMs, update.confidence, timestamp, update.chordId);
    }
    recalcSongTimestampSource(db, songId);
  });
}

export function recalcSongTimestampSource(db: Database, songId: string): void {
  const row = db
    .query(
      `SELECT
        SUM(CASE WHEN c.timestamp_source = 'manual' THEN 1 ELSE 0 END) AS manual_count,
        SUM(CASE WHEN c.timestamp_source = 'auto' THEN 1 ELSE 0 END) AS auto_count
       FROM song_chords c
       JOIN song_lines l ON l.id = c.line_id
       WHERE l.song_id = ?`,
    )
    .get(songId) as { manual_count: number | null; auto_count: number | null };
  const manual = row.manual_count ?? 0;
  const auto = row.auto_count ?? 0;
  const source: SongTimestampSource =
    manual > 0 && auto > 0 ? "mixed" : manual > 0 ? "manual" : auto > 0 ? "auto" : "none";
  db.query("UPDATE songs SET timestamp_source = ?, updated_at = ? WHERE id = ?").run(
    source,
    now(),
    songId,
  );
}

export function setVideo(
  db: Database,
  songId: string,
  video: {
    id: string;
    url: string;
    title: string | null;
    channel: string | null;
    durationMs: number | null;
  },
): void {
  db.query(
    `UPDATE songs
     SET video_id = ?, video_url = ?, video_title = ?, video_channel = ?,
         video_duration_ms = ?, video_status = 'ready', video_error = NULL,
         video_searched_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    video.id,
    video.url,
    video.title,
    video.channel,
    video.durationMs,
    now(),
    now(),
    songId,
  );
}

export function clearAllTimestamps(db: Database, songId: string): void {
  db.query(
    `UPDATE song_chords
     SET timestamp_ms = NULL, timestamp_source = 'none', confidence = NULL, updated_at = ?
     WHERE line_id IN (SELECT id FROM song_lines WHERE song_id = ?)`,
  ).run(now(), songId);
  db.query(
    `UPDATE songs
     SET timestamps_status = 'none', timestamps_error = NULL, timestamps_attempts = 0,
         timestamp_confidence = NULL, updated_at = ?
     WHERE id = ?`,
  ).run(now(), songId);
  recalcSongTimestampSource(db, songId);
}

export function clearVideo(db: Database, songId: string): void {
  transaction(db, () => {
    db.query(
      `UPDATE songs
       SET video_id = NULL, video_url = NULL, video_title = NULL, video_channel = NULL,
           video_duration_ms = NULL, video_status = 'none', video_error = NULL,
           timestamps_status = 'none', timestamps_error = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(now(), songId);
    clearAutoTimestamps(db, songId);
    db.query(
      `UPDATE song_chords
       SET timestamp_ms = NULL, timestamp_source = 'none', confidence = NULL, updated_at = ?
       WHERE line_id IN (SELECT id FROM song_lines WHERE song_id = ?)`,
    ).run(now(), songId);
    recalcSongTimestampSource(db, songId);
  });
}

export function setVideoStatus(
  db: Database,
  songId: string,
  status: VideoStatus,
  error: string | null = null,
): void {
  db.query(
    `UPDATE songs
     SET video_status = ?, video_error = ?, video_searched_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(status, error, now(), now(), songId);
}

export function setTimestampsStatus(
  db: Database,
  songId: string,
  status: TimestampsStatus,
  error: string | null = null,
  confidence: number | null = null,
): void {
  db.query(
    `UPDATE songs
     SET timestamps_status = ?, timestamps_error = ?, timestamp_confidence = ?,
         timestamps_generated_at = CASE WHEN ? IN ('ready', 'partial') THEN ? ELSE timestamps_generated_at END,
         updated_at = ?
     WHERE id = ?`,
  ).run(status, error, confidence, status, now(), now(), songId);
}

export function incrementTimestampsAttempts(db: Database, songId: string): void {
  db.query(
    "UPDATE songs SET timestamps_attempts = timestamps_attempts + 1, updated_at = ? WHERE id = ?",
  ).run(now(), songId);
}

export function saveTranscript(
  db: Database,
  input: {
    songId: string;
    videoId: string;
    lang: string;
    kind: TranscriptKind;
    raw: string;
    wordCount: number;
  },
): void {
  db.query(
    `INSERT INTO song_transcripts (id, song_id, video_id, lang, kind, source, raw, word_count, created_at)
     VALUES (?, ?, ?, ?, ?, 'ytdlp', ?, ?, ?)
     ON CONFLICT (song_id, video_id, lang, kind) DO UPDATE SET
       raw = excluded.raw,
       word_count = excluded.word_count,
       created_at = excluded.created_at`,
  ).run(newId(), input.songId, input.videoId, input.lang, input.kind, input.raw, input.wordCount, now());
}

export type CandidateInput = {
  videoId: string;
  title: string | null;
  channel: string | null;
  durationMs: number | null;
  rank: number;
  hasTranscript: boolean | null;
  transcriptLang: string | null;
  coverage: number | null;
};

export function replaceCandidates(
  db: Database,
  songId: string,
  candidates: CandidateInput[],
): void {
  transaction(db, () => {
    db.query("DELETE FROM song_video_candidates WHERE song_id = ?").run(songId);
    for (const candidate of candidates) {
      db.query(
        `INSERT INTO song_video_candidates (
          id, song_id, video_id, title, channel, duration_ms, rank,
          has_transcript, transcript_lang, coverage, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        newId(),
        songId,
        candidate.videoId,
        candidate.title,
        candidate.channel,
        candidate.durationMs,
        candidate.rank,
        candidate.hasTranscript === null ? null : candidate.hasTranscript ? 1 : 0,
        candidate.transcriptLang,
        candidate.coverage,
        now(),
      );
    }
  });
}

export function listCandidates(db: Database, songId: string): SongCandidate[] {
  const rows = db
    .query("SELECT * FROM song_video_candidates WHERE song_id = ? ORDER BY rank ASC")
    .all(songId) as CandidateRow[];
  return rows.map((row) => ({
    id: row.id,
    videoId: row.video_id,
    title: row.title,
    channel: row.channel,
    durationMs: row.duration_ms,
    rank: row.rank,
    hasTranscript: row.has_transcript === null ? null : row.has_transcript === 1,
    transcriptLang: row.transcript_lang,
    coverage: row.coverage,
    url: watchUrl(row.video_id),
  }));
}

export function updateCandidateTranscript(
  db: Database,
  songId: string,
  videoId: string,
  hasTranscript: boolean,
  coverage: number | null,
): void {
  db.query(
    `UPDATE song_video_candidates
     SET has_transcript = ?, transcript_lang = ?, coverage = ?
     WHERE song_id = ? AND video_id = ?`,
  ).run(hasTranscript ? 1 : 0, hasTranscript ? "es" : null, coverage, songId, videoId);
}

export function listSongsNeedingResume(
  db: Database,
  maxAttempts: number,
): { id: string; videoStatus: VideoStatus; timestampsStatus: TimestampsStatus }[] {
  return db
    .query(
      `SELECT id, video_status AS videoStatus, timestamps_status AS timestampsStatus
       FROM songs
       WHERE video_status = 'searching'
          OR (timestamps_status IN ('pending', 'transcribing', 'aligning')
              AND timestamps_attempts < ?)`,
    )
    .all(maxAttempts) as {
    id: string;
    videoStatus: VideoStatus;
    timestampsStatus: TimestampsStatus;
  }[];
}

export function refreshNonManualLines(
  db: Database,
  songId: string,
  parsed: CreateSongInput,
): { updated: number; preserved: number } {
  let updated = 0;
  let preserved = 0;
  transaction(db, () => {
    const existing = db
      .query("SELECT * FROM song_lines WHERE song_id = ? ORDER BY position ASC")
      .all(songId) as LineRow[];
    const total = Math.max(existing.length, parsed.lines.length);

    for (let index = 0; index < total; index += 1) {
      const current = existing[index];
      const next = parsed.lines[index];
      if (current?.is_manual === 1) {
        preserved += 1;
        continue;
      }
      if (!current && next) {
        const lineId = newId();
        const timestamp = now();
        db.query(
          `INSERT INTO song_lines (id, song_id, position, lyric, is_manual, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, ?)`,
        ).run(lineId, songId, index, next.lyric, timestamp, timestamp);
        next.chords.forEach((chord, chordIndex) => {
          db.query(
            `INSERT INTO song_chords (
              id, line_id, position, name, column, timestamp_source, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'none', ?, ?)`,
          ).run(newId(), lineId, chordIndex, chord.name, chord.column, timestamp, timestamp);
        });
        updated += 1;
        continue;
      }
      if (current && !next) {
        db.query("DELETE FROM song_lines WHERE id = ?").run(current.id);
        updated += 1;
        continue;
      }
      if (!current || !next) continue;

      const chordRows = db
        .query("SELECT * FROM song_chords WHERE line_id = ? ORDER BY position ASC")
        .all(current.id) as ChordRow[];
      const sameLyric = current.lyric === next.lyric;
      db.query("UPDATE song_lines SET lyric = ?, updated_at = ? WHERE id = ?").run(
        next.lyric,
        now(),
        current.id,
      );
      const kept = new Map<string, ChordRow>();
      if (sameLyric) {
        for (const chord of chordRows) kept.set(`${chord.position}:${chord.name}:${chord.column}`, chord);
      }
      const reusable = [...kept.values()];
      db.query("DELETE FROM song_chords WHERE line_id = ?").run(current.id);
      next.chords.forEach((chord, chordIndex) => {
        const match = reusable.find(
          (row) =>
            row.position === chordIndex &&
            row.name === chord.name &&
            row.column === chord.column,
        );
        db.query(
          `INSERT INTO song_chords (
            id, line_id, position, name, column, timestamp_ms, timestamp_source,
            confidence, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          match?.id ?? newId(),
          current.id,
          chordIndex,
          chord.name,
          chord.column,
          match?.timestamp_ms ?? null,
          match?.timestamp_source ?? "none",
          match?.confidence ?? null,
          now(),
          now(),
        );
      });
      updated += 1;
    }
    renumberLines(db, songId);
    recalcSongTimestampSource(db, songId);
  });
  return { updated, preserved };
}

export function isSongLiked(db: Database, songId: string): boolean {
  const row = db.query("SELECT liked FROM songs WHERE id = ?").get(songId) as {
    liked: number;
  } | null;
  return row?.liked === 1;
}

export function setSongLike(db: Database, songId: string, liked: boolean): boolean {
  const result = db
    .query("UPDATE songs SET liked = ?, liked_at = ?, updated_at = ? WHERE id = ?")
    .run(liked ? 1 : 0, liked ? now() : null, now(), songId);
  return result.changes > 0;
}

export function setPreferredOffset(db: Database, songId: string, offset: number): void {
  db.query("UPDATE songs SET preferred_offset = ?, updated_at = ? WHERE id = ?").run(
    offset,
    now(),
    songId,
  );
}

export function listLikedSongs(
  db: Database,
): { title: string; artist: string; url: string; sourceKey: string }[] {
  const rows = db
    .query(
      "SELECT title, artist, source_url, source_key FROM songs WHERE liked = 1 ORDER BY liked_at ASC",
    )
    .all() as { title: string; artist: string; source_url: string; source_key: string }[];
  return rows.map((row) => ({
    title: row.title,
    artist: row.artist,
    url: row.source_url,
    sourceKey: row.source_key,
  }));
}

export function listPreferences(db: Database): {
  liked: string[];
  offsets: Record<string, number>;
} {
  const rows = db
    .query("SELECT source_key, preferred_offset FROM songs")
    .all() as { source_key: string; preferred_offset: number }[];
  const likedRows = db.query("SELECT source_key FROM songs WHERE liked = 1").all() as {
    source_key: string;
  }[];
  const offsets: Record<string, number> = {};
  for (const row of rows) {
    if (row.preferred_offset !== 0) offsets[row.source_key] = row.preferred_offset;
  }
  return { liked: likedRows.map((row) => row.source_key), offsets };
}
