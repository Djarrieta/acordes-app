import { transposeChord } from "../transpose/chords";
import type { SongAudio } from "../audio/audio.model";
import type { Song, SongChord, SongLine } from "../songs/songs.model";
import { escapeHtml } from "./html";

type PositionedChord = {
  id: string;
  chord: string;
  index: number;
  column: number;
  timestampMs: number | null;
};
type WordRange = { start: number; end: number; chords: PositionedChord[] };

export function formatTimestampMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours > 0
    ? `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function renderChordButton(chord: PositionedChord): string {
  const label = escapeHtml(chord.chord);
  const timeAttribute =
    chord.timestampMs === null ? "" : ` data-chord-time="${chord.timestampMs}"`;
  const marker = chord.timestampMs === null ? "" : formatTimestampMs(chord.timestampMs);
  const timeTitle =
    chord.timestampMs === null
      ? ""
      : ` title="Marca de reproducción: ${formatTimestampMs(chord.timestampMs)}"`;
  return `<button type="button" class="chord-trigger" data-chord-id="${escapeHtml(chord.id)}" data-chord-index="${chord.index}" data-chord-name="${label}"${timeAttribute}${timeTitle} aria-label="Ver diagrama de ${label}" hx-get="/chord-diagram?chord=${encodeURIComponent(chord.chord)}" hx-target="#chord-viewer" hx-swap="innerHTML">${label}<span class="chord-time-marker" aria-hidden="true">${marker}</span></button>`;
}

function positionChords(
  line: SongLine,
  offset: number,
  firstChordIndex: number,
): PositionedChord[] {
  return line.chords.map((chord: SongChord, index) => ({
    id: chord.id,
    chord: transposeChord(chord.name, offset),
    index: firstChordIndex + index,
    column: chord.column,
    timestampMs: chord.timestampMs,
  }));
}

function renderChordRow(chords: PositionedChord[], start: number): string {
  let output = "";
  let position = 0;
  for (const chord of chords) {
    const target = Math.max(chord.column - start, position);
    output += " ".repeat(target - position);
    output += renderChordButton(chord);
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
  return `<div class="song-line" data-lyric-index="${lineIndex}" data-line-id="${escapeHtml(line.id)}">
    <span class="song-line-text">${content}</span>
  </div>`;
}

function transpositionLabel(offset: number): string {
  if (offset === 0) return "Tonalidad original";
  const amount = Math.abs(offset);
  return `${offset > 0 ? "+" : "-"}${amount} ${amount === 1 ? "semitono" : "semitonos"}`;
}

function isBusySong(song: Song): boolean {
  return song.videoStatus === "searching" || ["pending", "transcribing", "aligning"].includes(song.timestampsStatus);
}

function renderLoader(): string {
  return `<div class="song-loader" role="status" aria-live="polite"><span class="song-loader-spinner" aria-hidden="true"></span><span>Cargando…</span></div>`;
}

function renderTimestampsWarning(song: Song): string {
  if (!song.timestampsError) return "";
  if (song.timestampsStatus !== "partial" && song.timestampsStatus !== "failed") return "";
  return `<div class="timestamps-warning" role="alert">
    <p>${escapeHtml(song.timestampsError)}</p>
    <button type="button" class="secondary" data-song-view="options">Ir a Opciones para corregirlo</button>
  </div>`;
}

function renderVideoPanel(song: Song, searchQuery: string): string {
  const video = song.video;
  const busyTimestamps = ["pending", "transcribing", "aligning"].includes(song.timestampsStatus);
  const busy = isBusySong(song);
  const statusMessage = song.timestampsError
    ? `<p class="enrichment-error" role="alert">${escapeHtml(song.timestampsError)}</p>`
    : busy
      ? renderLoader()
      : "";
  const videoError = song.videoError
    ? `<p class="enrichment-error" role="alert">${escapeHtml(song.videoError)}</p>`
    : "";

  const videoSummary = video
    ? `<div class="video-current">
        <p class="video-current-title">${escapeHtml(video.title ?? "Video vinculado")}</p>
        <p class="video-current-meta">${escapeHtml(video.channel ?? "")}</p>
      </div>`
    : "";

  const retryVideo =
    song.videoStatus === "failed" || song.videoStatus === "none"
      ? `<button type="button" class="secondary" data-video-retry>Buscar video</button>`
      : "";

  const candidates = video
    ? `<button type="button" class="secondary" data-video-candidates-toggle>Usar otro video</button>
       <div class="video-candidates" data-video-candidates hidden>
        <div class="video-candidates-body"><p class="editor-hint">Cargando candidatos…</p></div>
      </div>`
    : "";

  return `<section class="youtube-section${video ? " has-video" : ""}" data-youtube-song="${escapeHtml(song.id)}" data-video-id="${video ? escapeHtml(video.id) : ""}" data-video-url="${video ? escapeHtml(video.url) : ""}" data-video-status="${song.videoStatus}" data-timestamps-status="${song.timestampsStatus}">
        <div class="youtube-panel" aria-label="Opciones de acompañamiento">
          <div class="option-group">
            <h3 class="option-heading">Youtube</h3>
            <div class="youtube-header">
              <p>Vincula un video para escuchar la canción mientras ves los acordes.</p>
              <a class="youtube-search-link" href="https://www.youtube.com/results?search_query=${searchQuery}" target="_blank" rel="noopener noreferrer">Buscar en YouTube</a>
            </div>
            ${videoSummary}
            ${videoError}
            ${retryVideo ? `<div class="youtube-actions">${retryVideo}</div>` : ""}
            <form class="youtube-link-form">
              <label for="youtube-url">Pega el enlace del video</label>
              <div class="youtube-link-row">
                <input id="youtube-url" name="url" type="url" inputmode="url" placeholder="https://www.youtube.com/watch?v=…" autocomplete="url" required>
                <button type="submit">Vincular video</button>
              </div>
              <p class="youtube-status" data-youtube-status role="status" aria-live="polite"></p>
            </form>
            ${candidates}
          </div>
          <div class="option-group">
            <h3 class="option-heading">Marcas de tiempo</h3>
            <div class="youtube-actions">
              <button type="button" data-timestamps-auto${busyTimestamps || !video ? " disabled" : ""}>Generar marcas</button>
              <button type="button" class="secondary" data-timestamps-retry${!video ? " disabled" : ""}>Reintentar marcas</button>
            </div>
            ${statusMessage}
            <button type="button" class="chord-mark-toggle" data-chord-mark-toggle aria-pressed="false" disabled>Activar marcas de acordes</button>
            <p class="youtube-help">Con las marcas activadas, pulsa cada acorde mientras suena para asignarle el tiempo actual. Mantén pulsado un acorde para borrar su marca.</p>
          </div>
        </div>
      </section>`;
}

export function renderSong(song: Song, offset: number, audio: SongAudio | null = null): string {
  const id = escapeHtml(song.id);
  const sourceKey = escapeHtml(song.sourceKey);
  const offsetValue = String(offset);
  const audioStatus = audio?.status ?? "none";
  const audioReady = audioStatus === "ready";
  const pitchLabel = offset === 0 ? "0" : `${offset > 0 ? "+" : ""}${offset}`;
  const audioSourceLabel = audioStatus === "fetching"
    ? "Descargando audio…"
    : audioStatus === "failed"
      ? "Audio transpuesto no disponible."
      : "";
  const controls = [
    { label: "+1 tono", delta: 2 },
    { label: "+½ tono", delta: 1 },
    { label: "-½ tono", delta: -1 },
    { label: "-1 tono", delta: -2 },
  ]
    .map(
      ({ label, delta }) =>
         `<button type="button" hx-post="/songs/${id}/transpose" hx-vals='{"offset":${offsetValue},"delta":${delta}}' hx-target="#song-container" hx-swap="innerHTML" hx-indicator="this" hx-disabled-elt="this">${label}</button>`,
    )
    .join("\n");
  let chordIndex = 0;
  const lyrics = song.lines
    .map((line, lineIndex) => {
      const rendered = renderSongLine(line, offset, lineIndex, chordIndex);
      chordIndex += line.chords.length;
      return rendered;
    })
    .join("");
  const searchQuery = encodeURIComponent(`${song.artist} ${song.title}`);
  const videoId = song.video ? escapeHtml(song.video.id) : "";
  const videoUrl = song.video ? escapeHtml(song.video.url) : "";
  const hasVideo = song.video ? "true" : "false";
  const busy = isBusySong(song);
  const initialView = busy ? "loader" : "player";

  const main = busy
    ? `<div class="song-view song-view-loader" data-view-panel="loader" role="status" aria-live="polite">
       <div class="song-loader"><span class="song-loader-spinner" aria-hidden="true"></span><span>Preparando la canción…</span></div>
       <section class="youtube-section" hidden data-youtube-song="${id}" data-video-id="${videoId}" data-video-url="${videoUrl}" data-video-status="${song.videoStatus}" data-timestamps-status="${song.timestampsStatus}"></section>
     </div>`
    : `<div class="song-view song-view-player" data-view-panel="player">
       <div class="youtube-media-pair" data-youtube-media hidden>
         <div class="youtube-media-box accompaniment-chord-box" id="accompaniment-chord-viewer" aria-live="polite">
           <p class="accompaniment-chord-placeholder">El acorde actual aparecerá aquí cuando empiece la reproducción.</p>
         </div>
         <div class="youtube-media-box youtube-player-frame" data-youtube-player aria-label="Video de acompañamiento"></div>
       </div>
       ${renderTimestampsWarning(song)}
       <div class="youtube-playback-controls" data-youtube-playback-controls hidden>
         <div class="youtube-progress" aria-label="Progreso de la canción">
           <span class="youtube-progress-time" data-youtube-progress-current>0:00</span>
           <div class="youtube-progress-track">
             <input type="range" class="youtube-progress-slider" data-youtube-progress min="0" max="0" step="0.1" value="0" aria-label="Posición de la canción" disabled>
           </div>
           <span class="youtube-progress-time" data-youtube-progress-duration>0:00</span>
         </div>
          <div class="youtube-controls-row">
            <button type="button" class="youtube-play-button" data-youtube-play disabled aria-label="Reproducir">▶ <span>Reproducir</span></button>
            <div class="pitch-controls" role="group" aria-label="Transponer canción">
              <button type="button" class="pitch-button" hx-post="/songs/${id}/transpose" hx-vals='{"offset":${offsetValue},"delta":-1}' hx-target="#song-container" hx-swap="innerHTML" hx-indicator="this" hx-disabled-elt="this" aria-label="Bajar medio tono" title="Bajar medio tono"${offset <= -12 ? " disabled" : ""}>−½</button>
              <output class="pitch-value" data-pitch-value title="${transpositionLabel(offset)}" aria-label="Transposición actual: ${transpositionLabel(offset)}">${pitchLabel}</output>
              <button type="button" class="pitch-button" hx-post="/songs/${id}/transpose" hx-vals='{"offset":${offsetValue},"delta":1}' hx-target="#song-container" hx-swap="innerHTML" hx-indicator="this" hx-disabled-elt="this" aria-label="Subir medio tono" title="Subir medio tono"${offset >= 12 ? " disabled" : ""}>+½</button>
            </div>
            <div class="audio-source-toggle" role="group" aria-label="Fuente de audio">
              <button type="button" class="audio-source-button${audioReady ? "" : " is-active"}" data-audio-source="youtube" aria-pressed="${audioReady ? "false" : "true"}" title="Escuchar el audio original">Original</button>
              <button type="button" class="audio-source-button${audioReady ? " is-active" : ""}" data-audio-source="transposed" aria-pressed="${audioReady ? "true" : "false"}"${audioReady ? "" : " disabled"} title="Escuchar el audio transpuesto">Transpuesto</button>
            </div>
            <button type="button" class="secondary youtube-options-button" data-song-view="options">Opciones</button>
          </div>
          <p class="audio-source-status" data-audio-status-text role="status" aria-live="polite">${audioSourceLabel}</p>
        </div>
       <div class="song song-lyrics" aria-label="Letra y acordes">${lyrics}</div>
     </div>
     <div class="song-view song-view-options" data-view-panel="options">
       <section class="option-group" aria-label="Tonalidad">
         <h3 class="option-heading">Tonalidad</h3>
         <div class="song-controls" aria-label="Transponer canción">
           ${controls}
            <button type="button" class="secondary" hx-post="/songs/${id}/transpose" hx-vals='{"offset":${offsetValue},"reset":1}' hx-target="#song-container" hx-swap="innerHTML" hx-indicator="this" hx-disabled-elt="this">Original</button>
           <output class="transpose-status">${transpositionLabel(offset)}</output>
         </div>
       </section>
       ${renderVideoPanel(song, searchQuery)}
       <section class="option-group" aria-label="Editar acordes">
         <h3 class="option-heading">Editar acordes</h3>
         <p class="option-hint">Corrige la letra, los acordes y los datos de la canción.</p>
         <button type="button" class="secondary" data-song-edit aria-label="Editar letra y acordes" hx-get="/songs/${id}/edit" hx-target="#song-editor-body" hx-swap="innerHTML">Editar acordes</button>
       </section>
     </div>
     <div class="song-view song-view-editor" data-view-panel="editor">
       <div class="editor-view-header"><p class="eyebrow">Editar acordes</p><h3>Letra y acordes</h3></div>
       <div id="song-editor-body" data-editor-body>
         <p class="editor-loading">Carga el editor para modificar esta canción.</p>
       </div>
     </div>`;

  return `<section class="song-card" aria-label="Canción transpuesta" data-view="${initialView}" data-song-id="${id}" data-source-key="${sourceKey}" data-offset="${offsetValue}" data-video-id="${videoId}" data-video-url="${videoUrl}" data-video-status="${song.videoStatus}" data-timestamps-status="${song.timestampsStatus}" data-audio-status="${audioStatus}" data-has-video="${hasVideo}">
  <header class="song-header">
    <div class="song-title-block"><p class="eyebrow">${escapeHtml(song.artist)}</p><h2 id="selected-song-title" tabindex="-1">${escapeHtml(song.title)}</h2></div>
    <div class="song-header-actions">
      <button type="button" class="song-back-button secondary" data-wizard-search aria-label="Atrás">←</button>
      <button class="favorite-toggle song-favorite-toggle" type="button" data-favorite-toggle data-song-id="${sourceKey}" data-song-title="${escapeHtml(song.title)}" data-song-artist="${escapeHtml(song.artist)}" aria-label="${song.liked ? "Quitar" : "Añadir"} ${escapeHtml(song.title)} a canciones que me gustan" title="${song.liked ? "Quitar de canciones que me gustan" : "Añadir a canciones que me gustan"}" aria-pressed="${song.liked ? "true" : "false"}"><svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z"/></svg></button>
    </div>
  </header>
  <div class="song-main">
    ${main}
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
