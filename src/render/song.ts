import { transposeChord } from "../transpose/chords";
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

const VIDEO_STATUS_LABELS: Record<Song["videoStatus"], string> = {
  none: "Sin video",
  searching: "Cargando…",
  ready: "Video listo",
  failed: "Sin video",
  skipped: "Sin video",
};

function isBusySong(song: Song): boolean {
  return song.videoStatus === "searching" || ["pending", "transcribing", "aligning"].includes(song.timestampsStatus);
}

function renderLoader(): string {
  return `<div class="song-loader" role="status" aria-live="polite"><span class="song-loader-spinner" aria-hidden="true"></span><span>Cargando…</span></div>`;
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
    ? `<details class="video-candidates" data-video-candidates hx-get="/songs/${escapeHtml(song.id)}/videos" hx-trigger="toggle once" hx-target="find .video-candidates-body" hx-swap="innerHTML">
        <summary>Ver otros candidatos</summary>
        <div class="video-candidates-body"><p class="editor-hint">Cargando candidatos…</p></div>
      </details>
      <button type="button" class="youtube-unlink secondary" data-video-unlink>Quitar video</button>`
    : "";

  return `<section class="youtube-section${video ? " has-video" : ""}" data-youtube-song="${escapeHtml(song.id)}" data-video-id="${video ? escapeHtml(video.id) : ""}" data-video-url="${video ? escapeHtml(video.url) : ""}" data-video-status="${song.videoStatus}" data-timestamps-status="${song.timestampsStatus}">
        <div class="youtube-section-header">
          <span><span class="eyebrow">Acompañamiento</span><strong>YouTube</strong></span>
          <span class="youtube-summary-state" data-youtube-summary-state>${busy ? "Cargando…" : escapeHtml(VIDEO_STATUS_LABELS[song.videoStatus])}</span>
        </div>
        <div class="youtube-panel" aria-label="Opciones de acompañamiento">
          <div class="youtube-header">
            <p>Vincula un video para escuchar la canción mientras ves los acordes.</p>
            <a class="youtube-search-link" href="https://www.youtube.com/results?search_query=${searchQuery}" target="_blank" rel="noopener noreferrer">Buscar en YouTube</a>
          </div>
          ${videoSummary}
          <div class="youtube-actions">
            <button type="button" data-timestamps-auto${busyTimestamps || !video ? " disabled" : ""}>Generar marcas</button>
            <button type="button" class="secondary" data-timestamps-retry${!video ? " disabled" : ""}>Reintentar marcas</button>
            ${retryVideo}
          </div>
          ${statusMessage}
          <form class="youtube-link-form">
            <label for="youtube-url">Pega el enlace del video</label>
            <div class="youtube-link-row">
              <input id="youtube-url" name="url" type="url" inputmode="url" placeholder="https://www.youtube.com/watch?v=…" autocomplete="url" required>
              <button type="submit">Vincular video</button>
            </div>
            <p class="youtube-status" data-youtube-status role="status" aria-live="polite"></p>
          </form>
          ${candidates}
          <button type="button" class="chord-mark-toggle" data-chord-mark-toggle aria-pressed="false" disabled>Activar marcas de acordes</button>
          <p class="youtube-help">Con las marcas activadas, pulsa cada acorde mientras suena para asignarle el tiempo actual. Mantén pulsado un acorde para borrar su marca.</p>
        </div>
      </section>`;
}

export function renderSong(song: Song, offset: number): string {
  const id = escapeHtml(song.id);
  const sourceKey = escapeHtml(song.sourceKey);
  const offsetValue = String(offset);
  const controls = [
    { label: "+1 tono", delta: 2 },
    { label: "+½ tono", delta: 1 },
    { label: "-½ tono", delta: -1 },
    { label: "-1 tono", delta: -2 },
  ]
    .map(
      ({ label, delta }) =>
        `<button type="button" hx-post="/songs/${id}/transpose" hx-vals='{"offset":${offsetValue},"delta":${delta}}' hx-target="#song-container" hx-swap="innerHTML">${label}</button>`,
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

  return `<section class="song-card" aria-label="Canción transpuesta" data-song-id="${id}" data-source-key="${sourceKey}" data-offset="${offsetValue}" data-video-id="${videoId}" data-video-url="${videoUrl}" data-video-status="${song.videoStatus}" data-timestamps-status="${song.timestampsStatus}" data-has-video="${hasVideo}">
  <header class="song-header">
    <div class="song-title-block"><p class="eyebrow">${escapeHtml(song.artist)}</p><h2 id="selected-song-title" tabindex="-1">${escapeHtml(song.title)}</h2></div>
    <div class="song-header-actions">
      <button type="button" class="song-back-button secondary" data-wizard-search aria-label="Volver a la búsqueda">← Volver</button>
      <button type="button" class="secondary" data-song-edit aria-label="Editar letra y acordes" hx-get="/songs/${id}/edit" hx-target="#song-editor-body" hx-swap="innerHTML">Editar</button>
      <button class="favorite-toggle song-favorite-toggle" type="button" data-favorite-toggle data-song-id="${sourceKey}" data-song-title="${escapeHtml(song.title)}" data-song-artist="${escapeHtml(song.artist)}" aria-label="${song.liked ? "Quitar" : "Añadir"} ${escapeHtml(song.title)} a canciones que me gustan" title="${song.liked ? "Quitar de canciones que me gustan" : "Añadir a canciones que me gustan"}" aria-pressed="${song.liked ? "true" : "false"}"><svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z"/></svg></button>
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
            <button type="button" class="secondary" hx-post="/songs/${id}/transpose" hx-vals='{"offset":${offsetValue},"reset":1}' hx-target="#song-container" hx-swap="innerHTML">Original</button>
            <output class="transpose-status">${transpositionLabel(offset)}</output>
          </div>
          ${renderVideoPanel(song, searchQuery)}
        </div>
      </details>
    </aside>
    <div class="song song-lyrics" aria-label="Letra y acordes">${lyrics}</div>
  </div>
  <dialog id="song-editor" class="song-editor" aria-labelledby="song-editor-title">
    <div class="song-editor-content">
      <header class="song-editor-header">
        <div><p class="eyebrow">Editor</p><h2 id="song-editor-title">Letra y acordes</h2></div>
        <form method="dialog"><button class="song-editor-close" aria-label="Cerrar editor">×</button></form>
      </header>
      <div id="song-editor-body" data-editor-body>
        <p class="editor-loading">Carga el editor para modificar esta canción.</p>
      </div>
    </div>
  </dialog>
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
