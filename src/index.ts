import { homePage } from "./routes/home";
import { chordDiagramRoute } from "./routes/chord-diagram";
import { loadRoute } from "./routes/load";
import { artistRoute, searchRoute } from "./routes/search";
import { resetRoute, transposeRoute } from "./routes/transpose";
import { youtubeVideoIdRoute } from "./routes/youtube";

const port = Number(Bun.env.PORT ?? 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT debe ser un número entre 1 y 65535.");
}

Bun.serve({
  port,
  hostname: Bun.env.HOST ?? "0.0.0.0",
  async fetch(request) {
    const { pathname } = new URL(request.url);

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
    if (pathname === "/chord-diagram") {
      if (method === "GET") return chordDiagramRoute(request);
      return new Response("Método no permitido.", {
        status: 405,
        headers: { Allow: "GET" },
      });
    }
    if (request.method === "POST" && pathname === "/load") {
      return loadRoute(request);
    }
    if (request.method === "POST" && pathname === "/transpose") {
      return transposeRoute(request);
    }
    if (request.method === "POST" && pathname === "/reset") {
      return resetRoute(request);
    }
    if (request.method === "POST" && pathname === "/youtube/video-id") {
      return youtubeVideoIdRoute(request);
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
    if (pathname === "/search" || pathname === "/artist") {
      return new Response("Método no permitido.", {
        status: 405,
        headers: { Allow: "GET" },
      });
    }
    if (
      pathname === "/load" ||
      pathname === "/transpose" ||
      pathname === "/reset"
    ) {
      return new Response("Método no permitido.", {
        status: 405,
        headers: { Allow: "POST" },
      });
    }
    if (pathname === "/youtube/video-id") {
      return new Response("Método no permitido.", {
        status: 405,
        headers: { Allow: "POST" },
      });
    }
    return new Response("No encontrado.", { status: 404 });
  },
});

console.log(`Acordes app disponible en http://0.0.0.0:${port}`);
