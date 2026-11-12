import { escapeHtml } from "../render/html";
import type { Song, SongCandidate } from "./songs.model";
import { songToEditorText } from "./songs.service";

function hiddenVersion(song: Song): string {
  return `<input type="hidden" name="version" value="${song.version}">`;
}

export function renderEditor(song: Song): string {
  const id = escapeHtml(song.id);
  const rows = Math.max(12, Math.min(song.lines.length + 2, 40));
  return `<div class="song-editor-inner" data-song-version="${song.version}">
    <p class="editor-hint">Edita la canción como texto: cada renglón es una línea y un renglón vacío deja un espacio. Escribe los acordes entre corchetes pegados a su palabra, p. ej. <code>[Am]Debajo de la [G]morera</code>. Las marcas de tiempo se asignan por línea desde el reproductor (Opciones → Marcas de tiempo); las líneas que no cambies conservan la suya.</p>
    <form class="editor-form" hx-post="/songs/${id}/edit" hx-target="#song-editor-body" hx-swap="innerHTML">
      ${hiddenVersion(song)}
      <div class="editor-meta">
        <label>Título <input name="title" value="${escapeHtml(song.title)}" maxlength="200" required></label>
        <label>Artista <input name="artist" value="${escapeHtml(song.artist)}" maxlength="200" required></label>
      </div>
      <label class="editor-text-label" for="song-editor-text">Letra y acordes</label>
      <textarea id="song-editor-text" class="editor-text" name="text" rows="${rows}" wrap="off" spellcheck="false" autocapitalize="off" autocomplete="off" required>${escapeHtml(songToEditorText(song))}</textarea>
      <div class="editor-actions">
        <button type="submit">Guardar</button>
        <button type="button" class="secondary" data-editor-discard>Descartar cambios</button>
      </div>
    </form>
    <form class="editor-refresh" hx-post="/songs/${id}/refresh" hx-target="#song-editor-body" hx-swap="innerHTML" hx-confirm="Se actualizarán las líneas no editadas manualmente. ¿Continuar?">
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
