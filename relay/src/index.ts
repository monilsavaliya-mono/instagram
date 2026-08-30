export { BrowserSession } from "./session";

export interface Env {
  SESSIONS: DurableObjectNamespace;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

function sessionFor(env: Env, apiKey: string): DurableObjectStub {
  const id = env.SESSIONS.idFromName(apiKey);
  return env.SESSIONS.get(id);
}

function bearerKey(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const key = header.slice("Bearer ".length).trim();
  return key.length > 0 ? key : null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // ---- GET /health - plain liveness check, no auth, no per-key state ----
    if (url.pathname === "/health") {
      return withCors(Response.json({ status: "online", mock: false, service: "browser-control-relay" }));
    }

    // ---- GET /connect?key=... - the EXTENSION connects here as a WebSocket client ----
    // Browsers cannot set custom headers on a WebSocket handshake, so the key
    // travels as a query param here instead of an Authorization header.
    if (url.pathname === "/connect") {
      const key = url.searchParams.get("key");
      if (!key) return new Response("missing ?key=", { status: 401 });
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected a WebSocket upgrade request", { status: 426 });
      }
      return sessionFor(env, key).fetch(request);
    }

    // ---- Everything else under /v1/* is for EXTERNAL callers, Bearer-authed ----
    if (url.pathname.startsWith("/v1/")) {
      const key = bearerKey(request);
      if (!key) {
        return withCors(
          Response.json({ ok: false, error: "missing Authorization: Bearer <api_key>" }, { status: 401 }),
        );
      }
      const stub = sessionFor(env, key);

      if (url.pathname === "/v1/execute" && request.method === "POST") {
        const forwarded = new Request(new URL("/execute", "https://do/"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: await request.text(),
        });
        return withCors(await stub.fetch(forwarded));
      }

      if (url.pathname === "/v1/status" && request.method === "GET") {
        const forwarded = new Request(new URL("/status", "https://do/"));
        return withCors(await stub.fetch(forwarded));
      }

      return withCors(Response.json({ ok: false, error: "not found" }, { status: 404 }));
    }

    return withCors(Response.json({ error: "not found", path: url.pathname }, { status: 404 }));
  },
};
