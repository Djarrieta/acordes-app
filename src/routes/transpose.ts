import { renderError, renderSong } from "../render/song";
import { getSong, resetSong, transposeSong } from "../state";

async function readForm(request: Request): Promise<FormData> {
  return request.formData();
}

export async function transposeRoute(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await readForm(request);
  } catch {
    return new Response(renderError("No se pudo leer la solicitud."), { status: 400 });
  }

  const id = form.get("id");
  const deltaValue = form.get("delta");
  if (typeof id !== "string" || !id) {
    return new Response(renderError("Falta el identificador de la canción."), { status: 400 });
  }
  const delta = Number(deltaValue);
  if (
    typeof deltaValue !== "string" ||
    !Number.isInteger(delta) ||
    ![-2, -1, 1, 2].includes(delta)
  ) {
    return new Response(renderError("El intervalo de transposición no es válido."), {
      status: 400,
    });
  }

  const state = transposeSong(id, delta);
  if (!state) {
    return new Response(renderError("La canción ya no está disponible. Vuelve a cargarla."), {
      status: 404,
    });
  }
  return new Response(renderSong(state), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function resetRoute(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await readForm(request);
  } catch {
    return new Response(renderError("No se pudo leer la solicitud."), { status: 400 });
  }

  const id = form.get("id");
  if (typeof id !== "string" || !id) {
    return new Response(renderError("Falta el identificador de la canción."), { status: 400 });
  }
  const state = resetSong(id);
  if (!state) {
    return new Response(renderError("La canción ya no está disponible. Vuelve a cargarla."), {
      status: 404,
    });
  }
  return new Response(renderSong(state), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
