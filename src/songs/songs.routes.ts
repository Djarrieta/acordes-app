import type { Database } from "bun:sqlite";
import { getDb } from "../db";
import { bodyTooLarge, clientIp, html, isSameOrigin, json } from "../core/http";
import { rateLimit } from "../core/ratelimit";
import { fetchLacuerdaSong } from "../parser/lacuerda";
import { renderError, renderSong } from "../render/song";
import { parseYoutubeVideoId } from "../youtube";
import {
  addChord,
  addLine,
  bumpVersion,
  clearAllTimestamps,
  clearChordTimestamp,
  clearVideo,
  deleteChord,
  deleteLine,
  getSong,
  listCandidates,
  recordEdit,
  refreshNonManualLines,
  setPreferredOffset,
  setChordTimestamp,
  setLinePosition,
  setVideo,
  updateChord,
  updateLine,
  updateSongMeta,
} from "./songs.db";
import {
  enqueueAlignment,
  enqueueVideoSearch,
} from "./enrichment/enrichment.service";
import type { Song } from "./songs.model";
import {
  MAX_CHORDS_PER_LINE,
  MAX_LINES,
  currentSong,
  readTrimmedString,
  readVersion,
  validateChordName,
  validateColumn,
  validateLineText,
  validateOffset,
} from "./songs.service";
import { renderCandidates, renderEditor } from "./songs.views";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SONG_PATH = /^\/songs\/([0-9a-f-]+)(\/.*)?$/i;

function editorResponse(song: Song, status = 200): Response {
  return html(renderEditor(song), status, { "HX-Trigger": "song-updated" });
}

function conflict(message = "La canción cambió en otro navegador. Recarga el editor."): Response {
  return html(renderError(message), 409, { "HX-Trigger": "song-stale" });
}

function badRequest(message: string): Response {
  return html(renderError(message), 400);
}

function missingSong(): Response {
  return html(renderError("La canción ya no está disponible. Vuelve a cargarla."), 404);
}

async function readForm(request: Request): Promise<FormData | null> {
  if (bodyTooLarge(request)) return null;
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

function checkWrite(request: Request, bucket: string, limit: number, windowMs: number): Response | null {
  if (!isSameOrigin(request)) {
    return html(renderError("La solicitud no tiene un origen válido."), 403);
  }
  if (!rateLimit(`${clientIp(request)}:${bucket}`, limit, windowMs)) {
    return html(renderError("Demasiadas solicitudes. Espera un momento e inténtalo de nuevo."), 429);
  }
  return null;
}

function versionGuard(song: Song, form: FormData): Response | null {
  const version = readVersion(form.get("version"));
  if (version === null) return badRequest("Falta la versión de la canción.");
  if (version !== song.version) return conflict();
  return null;
}

function editorSong(db: Database, id: string): Song | null {
  return currentSong(id, db);
}

export async function handleSongsRoutes(
  request: Request,
  url: URL,
  db: Database = getDb(),
): Promise<Response | null> {
  const match = SONG_PATH.exec(url.pathname);
  if (!match) return null;
  const songId = match[1]!;
  if (!UUID.test(songId)) return missingSong();
  const suffix = match[2] ?? "";
  const method = request.method;

  if (method === "GET" && suffix === "/player") {
    const offset = validateOffset(url.searchParams.get("offset") ?? "0") ?? 0;
    const song = getSong(db, songId);
    if (!song) return missingSong();
    return html(renderSong(song, offset));
  }

  if (method === "GET" && suffix === "/status") {
    const song = getSong(db, songId);
    if (!song) return json({ error: "La canción ya no está disponible." }, 404);
    return json({
      id: song.id,
      version: song.version,
      videoStatus: song.videoStatus,
      videoError: song.videoError,
      timestampsStatus: song.timestampsStatus,
      timestampsError: song.timestampsError,
      timestampSource: song.timestampSource,
    });
  }

  if (method === "GET" && suffix === "/videos") {
    const song = getSong(db, songId);
    if (!song) return missingSong();
    return html(renderCandidates(song.id, listCandidates(db, song.id)));
  }

  if (method === "GET" && suffix === "/edit") {
    const song = editorSong(db, songId);
    if (!song) return missingSong();
    return html(renderEditor(song));
  }

  if (method !== "POST") {
    return html(renderError("Método no permitido."), 405, { Allow: "GET, POST" });
  }

  const limit = checkWrite(request, "song-write", 180, 60_000);
  if (limit) return limit;

  if (suffix === "/transpose") {
    const form = await readForm(request);
    if (!form) return badRequest("No se pudo leer la solicitud.");
    const song = getSong(db, songId);
    if (!song) return missingSong();
    const currentOffset = validateOffset(form.get("offset") as string | null) ?? 0;
    if (form.get("reset") !== null) {
      setPreferredOffset(db, songId, 0);
      return html(renderSong(song, 0));
    }
    const deltaValue = form.get("delta");
    const delta = typeof deltaValue === "string" ? Number(deltaValue) : Number.NaN;
    if (!Number.isInteger(delta) || ![-2, -1, 1, 2].includes(delta)) {
      return badRequest("El intervalo de transposición no es válido.");
    }
    const nextOffset = currentOffset + delta;
    setPreferredOffset(db, songId, nextOffset);
    return html(renderSong(song, nextOffset));
  }

  if (suffix === "/timestamps/auto" || suffix === "/timestamps/retry") {
    if (!rateLimit(`${clientIp(request)}:timestamps`, 10, 60_000)) {
      return html(renderError("Demasiadas solicitudes de marcas. Espera un momento."), 429);
    }
    const song = getSong(db, songId);
    if (!song) return missingSong();
    if (!song.video) {
      return html(renderError("Vincula un video antes de generar marcas."), 409);
    }
    enqueueAlignment(song.id, db, suffix === "/timestamps/retry");
    return html(
      `<p class="youtube-status" role="status" aria-live="polite">Generando marcas…</p>`,
      202,
      { "HX-Trigger": "song-updated" },
    );
  }

  if (suffix === "/video") {
    const form = await readForm(request);
    if (!form) return badRequest("No se pudo leer la solicitud.");
    const song = getSong(db, songId);
    if (!song) return missingSong();

    if (form.get("clear") !== null) {
      clearVideo(db, song.id);
      recordEdit(db, song.id, "video.clear", {});
      return json({ ok: true });
    }

    const rawUrl = readTrimmedString(form.get("url"), 500);
    const rawVideoId = readTrimmedString(form.get("videoId"), 20);
    let videoId = rawVideoId && /^[a-zA-Z0-9_-]{11}$/.test(rawVideoId) ? rawVideoId : null;
    if (!videoId && rawUrl) videoId = parseYoutubeVideoId(rawUrl);
    if (!videoId) return badRequest("El enlace del video no es válido.");

    if (song.video && song.video.id !== videoId && form.get("confirm") === null) {
      return json(
        {
          error: "Cambiar de video borrará las marcas actuales.",
          requiresConfirmation: true,
        },
        409,
      );
    }

    const candidate = listCandidates(db, song.id).find((item) => item.videoId === videoId);
    if (song.video && song.video.id !== videoId) {
      clearAllTimestamps(db, song.id);
    }
    setVideo(db, song.id, {
      id: videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: candidate?.title ?? null,
      channel: candidate?.channel ?? null,
      durationMs: candidate?.durationMs ?? null,
    });
    recordEdit(db, song.id, "video.set", { videoId });
    return json({ ok: true, videoId });
  }

  if (suffix === "/video/retry") {
    if (!rateLimit(`${clientIp(request)}:video-search`, 10, 60_000)) {
      return html(renderError("Demasiadas búsquedas. Espera un momento."), 429);
    }
    const song = getSong(db, songId);
    if (!song) return missingSong();
    if (song.video) return json({ ok: true });
    enqueueVideoSearch(song.id, db);
    return html(
      `<p class="youtube-status" role="status" aria-live="polite">Buscando video…</p>`,
      202,
      { "HX-Trigger": "song-updated" },
    );
  }

  if (suffix === "/refresh") {
    const form = await readForm(request);
    if (!form) return badRequest("No se pudo leer la solicitud.");
    const song = getSong(db, songId);
    if (!song) return missingSong();
    const guard = versionGuard(song, form);
    if (guard) return guard;
    try {
      const parsed = await fetchLacuerdaSong(song.sourceUrl);
      const result = refreshNonManualLines(db, song.id, {
        sourceKey: song.sourceKey,
        sourceUrl: song.sourceUrl,
        title: parsed.title,
        artist: parsed.artist,
        lines: parsed.lines.map((line) => ({
          lyric: line.lyric,
          chords: line.chords.map((chord) => ({ name: chord.chord, column: chord.column })),
        })),
      });
      updateSongMeta(db, song.id, parsed.title, parsed.artist);
      bumpVersion(db, song.id);
      recordEdit(db, song.id, "song.refresh", result);
      const updated = editorSong(db, song.id);
      return updated ? editorResponse(updated) : missingSong();
    } catch (error) {
      console.error("No se pudo refrescar la canción:", error);
      return html(
        renderError("No se pudo refrescar la canción desde LaCuerda. Inténtalo más tarde."),
        502,
      );
    }
  }

  const chordTimestamp = /^\/chords\/([^/]+)\/timestamp(\/clear)?$/.exec(suffix);
  if (chordTimestamp) {
    const chordId = decodeURIComponent(chordTimestamp[1]!);
    const form = await readForm(request);
    if (!form) return badRequest("No se pudo leer la solicitud.");
    if (chordTimestamp[2]) {
      if (!clearChordTimestamp(db, songId, chordId)) return missingSong();
      recordEdit(db, songId, "timestamp.clear", { chordId });
      return json({ ok: true, timestampMs: null });
    }
    const raw = form.get("ms");
    const ms = typeof raw === "string" ? Number(raw) : Number.NaN;
    if (!Number.isSafeInteger(ms) || ms < 0 || ms > 24 * 60 * 60 * 1000) {
      return json({ error: "La marca de tiempo no es válida." }, 400);
    }
    if (!setChordTimestamp(db, songId, chordId, ms, "manual")) return missingSong();
    recordEdit(db, songId, "timestamp.set", { chordId, ms });
    return json({ ok: true, timestampMs: ms });
  }

  if (suffix === "/lines" && method === "POST") {
    const form = await readForm(request);
    if (!form) return badRequest("No se pudo leer la solicitud.");
    const song = getSong(db, songId);
    if (!song) return missingSong();
    const guard = versionGuard(song, form);
    if (guard) return guard;
    if (song.lines.length >= MAX_LINES) {
      return badRequest(`La canción no puede tener más de ${MAX_LINES} líneas.`);
    }
    addLine(db, song.id);
    bumpVersion(db, song.id);
    recordEdit(db, song.id, "line.add", {});
    const updated = editorSong(db, song.id);
    return updated ? editorResponse(updated) : missingSong();
  }

  const lineRoute = /^\/lines\/([^/]+)(\/delete|\/chords)?$/.exec(suffix);
  if (lineRoute) {
    const lineId = decodeURIComponent(lineRoute[1]!);
    const action = lineRoute[2] ?? "";
    const form = await readForm(request);
    if (!form) return badRequest("No se pudo leer la solicitud.");
    const song = getSong(db, songId);
    if (!song) return missingSong();
    const line = song.lines.find((item) => item.id === lineId);
    if (!line) return missingSong();
    const guard = versionGuard(song, form);
    if (guard) return guard;

    if (action === "/delete") {
      deleteLine(db, song.id, lineId);
      bumpVersion(db, song.id);
      recordEdit(db, song.id, "line.delete", { lineId });
      const updated = editorSong(db, song.id);
      return updated ? editorResponse(updated) : missingSong();
    }

    if (action === "/chords") {
      const name = validateChordName(form.get("name"));
      const column = validateColumn(form.get("column"), line.lyric.length);
      if (!name) return badRequest("El nombre del acorde no es válido.");
      if (column === null) return badRequest("La columna del acorde no es válida.");
      if (line.chords.length >= MAX_CHORDS_PER_LINE) {
        return badRequest(`Una línea no puede tener más de ${MAX_CHORDS_PER_LINE} acordes.`);
      }
      addChord(db, song.id, lineId, { name, column });
      bumpVersion(db, song.id);
      recordEdit(db, song.id, "chord.add", { lineId, name, column });
      const updated = editorSong(db, song.id);
      return updated ? editorResponse(updated) : missingSong();
    }

    const lyric = validateLineText(form.get("lyric"));
    if (lyric === null) return badRequest("El texto de la línea no es válido.");
    updateLine(db, song.id, lineId, lyric);
    const positionValue = form.get("position");
    if (positionValue !== null) {
      const position = Number(positionValue);
      if (!Number.isSafeInteger(position) || position < 0 || position >= song.lines.length) {
        return badRequest("La posición de la línea no es válida.");
      }
      if (position !== line.position) setLinePosition(db, song.id, lineId, position);
    }
    bumpVersion(db, song.id);
    recordEdit(db, song.id, "line.update", { lineId, lyric });
    const updated = editorSong(db, song.id);
    return updated ? editorResponse(updated) : missingSong();
  }

  const chordRoute = /^\/chords\/([^/]+)(\/delete)?$/.exec(suffix);
  if (chordRoute) {
    const chordId = decodeURIComponent(chordRoute[1]!);
    const form = await readForm(request);
    if (!form) return badRequest("No se pudo leer la solicitud.");
    const song = getSong(db, songId);
    if (!song) return missingSong();
    const guard = versionGuard(song, form);
    if (guard) return guard;
    if (chordRoute[2]) {
      if (!deleteChord(db, song.id, chordId)) return missingSong();
      bumpVersion(db, song.id);
      recordEdit(db, song.id, "chord.delete", { chordId });
      const updated = editorSong(db, song.id);
      return updated ? editorResponse(updated) : missingSong();
    }
    const lyricLength =
      song.lines.find((line) => line.chords.some((chord) => chord.id === chordId))?.lyric.length ?? 0;
    const name = validateChordName(form.get("name"));
    const column = validateColumn(form.get("column"), lyricLength);
    if (!name) return badRequest("El nombre del acorde no es válido.");
    if (column === null) return badRequest("La columna del acorde no es válida.");
    if (!updateChord(db, song.id, chordId, { name, column })) return missingSong();
    bumpVersion(db, song.id);
    recordEdit(db, song.id, "chord.update", { chordId, name, column });
    const updated = editorSong(db, song.id);
    return updated ? editorResponse(updated) : missingSong();
  }

  if (suffix === "/meta") {
    const form = await readForm(request);
    if (!form) return badRequest("No se pudo leer la solicitud.");
    const song = getSong(db, songId);
    if (!song) return missingSong();
    const guard = versionGuard(song, form);
    if (guard) return guard;
    const title = readTrimmedString(form.get("title"), 200)?.trim();
    const artist = readTrimmedString(form.get("artist"), 200)?.trim();
    if (!title || !artist) return badRequest("El título y el artista son obligatorios.");
    updateSongMeta(db, song.id, title, artist);
    bumpVersion(db, song.id);
    recordEdit(db, song.id, "song.meta", { title, artist });
    const updated = editorSong(db, song.id);
    return updated ? editorResponse(updated) : missingSong();
  }

  return html(renderError("Ruta de canción no encontrada."), 404);
}
