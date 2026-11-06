import {
  fetchLacuerdaSong,
  LacuerdaFetchError,
  LacuerdaParseError,
} from "../parser/lacuerda";
import { renderError, renderSong } from "../render/song";
import { createSong } from "../state";

export async function loadRoute(request: Request): Promise<Response> {
  let url: string;
  let offset = 0;
  try {
    const form = await request.formData();
    const urlValue = form.get("url");
    if (typeof urlValue !== "string") {
      return new Response(renderError("Introduce la URL de una canción."), { status: 400 });
    }
    url = urlValue.trim();
    const offsetValue = form.get("offset");
    if (offsetValue !== null) {
      if (typeof offsetValue !== "string" || !/^-?\d+$/.test(offsetValue)) {
        return new Response(renderError("La preferencia de transposición no es válida."), {
          status: 400,
        });
      }
      offset = Number(offsetValue);
      if (!Number.isSafeInteger(offset)) {
        return new Response(renderError("La preferencia de transposición no es válida."), {
          status: 400,
        });
      }
    }
  } catch {
    return new Response(renderError("No se pudo leer el formulario enviado."), { status: 400 });
  }
  if (!url) {
    return new Response(renderError("Introduce la URL de una canción."), { status: 400 });
  }

  try {
    const parsed = await fetchLacuerdaSong(url);
    return new Response(renderSong(createSong(parsed, url, offset)), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (error) {
    console.error("Error al cargar una canción de LaCuerda:", error);
    const message =
      error instanceof LacuerdaParseError || error instanceof LacuerdaFetchError
        ? "No fue posible reproducir esta canción. Inténtalo de nuevo más tarde."
        : "No se pudo reproducir la canción. Inténtalo de nuevo más tarde.";
    return new Response(renderError(message), {
      status: error instanceof LacuerdaParseError ? 400 : 502,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}
