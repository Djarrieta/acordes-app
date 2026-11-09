export type AudioStatus = "none" | "fetching" | "ready" | "failed";

export type SongAudio = {
  songId: string;
  videoId: string;
  status: AudioStatus;
  error: string | null;
  mime: string | null;
  path: string | null;
  sizeBytes: number | null;
  durationMs: number | null;
  attempts: number;
  fetchedAt: string | null;
};

export function pitchRatio(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

export function clampSemitones(semitones: number): number {
  if (!Number.isInteger(semitones)) return 0;
  return Math.max(-12, Math.min(12, semitones));
}
