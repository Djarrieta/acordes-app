import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase, setDb } from "../src/db";
import { resetRateLimits } from "../src/core/ratelimit";
import { favoritesRoute } from "../src/routes/favorites";
import { createSong, getSong } from "../src/songs/songs.db";

let db: Database;
let sourceKey = "/artista/cancion.shtml";

function request(path: string, method = "GET", body?: Record<string, string>) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: body ? { "content-type": "application/x-www-form-urlencoded" } : undefined,
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
}

async function route(req: Request) {
  return favoritesRoute(req, new URL(req.url), db);
}

beforeEach(() => {
  db = openDatabase(":memory:");
  setDb(db);
  resetRateLimits();
  createSong(db, {
    sourceKey,
    sourceUrl: "https://acordes.lacuerda.net/artista/cancion.shtml",
    title: "Canción",
    artist: "Artista",
    lines: [{ text: "[C]primera linea" }],
  });
});

afterEach(() => {
  setDb(null);
  db.close();
});

describe("favorites routes", () => {
  test("toggles the like in the database and reports it back", async () => {
    const liked = await route(request("/favorites/toggle", "POST", { sourceKey }));
    const payload = (await liked.json()) as { sourceKey: string; liked: boolean };

    expect(liked.status).toBe(200);
    expect(payload).toEqual({ sourceKey, liked: true });

    const unliked = await route(request("/favorites/toggle", "POST", { sourceKey }));
    expect(((await unliked.json()) as { liked: boolean }).liked).toBe(false);
  });

  test("rejects an invalid source key and an unknown song", async () => {
    const invalid = await route(request("/favorites/toggle", "POST", { sourceKey: "nope" }));
    expect(invalid.status).toBe(400);

    const missing = await route(
      request("/favorites/toggle", "POST", { sourceKey: "/otro/artista.shtml" }),
    );
    expect(missing.status).toBe(404);
  });

  test("lists liked songs and shared preferences without localStorage", async () => {
    await route(request("/favorites/toggle", "POST", { sourceKey }));

    const favorites = await route(request("/favorites"));
    const html = await favorites.text();
    expect(favorites.status).toBe(200);
    expect(html).toContain("Canción");
    expect(html).toContain('hx-post="/load"');

    const state = await route(request("/favorites/state"));
    const payload = (await state.json()) as { liked: string[]; offsets: Record<string, number> };
    expect(payload.liked).toEqual([sourceKey]);
    expect(payload.offsets).toEqual({});
  });

  test("renders an empty message when there are no favorites yet", async () => {
    const favorites = await route(request("/favorites"));
    const html = await favorites.text();
    expect(html).toContain("Todavía no tienes canciones marcadas como favoritas");
  });
});
