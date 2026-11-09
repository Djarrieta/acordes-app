import { config } from "../../config";
import { getDb } from "../../db";
import {
  applyAutoTimestamps,
  getSong,
  incrementTimestampsAttempts,
  listCandidates,
  listSongsNeedingResume,
  recordEdit,
  replaceCandidates,
  saveTranscript,
  setTimestampsStatus,
  setVideo,
  setVideoStatus,
  updateCandidateTranscript,
  type CandidateInput,
} from "../songs.db";
import { alignLyrics } from "./align";
import { searchYoutubeVideos, type VideoCandidate } from "./youtube.search";
import { fetchTranscript, type Transcript } from "./youtube.transcript";
import { enqueueAudioDownload } from "../../audio/audio.service";

type Providers = {
  search: (artist: string, title: string, max: number) => Promise<VideoCandidate[]>;
  transcript: typeof fetchTranscript;
};

const defaultProviders: Providers = {
  search: searchYoutubeVideos,
  transcript: fetchTranscript,
};

let providers: Providers = defaultProviders;

export function setEnrichmentProvidersForTests(next: Partial<Providers>): void {
  providers = { ...defaultProviders, ...next };
}

export function resetEnrichmentProviders(): void {
  providers = defaultProviders;
}

let transcriptChain: Promise<void> = Promise.resolve();
const pending = new Set<Promise<unknown>>();
const searching = new Set<string>();

function track<T>(promise: Promise<T>): Promise<T> {
  pending.add(promise);
  void promise.finally(() => pending.delete(promise));
  return promise;
}

function enqueueTranscript(task: () => Promise<void>): Promise<void> {
  const run = transcriptChain.then(task).catch((error) => {
    console.error("Error en un trabajo de marcas automáticas:", error);
  });
  transcriptChain = run;
  return track(run);
}

export async function waitForEnrichment(): Promise<void> {
  while (pending.size > 0) {
    await Promise.allSettled([...pending]);
  }
}

export function enqueueVideoSearch(songId: string, db = getDb()): void {
  if (!config.videoSearchEnabled || searching.has(songId)) return;
  const song = getSong(db, songId);
  if (!song || song.video) return;
  searching.add(songId);
  setVideoStatus(db, songId, "searching");
  void track(
    runVideoSearch(db, songId).finally(() => {
      searching.delete(songId);
    }),
  );
}

async function runVideoSearch(db: ReturnType<typeof getDb>, songId: string): Promise<void> {
  const song = getSong(db, songId);
  if (!song) return;
  try {
    const candidates = await providers.search(song.artist, song.title, config.videoMaxCandidates);
    if (candidates.length === 0) {
      setVideoStatus(db, songId, "failed", "No se encontró ningún video en YouTube.");
      return;
    }
    const rows: CandidateInput[] = candidates.map((candidate) => ({
      videoId: candidate.videoId,
      title: candidate.title || null,
      channel: candidate.channel || null,
      durationMs: candidate.durationMs,
      rank: candidate.rank,
      hasTranscript: null,
      transcriptLang: null,
      coverage: null,
    }));
    replaceCandidates(db, songId, rows);
    const best = candidates[0]!;
    setVideo(db, songId, {
      id: best.videoId,
      url: `https://www.youtube.com/watch?v=${best.videoId}`,
      title: best.title || null,
      channel: best.channel || null,
      durationMs: best.durationMs,
    });
    recordEdit(db, songId, "video.auto", { videoId: best.videoId });
    enqueueAudioDownload(songId, db);
    enqueueAlignment(songId, db);
  } catch (error) {
    console.error("No se pudo buscar el video automáticamente:", error);
    setVideoStatus(
      db,
      songId,
      "failed",
      "No se pudo buscar el video. Puedes vincular un enlace manualmente.",
    );
  }
}

export function enqueueAlignment(songId: string, db = getDb(), force = false): void {
  if (!config.timestampsEnabled) return;
  const song = getSong(db, songId);
  if (!song) return;
  if (!song.video) {
    setTimestampsStatus(db, songId, "failed", "Vincula un video antes de generar marcas.");
    return;
  }
  if (song.timestampsStatus === "pending" || song.timestampsStatus === "transcribing" || song.timestampsStatus === "aligning") {
    return;
  }
  if (!force && song.timestampsAttempts >= config.timestampsMaxAttempts) {
    setTimestampsStatus(db, songId, "failed", "Se alcanzó el límite de intentos para esta canción.");
    return;
  }
  setTimestampsStatus(db, songId, "pending");
  void enqueueTranscript(() => runAlignment(db, songId));
}

async function runAlignment(db: ReturnType<typeof getDb>, songId: string): Promise<void> {
  const song = getSong(db, songId);
  if (!song?.video) {
    setTimestampsStatus(db, songId, "failed", "Vincula un video antes de generar marcas.");
    return;
  }
  incrementTimestampsAttempts(db, songId);
  setTimestampsStatus(db, songId, "transcribing");
  const candidates = listCandidates(db, songId);
  const attempts = [
    { videoId: song.video.id, title: song.video.title, channel: song.video.channel, durationMs: song.video.durationMs },
    ...candidates
      .filter((candidate) => candidate.videoId !== song.video!.id)
      .map((candidate) => ({
        videoId: candidate.videoId,
        title: candidate.title,
        channel: candidate.channel,
        durationMs: candidate.durationMs,
      })),
  ];
  let transcript: Transcript | null = null;
  let chosenVideoId = song.video.id;
  for (const attempt of attempts) {
    try {
      transcript = await providers.transcript(attempt.videoId);
    } catch (error) {
      console.error("No se pudo transcribir el video:", error);
      transcript = null;
    }
    if (transcript) {
      chosenVideoId = attempt.videoId;
      if (attempt.videoId !== song.video.id) {
        setVideo(db, songId, {
          id: attempt.videoId,
          url: `https://www.youtube.com/watch?v=${attempt.videoId}`,
          title: attempt.title,
          channel: attempt.channel,
          durationMs: attempt.durationMs,
        });
        recordEdit(db, songId, "video.auto", { videoId: attempt.videoId });
        enqueueAudioDownload(songId, db);
      }
      break;
    }
    updateCandidateTranscript(db, songId, attempt.videoId, false, null);
  }
  if (!transcript) {
    setTimestampsStatus(
      db,
      songId,
      "failed",
      "Ningún video disponible tiene subtítulos utilizables. Elige otro candidato o marca los acordes a mano.",
    );
    return;
  }

  saveTranscript(db, {
    songId,
    videoId: chosenVideoId,
    lang: transcript.lang,
    kind: transcript.kind,
    raw: transcript.raw,
    wordCount: transcript.words.length,
  });

  setTimestampsStatus(db, songId, "aligning");
  const result = alignLyrics(
    {
      lines: song.lines.map((line) => ({
        id: line.id,
        lyric: line.lyric,
        chords: line.chords.map((chord) => ({ index: chord.position, column: chord.column })),
      })),
    },
    transcript.words,
  );

  updateCandidateTranscript(db, songId, chosenVideoId, true, result.coverage);

  if (result.coverage >= 0.6 && result.lineCoverage >= 0.5 && result.updates.length > 0) {
    applyAutoTimestamps(db, songId, result.updates);
    setTimestampsStatus(db, songId, "ready", null, result.coverage);
    recordEdit(db, songId, "timestamps.auto", {
      coverage: result.coverage,
      lineCoverage: result.lineCoverage,
      chords: result.updates.length,
    });
    return;
  }

  setTimestampsStatus(
    db,
    songId,
    "partial",
    `Cobertura baja (${Math.round(result.coverage * 100)} % de palabras, ${Math.round(
      result.lineCoverage * 100,
    )} % de líneas). Revisa la letra o marca los acordes a mano.`,
    result.coverage,
  );
  recordEdit(db, songId, "timestamps.partial", {
    coverage: result.coverage,
    lineCoverage: result.lineCoverage,
  });
}

export function resumePendingJobs(db = getDb()): void {
  for (const job of listSongsNeedingResume(db, config.timestampsMaxAttempts)) {
    if (job.videoStatus === "searching") {
      setVideoStatus(db, job.id, "none");
      enqueueVideoSearch(job.id, db);
    }
    if (["pending", "transcribing", "aligning"].includes(job.timestampsStatus)) {
      setTimestampsStatus(db, job.id, "none");
      enqueueAlignment(job.id, db);
    }
  }
}
