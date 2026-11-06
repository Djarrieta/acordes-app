import { LacuerdaFetchError, LacuerdaParseError, stripMarkup } from "./lacuerda";

export type SearchMode = "songs" | "artists";

export type SongMatch = {
  title: string;
  artist: string;
  artistSlug: string;
  url: string;
};

export type ArtistMatch = {
  name: string;
  slug: string;
  songCount: number;
};

export type ArtistSongs = {
  name: string;
  slug: string;
  songs: SongMatch[];
};

const SEARCH_BASE = "https://acordes.lacuerda.net/busca.php";
const SITE_ORIGIN = "https://acordes.lacuerda.net";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const SLUG = /^[a-z0-9_\-]+$/i;

const ROW =
  /<a\b[^>]*href=["']\/([^/"']+)\/["'][^>]*>([\s\S]*?)<\/a>\s*<\/td>\s*<td>\s*<ul\b[^>]*class=["']?b_main\b[^>]*>([\s\S]*?)<\/ul>/gi;
const ROW_ITEM =
  /<li\b[^>]*id=["']?r\d+["']?[^>]*><a\b[^>]*href=["']javascript:["'][^>]*>([\s\S]*?)<\/a>/gi;
const ARTIST_ITEM =
  /<li\b[^>]*><a\b[^>]*class=["']?sb["']?[^>]*href=["']\/([^/"']+)\/["'][^>]*>([\s\S]*?)<\/a>\s*<span>\s*(\d+)/gi;
const ARTIST_SONG =
  /<li\b[^>]*id=["']?r\d+["']?[^>]*><a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + cost,
      );
    }
    previous = current;
  }
  return previous[b.length]!;
}

function quotedArray(html: string, name: string): string[] {
  const match = new RegExp(`var\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*;`, "i").exec(html);
  if (!match) return [];
  return [...match[1]!.matchAll(/'([^']*)'/g)].map((value) => value[1]!);
}

function pageTitle(html: string): string {
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (h1) return stripMarkup(h1[1]!).trim();
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return title ? stripMarkup(title[1]!).trim() : "";
}

function songUrl(artistSlug: string, fileSlug: string): string | null {
  if (!SLUG.test(artistSlug) || !SLUG.test(fileSlug)) return null;
  return `${SITE_ORIGIN}/${artistSlug}/${fileSlug}.shtml`;
}

export function parseSongSearchHtml(html: string): SongMatch[] {
  const artists = quotedArray(html, "hds");
  const files = quotedArray(html, "fns");

  const rows: { artist: string; artistSlug: string; title: string }[] = [];
  for (const row of html.matchAll(ROW)) {
    const artistSlug = row[1]!;
    const artist = stripMarkup(row[2]!).trim();
    for (const item of row[3]!.matchAll(ROW_ITEM)) {
      const title = stripMarkup(item[1]!).replace(/\s+/g, " ").trim();
      if (title) rows.push({ artist, artistSlug, title });
    }
  }

  if (rows.length === 0) return [];
  if (files.length === 0) {
    throw new LacuerdaParseError(
      "LaCuerda respondió sin los datos necesarios para enlazar las canciones.",
    );
  }

  const candidates: { row: number; file: number; score: number }[] = [];
  rows.forEach((row, rowIndex) => {
    files.forEach((file, fileIndex) => {
      const distance = levenshtein(normalize(row.title), normalize(file));
      const artistBonus = artists[fileIndex] === row.artistSlug ? 2 : 0;
      candidates.push({ row: rowIndex, file: fileIndex, score: distance - artistBonus });
    });
  });
  candidates.sort((a, b) => a.score - b.score);

  const fileByRow = new Map<number, string>();
  const usedFiles = new Set<number>();
  for (const candidate of candidates) {
    if (fileByRow.has(candidate.row) || usedFiles.has(candidate.file)) continue;
    fileByRow.set(candidate.row, files[candidate.file]!);
    usedFiles.add(candidate.file);
  }

  const songs: SongMatch[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    const file = fileByRow.get(rowIndex);
    if (!file) continue;
    const url = songUrl(row.artistSlug, file);
    if (!url) continue;
    songs.push({ title: row.title, artist: row.artist, artistSlug: row.artistSlug, url });
  }
  return songs;
}

export function parseArtistSearchHtml(html: string): ArtistMatch[] {
  return [...html.matchAll(ARTIST_ITEM)].flatMap((item) => {
    const slug = item[1]!;
    if (!SLUG.test(slug)) return [];
    return [
      {
        name: stripMarkup(item[2]!).replace(/\s+/g, " ").trim(),
        slug,
        songCount: Number(item[3]),
      },
    ];
  });
}

export function parseArtistSongsHtml(html: string, slug: string): ArtistSongs {
  const songs: SongMatch[] = [];
  for (const item of html.matchAll(ARTIST_SONG)) {
    const file = item[1]!.replace(/\.shtml$/i, "");
    const title = stripMarkup(item[2]!.replace(/<em\b[^>]*>[\s\S]*?<\/em>/gi, ""))
      .replace(/\s+/g, " ")
      .trim();
    const url = songUrl(slug, file);
    if (!title || !url) continue;
    songs.push({ title, artist: pageTitle(html), artistSlug: slug, url });
  }
  return { name: pageTitle(html), slug, songs };
}

async function fetchPage(url: URL, redirect: RequestRedirect): Promise<Response> {
  return fetch(url, { headers: { "User-Agent": USER_AGENT }, redirect });
}

function searchUrl(query: string, mode: SearchMode): URL {
  const url = new URL(SEARCH_BASE);
  url.searchParams.set("action", "comp");
  url.searchParams.set("req_data", "");
  url.searchParams.set("lang", "ES");
  url.searchParams.set("exp", query);
  url.searchParams.set("canc", mode === "artists" ? "2" : "1");
  url.searchParams.set("ord", "0");
  url.searchParams.set("ini", "0");
  return url;
}

async function responseHtml(response: Response): Promise<string> {
  if (response.status === 500) {
    throw new LacuerdaFetchError(
      "LaCuerda no pudo completar la búsqueda. Puede que no tenga resultados para esa canción.",
    );
  }
  if (!response.ok) {
    throw new LacuerdaFetchError(
      `LaCuerda respondió con el estado HTTP ${response.status} al buscar.`,
    );
  }
  return response.text();
}

export async function searchLacuerdaSongs(query: string): Promise<SongMatch[]> {
  const response = await fetchPage(searchUrl(query, "songs"), "follow");
  return parseSongSearchHtml(await responseHtml(response));
}

export async function searchLacuerdaArtists(
  query: string,
): Promise<{ artists: ArtistMatch[]; exactSlug: string | null }> {
  const response = await fetchPage(searchUrl(query, "artists"), "manual");

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    const match = location ? /^\/([^/]+)\/?$/.exec(new URL(location, SEARCH_BASE).pathname) : null;
    const slug = match?.[1];
    if (slug && SLUG.test(slug)) return { artists: [], exactSlug: slug };
    throw new LacuerdaFetchError("LaCuerda redirigió a un destino no reconocido.");
  }

  return { artists: parseArtistSearchHtml(await responseHtml(response)), exactSlug: null };
}

export async function fetchLacuerdaArtistSongs(slug: string): Promise<ArtistSongs> {
  if (!SLUG.test(slug)) {
    throw new LacuerdaParseError("El identificador del artista no es válido.");
  }
  const response = await fetchPage(new URL(`/${slug}/`, SITE_ORIGIN), "follow");
  return parseArtistSongsHtml(await responseHtml(response), slug);
}
