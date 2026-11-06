import { parseYoutubeVideoId } from "../youtube";

export async function youtubeVideoIdRoute(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "No se pudo leer el enlace enviado." }, { status: 400 });
  }

  const url = form.get("url");
  if (typeof url !== "string" || !url.trim()) {
    return Response.json({ error: "Pega un enlace de YouTube." }, { status: 400 });
  }
  const videoId = parseYoutubeVideoId(url.trim());
  if (!videoId) {
    return Response.json(
      { error: "El enlace no es válido. Usa un video, Short o transmisión de YouTube." },
      { status: 400 },
    );
  }
  return Response.json({ videoId });
}
