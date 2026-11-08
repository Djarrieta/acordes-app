import { escapeHtml } from "../render/html";
import type { Song, SongCandidate } from "./songs.model";

function hiddenVersion(song: Song): string {
  return `<input type="hidden" name="version" value="${song.version}">`;
}

function editorChords(song: Song, lineId: string, linePosition: number): string {
  const line = song.lines.find((item) => item.id === lineId);
  if (!line) return "";
  const chords = line.chords
    .map(
      (chord) => `<li class="editor-chord">
        <form class="editor-chord-form" hx-post="/songs/${escapeHtml(song.id)}/chords/${escapeHtml(chord.id)}" hx-target="#song-editor-body" hx-swap="innerHTML">
          ${hiddenVersion(song)}
          <label>Acorde <input name="name" value="${escapeHtml(chord.name)}" maxlength="30" required></label>
          <label>Columna <input name="column" type="number" min="0" step="1" value="${chord.column}" required></label>
          <button type="submit" class="secondary">Guardar</button>
        </form>
        <form hx-post="/songs/${escapeHtml(song.id)}/chords/${escapeHtml(chord.id)}/delete" hx-target="#song-editor-body" hx-swap="innerHTML">
          ${hiddenVersion(song)}
          <button type="submit" class="secondary danger">Eliminar</button>
        </form>
      </li>`,
    )
    .join("");

  return `<ul class="editor-chords">${chords}</ul>
    <form class="editor-add-chord" hx-post="/songs/${escapeHtml(song.id)}/lines/${escapeHtml(lineId)}/chords" hx-target="#song-editor-body" hx-swap="innerHTML">
      ${hiddenVersion(song)}
      <input type="hidden" name="linePosition" value="${linePosition}">
      <label>Nuevo acorde <input name="name" maxlength="30" placeholder="Am" required></label>
      <label>Columna <input name="column" type="number" min="0" step="1" value="0" required></label>
      <button type="submit" class="secondary">Añadir acorde</button>
    </form>`;
}

export function renderEditor(song: Song): string {
  const lines = song.lines
    .map(
      (line) => `<section class="editor-line" data-line-id="${escapeHtml(line.id)}">
        <form class="editor-line-form" hx-post="/songs/${escapeHtml(song.id)}/lines/${escapeHtml(line.id)}" hx-target="#song-editor-body" hx-swap="innerHTML">
          ${hiddenVersion(song)}
          <label class="editor-line-text">Letra
            <textarea name="lyric" rows="2" maxlength="2000">${escapeHtml(line.lyric)}</textarea>
          </label>
          <label class="editor-line-position">Posición
            <input name="position" type="number" min="0" step="1" value="${line.position}">
          </label>
          <button type="submit" class="secondary">Guardar línea</button>
        </form>
        ${editorChords(song, line.id, line.position)}
        <form hx-post="/songs/${escapeHtml(song.id)}/lines/${escapeHtml(line.id)}/delete" hx-target="#song-editor-body" hx-swap="innerHTML">
          ${hiddenVersion(song)}
          <button type="submit" class="secondary danger">Eliminar línea</button>
        </form>
      </section>`,
    )
    .join("");

  return `<div class="song-editor-inner" data-song-version="${song.version}">
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
