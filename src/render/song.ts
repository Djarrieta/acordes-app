import type { ChordToken, SongLine } from "../parser/lacuerda";
import type { SongState } from "../state";
import { transposeChord } from "../transpose/chords";
import { escapeHtml } from "./html";

function renderChordLine(chords: ChordToken[], offset: number, firstChordIndex: number): string {
  let output = "";
  let position = 0;
  for (const [index, token] of chords.entries()) {
    const chord = transposeChord(token.chord, offset);
    const target = Math.max(token.column, position);
    output += " ".repeat(target - position);
    output += `<button type="button" class="chord-trigger" data-chord-index="${firstChordIndex + index}" data-chord-name="${escapeHtml(chord)}" aria-label="Ver diagrama de ${escapeHtml(chord)}" hx-get="/chord-diagram?chord=${encodeURIComponent(chord)}" hx-target="#chord-viewer" hx-swap="innerHTML">${escapeHtml(chord)}<span class="chord-time-marker" aria-hidden="true"></span></button>`;
    position = target + chord.length;
  }
  return output;
}

function renderSongLine(
  line: SongLine,
  offset: number,
  lineIndex: number,
  firstChordIndex: number,
): string {
  const chordLine =
    line.chords.length === 0
      ? ""
      : `<span class="chords">${renderChordLine(line.chords, offset, firstChordIndex)}</span><br>`;
  return `<div class="song-line" data-lyric-index="${lineIndex}">
    <span class="song-line-text">${chordLine}${escapeHtml(line.lyric)}</span>
  </div>`;
}

function transpositionLabel(offset: number): string {
  if (offset === 0) return "Tonalidad original";
  const amount = Math.abs(offset);
  return `${offset > 0 ? "+" : "-"}${amount} ${amount === 1 ? "semitono" : "semitonos"}`;
}

export function renderSong(state: SongState): string {
  const id = escapeHtml(state.id);
  const songId = escapeHtml(new URL(state.url).pathname);
  const offset = String(state.offset);
  const controls = [
    { label: "+1 tono", delta: 2 },
    { label: "+½ tono", delta: 1 },
    { label: "-½ tono", delta: -1 },
    { label: "-1 tono", delta: -2 },
  ]
    .map(
      ({ label, delta }) =>
        `<button type="button" hx-post="/transpose" hx-vals='{"id":"${id}","delta":${delta}}' hx-target="#song-container" hx-swap="innerHTML">${label}</button>`,
    )
    .join("\n");
  let chordIndex = 0;
  const lyrics = state.parsed.lines
    .map((line, lineIndex) => {
      const rendered = renderSongLine(line, state.offset, lineIndex, chordIndex);
      chordIndex += line.chords.length;
      return rendered;
    })
    .join("");
  const searchQuery = encodeURIComponent(`${state.parsed.artist} ${state.parsed.title}`);

  return `<section class="song-card" aria-label="Canción transpuesta" data-song-id="${songId}" data-offset="${offset}">
  <header class="song-header">
    <div><p class="eyebrow">${escapeHtml(state.parsed.artist)}</p><h2 id="selected-song-title" tabindex="-1">${escapeHtml(state.parsed.title)}</h2></div>
    <button class="favorite-toggle song-favorite-toggle" type="button" data-favorite-toggle data-song-id="${songId}" data-song-title="${escapeHtml(state.parsed.title)}" data-song-artist="${escapeHtml(state.parsed.artist)}" aria-label="Añadir ${escapeHtml(state.parsed.title)} a canciones que me gustan" title="Añadir a canciones que me gustan" aria-pressed="false"><svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z"/></svg></button>
  </header>
  <div class="song-controls" aria-label="Transponer canción">
    ${controls}
    <button type="button" class="secondary" hx-post="/reset" hx-vals='{"id":"${id}"}' hx-target="#song-container" hx-swap="innerHTML">Original</button>
    <output class="transpose-status">${transpositionLabel(state.offset)}</output>
  </div>
  <div class="youtube-media-pair" data-youtube-media hidden>
    <div class="youtube-media-box accompaniment-chord-box" id="accompaniment-chord-viewer" aria-live="polite">
      <p class="accompaniment-chord-placeholder">El acorde actual aparecerá aquí cuando empiece la reproducción.</p>
    </div>
    <div class="youtube-media-box youtube-player-frame" data-youtube-player aria-label="Video de acompañamiento"></div>
  </div>
  <div class="youtube-playback-controls" data-youtube-playback-controls hidden>
    <button type="button" class="youtube-play-button" data-youtube-play disabled aria-label="Reproducir audio">▶ <span>Reproducir audio</span></button>
  </div>
  <details class="youtube-section" data-youtube-song="${songId}">
    <summary class="youtube-summary">
      <span><span class="eyebrow">Acompañamiento</span><strong>YouTube</strong></span>
      <span class="youtube-summary-state" data-youtube-summary-state>Configurar audio y marcas</span>
    </summary>
    <div class="youtube-panel" aria-label="Opciones de acompañamiento">
      <div class="youtube-header">
        <p>Vincula un video para escuchar la canción mientras ves los acordes.</p>
        <a class="youtube-search-link" href="https://www.youtube.com/results?search_query=${searchQuery}" target="_blank" rel="noopener noreferrer">Buscar en YouTube</a>
      </div>
    <form class="youtube-link-form">
      <label for="youtube-url">Pega el enlace del video</label>
      <div class="youtube-link-row">
        <input id="youtube-url" name="url" type="url" inputmode="url" placeholder="https://www.youtube.com/watch?v=…" autocomplete="url" required>
        <button type="submit">Vincular video</button>
      </div>
      <button type="button" class="youtube-unlink secondary" data-youtube-unlink hidden>Quitar video</button>
      <p class="youtube-status" data-youtube-status role="status" aria-live="polite">Busca un video, copia su enlace y pégalo aquí.</p>
    </form>
    <button type="button" class="chord-mark-toggle" data-chord-mark-toggle aria-pressed="false" disabled>Activar marcas de acordes</button>
    <p class="youtube-help">Con las marcas activadas, pulsa cada acorde mientras suena para asignarle el tiempo actual. Al cerrar este panel, los acordes vuelven a abrir sus diagramas.</p>
    </div>
  </details>
  <dialog id="chord-modal" class="chord-modal" aria-labelledby="chord-modal-title">
    <div class="chord-modal-content">
      <header class="chord-modal-header">
        <div><p class="eyebrow">Guitarra</p><h2 id="chord-modal-title">Digitación del acorde</h2></div>
        <form method="dialog"><button class="chord-modal-close" aria-label="Cerrar diagrama">×</button></form>
      </header>
      <div id="chord-viewer" class="chord-viewer" aria-live="polite">
        <p>Selecciona un acorde de la canción para ver cómo tocarlo.</p>
      </div>
    </div>
  </dialog>
  <div class="song song-lyrics" aria-label="Letra y acordes">${lyrics}</div>
</section>`;
}

export function renderError(message: string): string {
  return `<p class="error" role="alert">${escapeHtml(message)}</p>`;
}
