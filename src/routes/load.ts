import {
  fetchLacuerdaSong,
  LacuerdaFetchError,
  LacuerdaParseError,
} from "../parser/lacuerda";
import { renderError, renderSong } from "../render/song";
import { createSong } from "../state";

async function readFormValue(request: Request, key: string): Promise<string> {
  const form = await request.formData();
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function loadRoute(request: Request): Promise<Response> {
  let url: string;
  try {
    url = await readFormValue(request, "url");
  } catch {
    return new Response(renderError("No se pudo leer el formulario enviado."), { status: 400 });
  }
  if (!url) {
    return new Response(renderError("Introduce la URL de una canción."), { status: 400 });
  }

  try {
    const parsed = await fetchLacuerdaSong(url);
    return new Response(renderSong(createSong(parsed, url)), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (error) {
    console.error("Error al cargar una canción de LaCuerda:", error);
    const message =
      error instanceof LacuerdaParseError || error instanceof LacuerdaFetchError
        ? error.message
        : "No se pudo conectar con LaCuerda. Inténtalo de nuevo más tarde.";
    return new Response(renderError(message), {
      status: error instanceof LacuerdaParseError ? 400 : 502,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}
