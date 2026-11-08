import { escapeHtml } from "../render/html";
import type { Song, SongCandidate, SongLine } from "./songs.model";

function hiddenVersion(song: Song): string {
  return `<input type="hidden" name="version" value="${song.version}">`;
}

function lineActions(song: Song, line: SongLine): string {
  const base = `/songs/${escapeHtml(song.id)}/lines`;
  return `<div class="editor-line-actions">
    <form hx-post="${base}" hx-target="#song-editor-body" hx-swap="innerHTML">
      ${hiddenVersion(song)}
      <input type="hidden" name="after" value="${escapeHtml(line.id)}">
      <button type="submit" class="secondary">Añadir línea después</button>
    </form>
    <form hx-post="${base}" hx-target="#song-editor-body" hx-swap="innerHTML">
      ${hiddenVersion(song)}
      <input type="hidden" name="after" value="${escapeHtml(line.id)}">
      <input type="hidden" name="break" value="1">
      <button type="submit" class="secondary">Añadir salto de línea</button>
    </form>
    <form hx-post="${base}/${escapeHtml(line.id)}/delete" hx-target="#song-editor-body" hx-swap="innerHTML">
      ${hiddenVersion(song)}
      <button type="submit" class="secondary danger">Eliminar línea</button>
    </form>
  </div>`;
}

export function renderEditor(song: Song): string {
  const lines = song.lines
    .map((line) => {
      const body = line.isBreak
        ? `<p class="editor-break">Salto de línea</p>`
        : `<form class="editor-line-form" hx-post="/songs/${escapeHtml(song.id)}/lines/${escapeHtml(line.id)}" hx-target="#song-editor-body" hx-swap="innerHTML">
          ${hiddenVersion(song)}
          <label class="editor-line-text"><span class="sr-only">Letra y acordes de la línea ${line.position + 1}</span>
            <textarea name="text" rows="2" maxlength="2000" spellcheck="false" required>${escapeHtml(line.text)}</textarea>
          </label>
          <button type="submit" class="secondary">Guardar línea</button>
        </form>`;
      return `<section class="editor-line" data-line-id="${escapeHtml(line.id)}">
        ${body}
        ${lineActions(song, line)}
      </section>`;
    })
    .join("");

  return `<div class="song-editor-inner" data-song-version="${song.version}">
    <h3 class="editor-lines-title">Letra y acordes</h3>
    <p class="editor-hint">Escribe los acordes entre corchetes pegados a su palabra, p. ej. <code>[Am]Debajo de la [G]morera</code>. Las marcas de tiempo van dentro del acorde: <code>[Am@12.3]</code> (segundos). No escribas columnas.</p>
    <p class="editor-hint">Versión ${song.version}. Los cambios se guardan en la canción compartida y quedan auditados.</p>
    <form class="editor-meta" hx-post="/songs/${escapeHtml(song.id)}/meta" hx-target="#song-editor-body" hx-swap="innerHTML">
      ${hiddenVersion(song)}
      <label>Título <input name="title" value="${escapeHtml(song.title)}" maxlength="200" required></label>
      <label>Artista <input name="artist" value="${escapeHtml(song.artist)}" maxlength="200" required></label>
      <button type="submit" class="secondary">Guardar datos</button>
    </form>
    <div class="editor-lines">${lines}</div>
    <form class="editor-add-line" hx-post="/songs/${escapeHtml(song.id)}/lines" hx-target="#song-editor-body" hx-swap="innerHTML">
      ${hiddenVersion(song)}
      <button type="submit" class="secondary">Añadir línea al final</button>
    </form>
    <form class="editor-refresh" hx-post="/songs/${escapeHtml(song.id)}/refresh" hx-target="#song-editor-body" hx-swap="innerHTML" hx-confirm="Se actualizarán las líneas no editadas manualmente. ¿Continuar?">
      ${hiddenVersion(song)}
      <button type="submit" class="secondary">Refrescar desde LaCuerda</button>
    </form>
  </div>`;
}

export function renderCandidates(songId: string, candidates: SongCandidate[]): string {
  if (candidates.length === 0) {
    return `<p class="editor-hint">No hay candidatos guardados. Pulsa “Buscar video” o vincula un enlace.</p>`;
  }
  const items = candidates
    .map((candidate) => {
      const meta = [
        candidate.channel,
        candidate.durationMs === null ? null : `${Math.round(candidate.durationMs / 1000)} s`,
        candidate.hasTranscript === false ? "sin subtítulos" : null,
        candidate.coverage === null ? null : `${Math.round(candidate.coverage * 100)} % cobertura`,
      ]
        .filter(Boolean)
        .map((value) => escapeHtml(String(value)))
        .join(" · ");
      return `<li class="video-candidate">
        <div class="video-candidate-copy">
          <strong>${escapeHtml(candidate.title ?? candidate.videoId)}</strong>
          <span>${meta}</span>
        </div>
        <button type="button" class="secondary" data-video-select="${escapeHtml(candidate.videoId)}" data-song-id="${escapeHtml(songId)}">Usar este video</button>
      </li>`;
    })
    .join("");
  return `<ul class="video-candidate-list">${items}</ul>`;
}
