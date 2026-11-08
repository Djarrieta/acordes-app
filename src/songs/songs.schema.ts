export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS songs (
  id                      TEXT PRIMARY KEY,
  source                  TEXT NOT NULL DEFAULT 'lacuerda',
  source_key              TEXT NOT NULL,
  source_url              TEXT NOT NULL,
  title                   TEXT NOT NULL,
  artist                  TEXT NOT NULL,
  artist_slug             TEXT,
  song_slug               TEXT,
  video_id                TEXT,
  video_url               TEXT,
  video_title             TEXT,
  video_channel           TEXT,
  video_duration_ms       INTEGER,
  transcript_lang         TEXT,
  transcript_kind         TEXT,
  timestamp_source        TEXT NOT NULL DEFAULT 'none',
  timestamp_confidence    REAL,
  video_status            TEXT NOT NULL DEFAULT 'none',
  video_error             TEXT,
  video_searched_at       TEXT,
  timestamps_status       TEXT NOT NULL DEFAULT 'none',
  timestamps_error        TEXT,
  timestamps_attempts     INTEGER NOT NULL DEFAULT 0,
  timestamps_generated_at TEXT,
  created_by              TEXT,
  updated_by              TEXT,
  liked                   INTEGER NOT NULL DEFAULT 0,
  liked_at                TEXT,
  preferred_offset        INTEGER NOT NULL DEFAULT 0,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  version                 INTEGER NOT NULL DEFAULT 1,
  UNIQUE (source, source_key)
);

CREATE TABLE IF NOT EXISTS song_lines (
  id          TEXT PRIMARY KEY,
  song_id     TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  lyric       TEXT NOT NULL DEFAULT '',
  is_manual   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (song_id, position)
);
CREATE INDEX IF NOT EXISTS idx_song_lines_song ON song_lines(song_id, position);

CREATE TABLE IF NOT EXISTS song_chords (
  id               TEXT PRIMARY KEY,
  line_id          TEXT NOT NULL REFERENCES song_lines(id) ON DELETE CASCADE,
  position         INTEGER NOT NULL,
  name             TEXT NOT NULL,
  column           INTEGER NOT NULL,
  timestamp_ms     INTEGER,
  timestamp_source TEXT NOT NULL DEFAULT 'none',
  confidence       REAL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE (line_id, position)
);
CREATE INDEX IF NOT EXISTS idx_song_chords_line ON song_chords(line_id, position);

CREATE TABLE IF NOT EXISTS song_transcripts (
  id          TEXT PRIMARY KEY,
  song_id     TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  video_id    TEXT NOT NULL,
  lang        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'ytdlp',
  raw         TEXT NOT NULL,
  word_count  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  UNIQUE (song_id, video_id, lang, kind)
);

CREATE TABLE IF NOT EXISTS song_video_candidates (
  id              TEXT PRIMARY KEY,
  song_id         TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  video_id        TEXT NOT NULL,
  title           TEXT,
  channel         TEXT,
  duration_ms     INTEGER,
  rank            INTEGER NOT NULL,
  has_transcript  INTEGER,
  transcript_lang TEXT,
  coverage        REAL,
  created_at      TEXT NOT NULL,
  UNIQUE (song_id, video_id)
);

CREATE TABLE IF NOT EXISTS song_edits (
  id         TEXT PRIMARY KEY,
  song_id    TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  actor      TEXT,
  action     TEXT NOT NULL,
  payload    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_song_edits_song ON song_edits(song_id, created_at);
`;
