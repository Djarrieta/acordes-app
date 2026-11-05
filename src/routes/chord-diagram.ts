import { renderError } from "../render/song";
import { renderGuitarChordDiagram } from "../guitar/chords";

export function chordDiagramRoute(request: Request): Response {
  const chord = new URL(request.url).searchParams.get("chord")?.trim() ?? "";
  if (!chord) {
    return new Response(renderError("Selecciona un acorde para ver su digitación."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const diagram = renderGuitarChordDiagram(chord);
  if (!diagram) {
    return new Response(renderError(`No hay una digitación disponible para ${chord}.`), {
      status: 422,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  return new Response(diagram, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
