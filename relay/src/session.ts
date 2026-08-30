import type {
  ExtensionToRelayMessage,
  Instruction,
  InstructionResult,
  Op,
  RelayToExtensionMessage,
} from "@browser-control/shared";

interface Pending {
  resolve: (result: InstructionResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * One BrowserSession Durable Object instance per API key. It is the only
 * thing that ever holds the extension's live WebSocket - the Worker's fetch
 * handler (index.ts) never touches sockets directly, it just routes to the
 * right instance by key and awaits whatever this class returns.
 */
export class BrowserSession {
  private socket: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private connectedAt: number | null = null;

  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleExtensionConnect();
    }

    if (url.pathname === "/execute" && request.method === "POST") {
      return this.handleExecute(request);
    }

    if (url.pathname === "/status" && request.method === "GET") {
      return Response.json({
        connected: this.socket !== null,
        connectedAt: this.connectedAt,
        pendingCount: this.pending.size,
      });
    }

    return new Response("not found", { status: 404 });
  }

  private handleExtensionConnect(): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    server.accept();

    // A new connection replaces any stale one (e.g. the extension reloaded).
    if (this.socket) {
      try {
        this.socket.close(1000, "replaced by new connection");
      } catch {
        // already closed - ignore
      }
    }
    this.socket = server;
    this.connectedAt = Date.now();

    server.addEventListener("message", (event: MessageEvent) => {
      this.onExtensionMessage(event.data);
    });

    server.addEventListener("close", () => {
      if (this.socket === server) {
        this.socket = null;
        this.connectedAt = null;
      }
    });

    server.addEventListener("error", () => {
      if (this.socket === server) {
        this.socket = null;
        this.connectedAt = null;
      }
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  private onExtensionMessage(data: string | ArrayBuffer) {
    let msg: ExtensionToRelayMessage;
    try {
      msg = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data));
    } catch {
      return;
    }

    if (msg.type === "result") {
      const pending = this.pending.get(msg.result.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(msg.result.id);
        pending.resolve(msg.result);
      }
    }
  }

  private async handleExecute(request: Request): Promise<Response> {
    if (!this.socket) {
      return Response.json(
        { ok: false, error: "no browser extension is currently connected for this key" },
        { status: 503 },
      );
    }

    let op: Op;
    let timeoutMs = DEFAULT_TIMEOUT_MS;
    let tabId: "auto" | number = "auto";
    try {
      const body = (await request.json()) as { op: Op; timeoutMs?: number; tabId?: "auto" | number };
      op = body.op;
      if (body.timeoutMs) timeoutMs = body.timeoutMs;
      if (body.tabId !== undefined) tabId = body.tabId;
    } catch {
      return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
    }

    const id = crypto.randomUUID();
    const instruction: Instruction = { id, tabId, timeoutMs, payload: op };

    const resultPromise = new Promise<InstructionResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ id, ok: false, error: `timed out after ${timeoutMs}ms waiting for extension` });
      }, timeoutMs + 2000); // grace period beyond the extension's own timeout
      this.pending.set(id, { resolve, timer });
    });

    const message: RelayToExtensionMessage = { type: "instruction", instruction };
    this.socket.send(JSON.stringify(message));

    const result = await resultPromise;
    return Response.json(result, { status: result.ok ? 200 : 502 });
  }
}
