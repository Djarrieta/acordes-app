import type { ArtistMatch, ArtistSongs, SongMatch } from "../parser/search";
import { escapeHtml } from "./html";

function loadButton(song: SongMatch): string {
  const url = escapeHtml(song.url);
  return `<button class="result-action" type="button" aria-label="Reproducir ${escapeHtml(song.title)}" hx-post="/load" hx-vals='{"url":"${url}"}' hx-target="#song-container" hx-swap="innerHTML">Reproducir</button>`;
}

function songListItem(song: SongMatch): string {
  const songId = escapeHtml(new URL(song.url).pathname);
  return `<li class="result-item" data-song-id="${songId}" data-song-title="${escapeHtml(song.title)}" data-song-artist="${escapeHtml(song.artist)}">
      <div class="result-copy">
        <strong>${escapeHtml(song.title)}</strong>
        <span class="result-detail">${escapeHtml(song.artist)}</span>
      </div>
      ${loadButton(song)}
    </li>`;
}

function artistListItem(artist: ArtistMatch): string {
  const slug = escapeHtml(artist.slug);
  return `<li class="result-item">
      <div class="result-copy">
        <strong>${escapeHtml(artist.name)}</strong>
        <span class="result-detail">${artist.songCount} ${artist.songCount === 1 ? "canción" : "canciones"}</span>
      </div>
      <button class="result-action secondary" type="button" aria-label="Ver canciones de ${escapeHtml(artist.name)}" hx-get="/artist?slug=${encodeURIComponent(slug)}" hx-target="#search-results" hx-swap="innerHTML">Ver canciones</button>
    </li>`;
}

export function renderSongResults(query: string, songs: SongMatch[]): string {
  if (songs.length === 0) {
    return `<p class="empty">No se encontraron canciones para “${escapeHtml(query)}”. Prueba con el nombre del artista o con otra grafía.</p>`;
  }
  return `<section class="search-results" aria-label="Canciones encontradas">
    <p class="search-summary"><strong>${songs.length} ${songs.length === 1 ? "canción encontrada" : "canciones encontradas"}</strong><span> para “${escapeHtml(query)}”</span></p>
    <ul class="result-list">${songs.map(songListItem).join("")}</ul>
  </section>`;
}

export function renderArtistResults(query: string, artists: ArtistMatch[]): string {
  if (artists.length === 0) {
    return `<p class="empty">No se encontraron artistas para “${escapeHtml(query)}”. Prueba con el nombre de la canción.</p>`;
  }
  return `<section class="search-results" aria-label="Artistas encontrados">
    <p class="search-summary"><strong>${artists.length} ${artists.length === 1 ? "artista encontrado" : "artistas encontrados"}</strong><span> para “${escapeHtml(query)}”</span></p>
    <ul class="result-list">${artists.map(artistListItem).join("")}</ul>
  </section>`;
}

export function renderArtistSongs(result: ArtistSongs): string {
  if (result.songs.length === 0) {
    return `<p class="empty">No se encontraron canciones para ${escapeHtml(result.name || result.slug)}.</p>`;
  }
  return `<section class="search-results" aria-label="Canciones del artista">
    <p class="search-summary"><strong>${escapeHtml(result.name)}</strong><span>${result.songs.length} canciones</span></p>
    <ul class="result-list">${result.songs.map(songListItem).join("")}</ul>
  </section>`;
}

export function renderSearchPrompt(): string {
  return `<p class="empty">Escribe el nombre de una canción o de un artista para buscar.</p>`;
}
