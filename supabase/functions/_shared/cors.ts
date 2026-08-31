const DEFAULT_ALLOWED_ORIGINS = [
  "https://ui.wexio.be",
  "https://wexio.be",
  "https://www.wexio.be",
  "https://app.wexio.be",
  "https://demo.wexio.be",
  "https://brb.wexio.be",
];

function parseExtraOrigins(): string[] {
  const raw = Deno.env.get("CORS_ALLOWED_ORIGINS") ?? "";
  if (!raw.trim()) return [];
  return raw
    .split(",")
    .map((origin) => normalizeOrigin(origin.trim()))
    .filter(Boolean);
}

export const ALLOWED_ORIGINS = new Set([...DEFAULT_ALLOWED_ORIGINS, ...parseExtraOrigins()]);

function normalizeOrigin(value: string): string {
  try {
    const u = new URL(value);
    if (u.username || u.password || (u.pathname && u.pathname !== "/") || u.search || u.hash) return "";
    const protocol = u.protocol.toLowerCase();
    const hostname = u.hostname.toLowerCase();
    const hasDefaultPort = (protocol === "https:" && (u.port === "" || u.port === "443"))
      || (protocol === "http:" && (u.port === "" || u.port === "80"));
    const portPart = hasDefaultPort ? "" : `:${u.port}`;
    return `${protocol}//${hostname}${portPart}`;
  } catch {
    return "";
  }
}

export function resolveAllowOrigin(req: Request): string | null {
  const origin = normalizeOrigin((req.headers.get("origin") ?? "").trim());
  if (!origin) return null;
  if (ALLOWED_ORIGINS.has(origin)) return origin;

  // Allow any *.wexio.be subdomain (tenant workspaces like snakman-a3f7c1.wexio.be)
  try {
    const u = new URL(origin);
    if (u.hostname.endsWith(".wexio.be")) return origin;
  } catch {
    // ignore
  }

  return null;
}

export function corsHeaders(req: Request): Record<string, string> {
  const allowOrigin = resolveAllowOrigin(req);
  const allowHeaders =
    "authorization, apikey, content-type, x-client-info, x-requested-with, accept, origin, x-request-id, x-tenant-id, x-target-tenant-id, x-tenant-slug, x-wexio-language, idempotency-key, x-idempotency-key, x-confirm-application-id";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": allowHeaders,
    "Vary": "Origin",
  };
  if (allowOrigin) {
    headers["Access-Control-Allow-Origin"] = allowOrigin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return headers;
}

export function withCors(req: Request, res: Response) {
  const h = new Headers(res.headers);
  for (const name of [
    "Access-Control-Allow-Origin",
    "Access-Control-Allow-Credentials",
    "Access-Control-Allow-Headers",
    "Access-Control-Allow-Methods",
    "Access-Control-Max-Age",
  ]) {
    h.delete(name);
  }
  const cors = corsHeaders(req);
  for (const [k, v] of Object.entries(cors)) h.set(k, v);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: h,
  });
}

export function corsPreflight(req: Request) {
  const allowOrigin = resolveAllowOrigin(req);
  if (!allowOrigin) {
    return new Response(null, {
      status: 403,
      headers: { "Vary": "Origin", "Cache-Control": "no-store" },
    });
  }
  // 204 responses must not include a body in Edge runtimes.
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(req),
      "Cache-Control": "public, max-age=600",
    },
  });
}
