import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config";
import { getDb } from "../db";
import { json } from "../core/http";
import { getAudio } from "./audio.db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleAudioRoutes(
  request: Request,
  url: URL,
  db: Database = getDb(),
): Promise<Response | null> {
  const match = /^\/songs\/([0-9a-f-]+)(\/audio.*)$/i.exec(url.pathname);
  if (!match) return null;
  const songId = match[1]!;
  const suffix = match[2]!;
  if (!UUID.test(songId)) return json({ error: "La canción ya no está disponible." }, 404);
  if (request.method !== "GET" || suffix !== "/audio") {
    return json({ error: "Método no permitido." }, 405);
  }

  const audio = getAudio(db, songId);
  if (!audio || audio.status !== "ready" || !audio.path || !audio.mime) {
    return json({ error: "Audio no disponible." }, 404);
  }
  const base = resolve(config.audioDir);
  const filePath = resolve(audio.path);
  if (!filePath.startsWith(`${base}/`) || !existsSync(filePath)) {
    return json({ error: "Audio no disponible." }, 404);
  }
  const file = Bun.file(filePath);
  const size = file.size;
  const common = {
    "Content-Type": audio.mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=86400",
  };
  const range = parseRange(request.headers.get("range"), size);
  if (range === "invalid") {
    return new Response("Rango no válido.", {
      status: 416,
      headers: { ...common, "Content-Range": `bytes */${size}` },
    });
  }
  if (range) {
    const { start, end } = range;
    return new Response(file.slice(start, end + 1), {
      status: 206,
      headers: {
        ...common,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
      },
    });
  }
  return new Response(file, {
    headers: { ...common, "Content-Length": String(size) },
  });
}

function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return "invalid";
  const startRaw = match[1]!;
  const endRaw = match[2]!;
  if (startRaw === "" && endRaw === "") return "invalid";
  if (startRaw === "") {
    const suffix = Number(endRaw);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "invalid";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(startRaw);
  const end = endRaw === "" ? size - 1 : Number(endRaw);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end) {
    return "invalid";
  }
  if (start >= size) return "invalid";
  return { start, end: Math.min(end, size - 1) };
}
