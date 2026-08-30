import type { ElementTarget, Op } from "@browser-control/shared";

export { BrowserSession } from "./session";

export interface Env {
  SESSIONS: DurableObjectNamespace;
}

// Flat, single-purpose REST routes over the same execute() logic as
// /v1/execute - one clean path per op with a plain (non-discriminated-union)
// request body, because that is what OpenAPI-driven tool callers (ChatGPT
// Custom GPT Actions, most agent frameworks that import an OpenAPI spec)
// work best against. /v1/execute stays as the generic form the agent/ and
// mcp-server/ packages use directly.
const OP_ROUTES: Record<string, (body: Record<string, unknown>) => Op> = {
  "read-tree": () => ({ op: "READ_TREE" }),
  click: (b) => ({ op: "CLICK", target: b.target as ElementTarget }),
  hover: (b) => ({ op: "HOVER", target: b.target as ElementTarget }),
  "scroll-into-view": (b) => ({ op: "SCROLL_INTO_VIEW", target: b.target as ElementTarget }),
  type: (b) => ({ op: "TYPE", target: b.target as ElementTarget, text: b.text as string, clearFirst: b.clearFirst as boolean | undefined }),
  "select-option": (b) => ({ op: "SELECT_OPTION", target: b.target as ElementTarget, value: b.value as string }),
  "key-press": (b) => ({ op: "KEY_PRESS", key: b.key as string, target: b.target as ElementTarget | undefined }),
  navigate: (b) => ({ op: "NAVIGATE", url: b.url as string }),
  "wait-for-selector": (b) => ({ op: "WAIT_FOR_SELECTOR", target: b.target as ElementTarget, timeoutMs: b.timeoutMs as number | undefined }),
  extract: (b) => ({ op: "EXTRACT", schema: b.schema as Record<string, string> }),
  eval: (b) => ({ op: "EVAL", code: b.code as string }),
};

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

      const opsMatch = url.pathname.match(/^\/v1\/ops\/([a-z-]+)$/);
      if (opsMatch && request.method === "POST") {
        const buildOp = OP_ROUTES[opsMatch[1]];
        if (!buildOp) {
          return withCors(Response.json({ ok: false, error: `unknown op route "${opsMatch[1]}"` }, { status: 404 }));
        }
        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return withCors(Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 }));
        }
        const forwarded = new Request(new URL("/execute", "https://do/"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: buildOp(body), timeoutMs: body.timeoutMs }),
        });
        return withCors(await stub.fetch(forwarded));
      }

      return withCors(Response.json({ ok: false, error: "not found" }, { status: 404 }));
    }

    return withCors(Response.json({ error: "not found", path: url.pathname }, { status: 404 }));
  },
};
