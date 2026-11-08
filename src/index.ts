import { config } from "./config";
import { getDb } from "./db";
import { methodNotAllowed, notFound } from "./core/http";
import { homePage } from "./routes/home";
import { chordDiagramRoute } from "./routes/chord-diagram";
import { favoritesRoute } from "./routes/favorites";
import { loadRoute } from "./routes/load";
import { artistRoute, searchRoute } from "./routes/search";
import { youtubeVideoIdRoute } from "./routes/youtube";
import { resumePendingJobs } from "./songs/enrichment/enrichment.service";
import { handleSongsRoutes } from "./songs/songs.routes";

getDb();
resumePendingJobs();

const port = config.port;
const hostname = config.host;

Bun.serve({
  port,
  hostname,
  async fetch(request) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method === "HEAD" ? "GET" : request.method;

    if (method === "GET" && pathname === "/") {
      return homePage();
    }
    if (method === "GET" && pathname === "/search") {
      return searchRoute(request);
    }
    if (method === "GET" && pathname === "/artist") {
      return artistRoute(request);
    }
    if (pathname === "/favorites" || pathname === "/favorites/state" || pathname === "/favorites/toggle") {
      return favoritesRoute(request, url);
    }
    if (pathname === "/chord-diagram") {
      if (method === "GET") return chordDiagramRoute(request);
      return methodNotAllowed("GET");
    }
    if (request.method === "POST" && pathname === "/load") {
      return loadRoute(request);
    }
    if (request.method === "POST" && pathname === "/youtube/video-id") {
      return youtubeVideoIdRoute(request);
    }

    if (pathname.startsWith("/songs/")) {
      const response = await handleSongsRoutes(request, url);
      if (response) return response;
    }

    if (method === "GET" && pathname === "/public/styles.css") {
      return new Response(Bun.file(new URL("../public/styles.css", import.meta.url)), {
        headers: { "Content-Type": "text/css; charset=utf-8" },
      });
    }
    if (method === "GET" && pathname === "/public/youtube.js") {
      return new Response(Bun.file(new URL("../public/youtube.js", import.meta.url)), {
        headers: { "Content-Type": "text/javascript; charset=utf-8" },
      });
    }
    if (method === "GET" && pathname === "/public/editor.js") {
      return new Response(Bun.file(new URL("../public/editor.js", import.meta.url)), {
        headers: { "Content-Type": "text/javascript; charset=utf-8" },
      });
    }

    if (pathname === "/search" || pathname === "/artist") {
      return methodNotAllowed("GET");
    }
    if (pathname === "/load" || pathname === "/youtube/video-id") {
      return methodNotAllowed("POST");
    }
    return notFound();
  },
});

console.log(`Acordes app disponible en http://${hostname}:${port}`);
