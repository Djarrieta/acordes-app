import {
  fetchLacuerdaArtistSongs,
  searchLacuerdaArtists,
  searchLacuerdaSongs,
  type SearchMode,
} from "../parser/search";
import { LacuerdaFetchError, LacuerdaParseError } from "../parser/lacuerda";
import { renderError } from "../render/song";
import {
  renderArtistResults,
  renderArtistSongs,
  renderSearchPrompt,
  renderSongResults,
} from "../render/search";

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function errorResponse(error: unknown): Response {
  const known = error instanceof LacuerdaParseError || error instanceof LacuerdaFetchError;
  const message = known
    ? "No fue posible mostrar los resultados. Inténtalo de nuevo más tarde."
    : "No se pudo completar la búsqueda. Inténtalo de nuevo más tarde.";
  const status = error instanceof LacuerdaParseError ? 400 : 502;
  return html(renderError(message), status);
}

export async function searchRoute(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const mode: SearchMode = url.searchParams.get("mode") === "artists" ? "artists" : "songs";

  if (!query) return html(renderSearchPrompt());

  try {
    if (mode === "artists") {
      const { artists, exactSlug } = await searchLacuerdaArtists(query);
      if (exactSlug) {
        return html(renderArtistSongs(await fetchLacuerdaArtistSongs(exactSlug)));
      }
      return html(renderArtistResults(query, artists));
    }
    return html(renderSongResults(query, await searchLacuerdaSongs(query)));
  } catch (error) {
    console.error("Error al buscar en LaCuerda:", error);
    return errorResponse(error);
  }
}

export async function artistRoute(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const slug = (url.searchParams.get("slug") ?? "").trim();

  if (!slug) return html(renderError("Falta el artista que quieres consultar."), 400);

  try {
    return html(renderArtistSongs(await fetchLacuerdaArtistSongs(slug)));
  } catch (error) {
    console.error("Error al cargar un artista de LaCuerda:", error);
    return errorResponse(error);
  }
}
