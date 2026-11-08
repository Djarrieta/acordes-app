export type ChordToken = { chord: string; column: number };
export type SongLine = { chords: ChordToken[]; lyric: string };
export type ParsedSong = { title: string; artist: string; lines: SongLine[] };

const SONG_BLOCK =
  /<div\b[^>]*\bid\s*=\s*(?:"t_body"|'t_body'|t_body)[^>]*>\s*<pre\b[^>]*>([\s\S]*?)<\/pre>\s*<\/div>/i;
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export class LacuerdaParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LacuerdaParseError";
  }
}

export class LacuerdaFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LacuerdaFetchError";
  }
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(
    /&(#(?:x[0-9a-f]+|[0-9]+)|[a-z]+);/gi,
    (entity, code: string) => {
      if (code[0] === "#") {
        const isHex = code[1]?.toLowerCase() === "x";
        const point = Number.parseInt(code.slice(isHex ? 2 : 1), isHex ? 16 : 10);
        return Number.isInteger(point) && point >= 0 && point <= 0x10ffff
          ? String.fromCodePoint(point)
          : entity;
      }
      return named[code.toLowerCase()] ?? entity;
    },
  );
}

export function stripMarkup(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, ""));
}

function parseChordLine(line: string): ChordToken[] {
  const tokens: ChordToken[] = [];
  const anchor = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
  let cursor = 0;
  let visibleColumn = 0;

  for (const match of line.matchAll(anchor)) {
    const start = match.index!;
    const before = stripMarkup(line.slice(cursor, start));
    visibleColumn += before.length;

    const chord = stripMarkup(match[1]!).trim();
    if (chord) {
      tokens.push({ chord, column: visibleColumn });
      visibleColumn += chord.length;
    }
    cursor = start + match[0].length;
  }

  return tokens;
}

function pageMetadata(html: string, url: URL): Pick<ParsedSong, "title" | "artist"> {
  const header =
    /<div\b[^>]*id\s*=\s*(?:"tH1"|'tH1'|tH1)[^>]*>[\s\S]*?<h1\b[^>]*>([\s\S]*?)<\/h1>[\s\S]*?<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(
      html,
    );
  if (header) {
    const title = stripMarkup(header[1]!).trim();
    const artist = stripMarkup(header[2]!).trim();
    if (title && artist) return { title, artist };
  }

  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const rawTitle = titleMatch ? stripMarkup(titleMatch[1]!).trim() : "";
  const normalizedTitle = rawTitle
    .replace(/^LaCuerda\s*[:|-]\s*/i, "")
    .replace(/\s*[|:-]\s*LaCuerda\s*$/i, "");
  const titleParts = normalizedTitle.split(/\s+-\s+/);
  const slugTitle = decodeURIComponent(url.pathname.split("/").at(-1) ?? "")
    .replace(/\.shtml$/i, "")
    .replace(/[_-]+/g, " ");
  const slugArtist = decodeURIComponent(url.pathname.split("/").at(-2) ?? "")
    .replace(/[_-]+/g, " ");

  return {
    title: titleParts[0] || slugTitle || "Canción",
    artist: titleParts.length > 1 ? titleParts.slice(1).join(" - ") : slugArtist || "Artista",
  };
}

export function parseLacuerdaHtml(html: string, sourceUrl: URL): ParsedSong {
  const block = SONG_BLOCK.exec(html)?.[1];
  if (!block) {
    throw new LacuerdaParseError("No se encontró el bloque de letra y acordes en la página.");
  }

  const lines: SongLine[] = [];
  let pendingChords: ChordToken[] | null = null;

  for (const rawLine of block.split(/\r?\n/)) {
    if (/^\s*$/.test(rawLine)) {
      if (pendingChords === null && lines.length > 0) {
        lines.push({ chords: [], lyric: "" });
      }
      pendingChords = null;
      continue;
    }
    if (/<em\b/i.test(rawLine) || /^\s*<div\b[^>]*>\s*<\/div>\s*$/i.test(rawLine)) {
      pendingChords = null;
      continue;
    }
    if (/^\s*<a\b[^>]*>[A-G][#b]{0,2}<\/a>-1\s*$/i.test(rawLine)) {
      pendingChords = null;
      continue;
    }

    if (/<a\b/i.test(rawLine)) {
      const chords = parseChordLine(rawLine);
      if (chords.length > 0) {
        pendingChords = chords;
        continue;
      }
    }

    lines.push({ chords: pendingChords ?? [], lyric: stripMarkup(rawLine) });
    pendingChords = null;
  }

  while (lines.at(-1)?.lyric === "" && lines.at(-1)?.chords.length === 0) {
    lines.pop();
  }
  if (lines.length === 0) {
    throw new LacuerdaParseError("La página no contiene líneas de canción compatibles.");
  }

  return { ...pageMetadata(html, sourceUrl), lines };
}

export function parseLacuerdaSongUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new LacuerdaParseError("Introduce una URL válida de acordes.lacuerda.net.");
  }

  const pathname = url.pathname.replace(/\/+$/g, "").replace(/\.shtml$/i, "");
  if (
    url.protocol !== "https:" ||
    url.hostname !== "acordes.lacuerda.net" ||
    url.port ||
    url.username ||
    url.password ||
    !/^\/[^/]+\/[^/]+$/i.test(pathname)
  ) {
    throw new LacuerdaParseError(
      "La URL debe ser una canción HTTPS de acordes.lacuerda.net.",
    );
  }
  url.pathname = `${pathname}.shtml`;
  url.search = "";
  url.hash = "";
  return url;
}

function validateSongUrl(input: string): URL {
  return parseLacuerdaSongUrl(input);
}

export async function fetchLacuerdaSong(input: string): Promise<ParsedSong> {
  let url = validateSongUrl(input);

  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "manual",
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirects === 3) {
        throw new LacuerdaFetchError("La página redirige demasiadas veces o sin destino.");
      }
      try {
        url = validateSongUrl(new URL(location, url).toString());
      } catch {
        throw new LacuerdaFetchError("La página intentó redirigir a un destino no permitido.");
      }
      continue;
    }

    if (!response.ok) {
      throw new LacuerdaFetchError(
        `La página respondió con el estado HTTP ${response.status}.`,
      );
    }

    return parseLacuerdaHtml(await response.text(), url);
  }

  throw new LacuerdaParseError("No se pudo seguir la redirección de la página.");
}
