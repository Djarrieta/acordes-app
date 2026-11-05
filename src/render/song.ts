import type { ChordToken, SongLine } from "../parser/lacuerda";
import type { SongState } from "../state";
import { transposeChord } from "../transpose/chords";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character]!;
  });
}

function renderChordLine(chords: ChordToken[], offset: number): string {
  let output = "";
  let position = 0;
  for (const token of chords) {
    const chord = transposeChord(token.chord, offset);
    const target = Math.max(token.column, position);
    output += " ".repeat(target - position);
    output += chord;
    position = target + chord.length;
  }
  return output;
}

function renderSongLine(line: SongLine, offset: number): string {
  if (line.chords.length === 0) {
    return `${escapeHtml(line.lyric)}\n`;
  }
  return `<span class="chords">${escapeHtml(renderChordLine(line.chords, offset))}</span>\n${escapeHtml(line.lyric)}\n`;
}

function transpositionLabel(offset: number): string {
  if (offset === 0) return "Tonalidad original";
  const amount = Math.abs(offset);
  return `${offset > 0 ? "+" : "-"}${amount} ${amount === 1 ? "semitono" : "semitonos"}`;
}

export function renderSong(state: SongState): string {
  const id = escapeHtml(state.id);
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
  const lyrics = state.parsed.lines
    .map((line) => renderSongLine(line, state.offset))
    .join("");

  return `<section class="song-card" aria-label="Canción transpuesta">
  <header class="song-header">
    <div><p class="eyebrow">${escapeHtml(state.parsed.artist)}</p><h2>${escapeHtml(state.parsed.title)}</h2></div>
    <a class="source-link" href="${escapeHtml(state.url)}" target="_blank" rel="noreferrer">Ver fuente</a>
  </header>
  <div class="song-controls" aria-label="Transponer canción">
    ${controls}
    <button type="button" class="secondary" hx-post="/reset" hx-vals='{"id":"${id}"}' hx-target="#song-container" hx-swap="innerHTML">Original</button>
    <output class="transpose-status">${transpositionLabel(state.offset)}</output>
  </div>
  <pre class="song">${lyrics}</pre>
</section>`;
}

export function renderError(message: string): string {
  return `<p class="error" role="alert">${escapeHtml(message)}</p>`;
}
