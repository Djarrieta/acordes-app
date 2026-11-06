import { renderError } from "../render/song";
import {
  getGuitarChordPositionCount,
  renderGuitarChordDiagram,
} from "../guitar/chords";

export function chordDiagramRoute(request: Request): Response {
  const { searchParams } = new URL(request.url);
  const chord = searchParams.get("chord")?.trim() ?? "";
  if (!chord) {
    return new Response(renderError("Selecciona un acorde para ver su digitación."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const positionValue = searchParams.get("position");
  const position = positionValue === null ? 0 : Number(positionValue);
  if (
    positionValue !== null &&
    (!/^\d+$/.test(positionValue) || !Number.isSafeInteger(position) || position < 0)
  ) {
    return new Response(renderError("La variante de digitación no es válida."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const targetValue = searchParams.get("target");
  const target =
    targetValue === null || targetValue === "chord-viewer"
      ? "chord-viewer"
      : targetValue === "accompaniment-chord-viewer"
        ? "accompaniment-chord-viewer"
        : null;
  if (!target) {
    return new Response(renderError("El destino del diagrama no es válido."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const positionCount = getGuitarChordPositionCount(chord);
  const diagram = renderGuitarChordDiagram(chord, position, target);
  if (!diagram) {
    const message =
      positionCount > 0
        ? "La variante de digitación seleccionada no está disponible."
        : `No encontré digitaciones conocidas para ${chord}.`;
    return new Response(renderError(message), {
      status: positionCount > 0 ? 400 : 422,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  return new Response(diagram, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
