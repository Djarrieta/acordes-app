export function html(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...headers },
  });
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export function notFound(message = "No encontrado."): Response {
  return new Response(message, { status: 404 });
}

export function methodNotAllowed(allow: string): Response {
  return new Response("Método no permitido.", {
    status: 405,
    headers: { Allow: allow },
  });
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "local";
}

export function bodyTooLarge(request: Request, limit = 1_000_000): boolean {
  const length = request.headers.get("content-length");
  if (!length) return false;
  const value = Number(length);
  return Number.isFinite(value) && value > limit;
}
