import type { Database } from "bun:sqlite";
import { getDb } from "../db";
import { bodyTooLarge, clientIp, html, isSameOrigin, json } from "../core/http";
import { rateLimit } from "../core/ratelimit";
import { renderError } from "../render/song";
import { renderFavorites } from "../render/search";
import {
  findSongIdBySourceKey,
  isSongLiked,
  listLikedSongs,
  listPreferences,
  setSongLike,
} from "../songs/songs.db";

const SOURCE_KEY = /^\/[A-Za-z0-9_\-]+\/[A-Za-z0-9_.\-]+\.shtml$/i;

export async function favoritesRoute(
  request: Request,
  url: URL,
  db: Database = getDb(),
): Promise<Response> {
  const { pathname } = url;
  const method = request.method;

  if (method === "GET" && pathname === "/favorites") {
    const songs = listLikedSongs(db).map((song) => ({
      title: song.title,
      artist: song.artist,
      artistSlug: "",
      url: song.url,
    }));
    return html(renderFavorites(songs));
  }

  if (method === "GET" && pathname === "/favorites/state") {
    return json(listPreferences(db));
  }

  if (method === "POST" && pathname === "/favorites/toggle") {
    if (!isSameOrigin(request)) {
      return html(renderError("La solicitud no tiene un origen válido."), 403);
    }
    if (!rateLimit(`${clientIp(request)}:favorite`, 60, 60_000)) {
      return html(renderError("Demasiadas solicitudes. Espera un momento e inténtalo de nuevo."), 429);
    }
    if (bodyTooLarge(request)) {
      return html(renderError("La solicitud es demasiado grande."), 413);
    }
    const form = await request.formData().catch(() => null);
    const sourceKey = form?.get("sourceKey");
    if (typeof sourceKey !== "string" || !SOURCE_KEY.test(sourceKey)) {
      return json({ error: "La canción no es válida." }, 400);
    }
    const songId = findSongIdBySourceKey(db, sourceKey);
    if (!songId) {
      return json({ error: "La canción todavía no está cargada." }, 404);
    }
    const liked = !isSongLiked(db, songId);
    setSongLike(db, songId, liked);
    return json({ sourceKey, liked });
  }

  return html(renderError("Método no permitido."), 405, { Allow: "GET, POST" });
}
