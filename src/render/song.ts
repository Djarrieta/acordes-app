import type { SongLine } from "../parser/lacuerda";
import type { SongState } from "../state";
import { transposeChord } from "../transpose/chords";
import { escapeHtml } from "./html";

type PositionedChord = { chord: string; index: number; column: number };
type WordRange = { start: number; end: number; chords: PositionedChord[] };

function renderChordButton(chord: string, index: number): string {
  return `<button type="button" class="chord-trigger" data-chord-index="${index}" data-chord-name="${escapeHtml(chord)}" aria-label="Ver diagrama de ${escapeHtml(chord)}" hx-get="/chord-diagram?chord=${encodeURIComponent(chord)}" hx-target="#chord-viewer" hx-swap="innerHTML">${escapeHtml(chord)}<span class="chord-time-marker" aria-hidden="true"></span></button>`;
}

function positionChords(
  line: SongLine,
  offset: number,
  firstChordIndex: number,
): PositionedChord[] {
  return line.chords.map((token, index) => ({
    chord: transposeChord(token.chord, offset),
    index: firstChordIndex + index,
    column: token.column,
  }));
}

function renderChordRow(chords: PositionedChord[], start: number): string {
  let output = "";
  let position = 0;
  for (const chord of chords) {
    const target = Math.max(chord.column - start, position);
    output += " ".repeat(target - position);
    output += renderChordButton(chord.chord, chord.index);
    position = target + chord.chord.length;
  }
  return output;
}

function splitWords(lyric: string): WordRange[] {
  const words: WordRange[] = [];
  for (const match of lyric.matchAll(/\S+/g)) {
    words.push({ start: match.index, end: match.index + match[0].length, chords: [] });
  }
  return words;
}

function assignChords(words: WordRange[], chords: PositionedChord[]): void {
  for (const chord of chords) {
    const target = words.find((word) => chord.column >= word.start && chord.column < word.end)
      ?? words.find((word) => word.start > chord.column)
      ?? words.at(-1);
    target?.chords.push(chord);
  }
}

function renderWord(word: WordRange, lyric: string): string {
  const chordRow = renderChordRow(word.chords, word.start);
  const text = escapeHtml(lyric.slice(word.start, word.end));
  return `<span class="song-word"><span class="song-word-chords">${chordRow || "&nbsp;"}</span><span class="song-word-text">${text}</span></span>`;
}

function renderSongLine(
  line: SongLine,
  offset: number,
  lineIndex: number,
  firstChordIndex: number,
): string {
  const chords = positionChords(line, offset, firstChordIndex);
  const words = splitWords(line.lyric);
  let content: string;
  if (words.length === 0) {
    const chordRow = renderChordRow(chords, 0);
    content = chordRow
      ? `<span class="song-word"><span class="song-word-chords">${chordRow}</span><span class="song-word-text">&nbsp;</span></span>`
      : "&nbsp;";
  } else {
    assignChords(words, chords);
    const parts: string[] = [];
    const leading = words[0].start;
    if (leading > 0) {
      parts.push(`<span class="song-word"><span class="song-word-text">${"&nbsp;".repeat(leading)}</span></span>`);
    }
    for (const word of words) parts.push(renderWord(word, line.lyric));
    content = parts.join(" ");
  }
  return `<div class="song-line" data-lyric-index="${lineIndex}">
    <span class="song-line-text">${content}</span>
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
    <div class="song-title-block"><p class="eyebrow">${escapeHtml(state.parsed.artist)}</p><h2 id="selected-song-title" tabindex="-1">${escapeHtml(state.parsed.title)}</h2></div>
    <div class="song-header-actions">
      <button type="button" class="song-back-button secondary" data-wizard-search aria-label="Volver a la búsqueda">← Volver</button>
      <button class="favorite-toggle song-favorite-toggle" type="button" data-favorite-toggle data-song-id="${songId}" data-song-title="${escapeHtml(state.parsed.title)}" data-song-artist="${escapeHtml(state.parsed.artist)}" aria-label="Añadir ${escapeHtml(state.parsed.title)} a canciones que me gustan" title="Añadir a canciones que me gustan" aria-pressed="false"><svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z"/></svg></button>
    </div>
  </header>
  <div class="song-playback-layout">
    <aside class="song-aside" aria-label="Acorde y opciones">
      <div class="youtube-media-pair" data-youtube-media hidden>
        <div class="youtube-media-box accompaniment-chord-box" id="accompaniment-chord-viewer" aria-live="polite">
          <p class="accompaniment-chord-placeholder">El acorde actual aparecerá aquí cuando empiece la reproducción.</p>
        </div>
        <div class="youtube-media-box youtube-player-frame" data-youtube-player aria-label="Video de acompañamiento"></div>
      </div>
      <div class="youtube-playback-controls" data-youtube-playback-controls hidden>
        <div class="youtube-progress" aria-label="Progreso de la canción">
          <span class="youtube-progress-time" data-youtube-progress-current>0:00</span>
          <div class="youtube-progress-track">
            <input type="range" class="youtube-progress-slider" data-youtube-progress min="0" max="0" step="0.1" value="0" aria-label="Posición de la canción" disabled>
          </div>
          <span class="youtube-progress-time" data-youtube-progress-duration>0:00</span>
        </div>
        <button type="button" class="youtube-play-button" data-youtube-play disabled aria-label="Reproducir audio">▶ <span>Reproducir audio</span></button>
      </div>
      <details class="song-options" data-song-options open>
        <summary class="song-options-summary">
          <span>Opciones</span>
          <span class="song-options-hint">Transposición y acompañamiento</span>
        </summary>
        <div class="song-options-panel">
          <div class="song-controls" aria-label="Transponer canción">
            ${controls}
            <button type="button" class="secondary" hx-post="/reset" hx-vals='{"id":"${id}"}' hx-target="#song-container" hx-swap="innerHTML">Original</button>
            <output class="transpose-status">${transpositionLabel(state.offset)}</output>
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
                <p class="youtube-status" data-youtube-status role="status" aria-live="polite">Busca un video, copia su enlace y pégalo aquí.</p>
              </form>
              <button type="button" class="youtube-unlink secondary" data-youtube-unlink hidden>Quitar video</button>
              <button type="button" class="chord-mark-toggle" data-chord-mark-toggle aria-pressed="false" disabled>Activar marcas de acordes</button>
              <p class="youtube-help">Con las marcas activadas, pulsa cada acorde mientras suena para asignarle el tiempo actual. Al cerrar este panel, los acordes vuelven a abrir sus diagramas.</p>
            </div>
          </details>
        </div>
      </details>
    </aside>
    <div class="song song-lyrics" aria-label="Letra y acordes">${lyrics}</div>
  </div>
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
</section>`;
}

export function renderError(message: string): string {
  return `<p class="error" role="alert">${escapeHtml(message)}</p>`;
}
