export type TimestampSource = "none" | "auto" | "manual";
export type SongTimestampSource = "none" | "auto" | "manual" | "mixed";
export type VideoStatus = "none" | "searching" | "ready" | "failed" | "skipped";
export type TimestampsStatus =
  | "none"
  | "pending"
  | "transcribing"
  | "aligning"
  | "ready"
  | "partial"
  | "failed";
export type TranscriptKind = "manual" | "asr";

export type SongChord = {
  id: string;
  position: number;
  name: string;
  column: number;
  timestampMs: number | null;
  timestampSource: TimestampSource;
  confidence: number | null;
};

export type SongLine = {
  id: string;
  position: number;
  lyric: string;
  isManual: boolean;
  chords: SongChord[];
};

export type SongVideo = {
  id: string;
  url: string;
  title: string | null;
  channel: string | null;
  durationMs: number | null;
};

export type Song = {
  id: string;
  source: "lacuerda";
  sourceKey: string;
  sourceUrl: string;
  title: string;
  artist: string;
  video: SongVideo | null;
  timestampSource: SongTimestampSource;
  timestampConfidence: number | null;
  videoStatus: VideoStatus;
  videoError: string | null;
  timestampsStatus: TimestampsStatus;
  timestampsError: string | null;
  timestampsAttempts: number;
  version: number;
  lines: SongLine[];
  createdAt: string;
  updatedAt: string;
};

export type SongCandidate = {
  id: string;
  videoId: string;
  title: string | null;
  channel: string | null;
  durationMs: number | null;
  rank: number;
  hasTranscript: boolean | null;
  transcriptLang: string | null;
  coverage: number | null;
  url: string;
};

export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}
