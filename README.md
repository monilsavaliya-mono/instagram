# Browser Control

Give a natural-language task ("open YouTube and play X", "summarize the last
few days of this group chat") to a Claude-powered agent, and it drives a real
browser tab to do it — reading the DOM, clicking, typing, extracting text —
through an extension you install and a relay you deploy yourself.

**This is a genuine remote-control capability, not a toy.** It requires a
security-first setup: the extension shows an unmissable "remotely
controllable" badge whenever connected, the relay is authenticated by an API
key you choose, and risky operations (`browse_eval`) are off by default. See
[docs/architecture.md](docs/architecture.md) for the full design and the
threat model behind these choices.

## The three layers

```
Natural-language task
        │
        ▼
  agent/       Claude Opus 5 + Tool Runner. Decides what to do, calls the
               relay's REST API for every browser action. Runs anywhere
               (your laptop, a server) - it's just an HTTP client.
        │  HTTPS POST /v1/execute  (Authorization: Bearer <api_key>)
        ▼
  relay/       Cloudflare Worker + Durable Object. Routes instructions
               between callers and whichever extension is connected under
               that API key. No browser-specific logic - just a router.
        │  persistent WebSocket (outbound from the extension)
        ▼
  extension/   Chrome MV3 extension. background.ts dispatches instructions;
               content.ts reads/clicks/types on the actual page DOM.
        │
        ▼
  shared/      The instruction-set types every layer imports, so the wire
               format can only drift in one place.
```

`agent/` is one caller of the relay's API - `mcp-server/` (for Claude Code /
Claude Desktop) and `integrations/openapi.yaml` (for ChatGPT or any other
OpenAPI-consuming tool) are alternative "brains" against the exact same
relay and extension, no changes needed to either. See "Connecting a chat AI
directly" below.

## Setup

### 1. Install dependencies

```bash
git clone <this repo>
cd <repo>
npm install
```

### 2. Deploy the relay (Cloudflare Workers, free tier)

**Option A - Cloudflare dashboard (no local CLI needed):**

1. dash.cloudflare.com → **Workers & Pages → Create → Import a repository** → select this repo
2. **Build command**: leave empty
3. **Deploy command**: `npx -y wrangler deploy --config relay/wrangler.toml`
4. **Deploy**

**Option B - local CLI:**

```bash
cd relay
npx wrangler login
npx wrangler deploy
```

Either way you get a URL like `https://browser-control-relay.YOUR-SUBDOMAIN.workers.dev`.

> If the deploy fails with `code: 10097` ("must create a namespace using a
> new_sqlite_classes migration"), that's Cloudflare's free-plan requirement
> for Durable Objects - already handled in `relay/wrangler.toml`, so this
> only bites if you're editing the migration yourself.

Pick a long random string as your API key right now (e.g. `openssl rand -hex 32`)
— it authenticates both the extension and every external caller. Treat it
like a password; there is no separate account system in this MVP.

### 3. Install the extension

```bash
cd extension
npm run build
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load
unpacked** → select the `extension/` folder.

Pin it (puzzle-piece icon in the toolbar → pin) and click its icon to open
the settings popup directly - no need to go through `chrome://extensions →
Details` each time. Paste in (each field has a 📋 paste button):
- **Relay URL**: the Worker URL from step 2
- **API key**: the same string you picked in step 2
- **Allow EVAL**: leave unchecked unless you specifically need arbitrary JS execution

Save. The toolbar badge should turn green (**ON**) within a few seconds —
that means the extension is connected and this browser is controllable by
anyone holding the API key. It turns red (**OFF**) when disconnected and
amber (**?**) when unconfigured; it is never invisible while a key is set,
by design.

### 4. Run the agent

```bash
export ANTHROPIC_API_KEY=sk-ant-...       # or `ant auth login`
export BROWSER_RELAY_URL=https://browser-control-relay.YOUR-SUBDOMAIN.workers.dev
export BROWSER_API_KEY=<the same key from step 2>

npm run agent -- "open youtube.com and search for lofi hip hop radio"
```

The agent reads the page, decides what to click/type, and reports back what
it did. A task that doesn't need the browser at all ("summarize this text: ...")
just gets answered directly — Claude only reaches for a browser tool when the
task actually needs one.

## Connecting a chat AI directly (instead of the CLI agent)

The CLI agent above already **is** a chat-driven agent - it's just invoked
from a terminal line instead of a chat bubble. If you want to talk to it from
an actual chat interface instead, there are two ways in, covering both the
Anthropic ecosystem and everything else:

### Claude Code / Claude Desktop (MCP)

`mcp-server/` is a standard MCP server exposing the same operations as tools
(`browse_read_tree`, `browse_click`, etc.) over stdio - the way Claude Code
and Claude Desktop connect to external tools natively. It runs *locally* (it
needs to reach your relay over the internet, same as the CLI agent), so this
is for a **local** Claude Code/Desktop install, not the hosted Claude.ai web
app (which would need a separately-hosted remote MCP server - out of scope
here).

Add this to your project's `.mcp.json` (create it at the repo root if it
doesn't exist):

```json
{
  "mcpServers": {
    "browser-control": {
      "command": "npx",
      "args": ["tsx", "mcp-server/src/index.ts"],
      "env": {
        "BROWSER_RELAY_URL": "https://browser-control-relay.YOUR-SUBDOMAIN.workers.dev",
        "BROWSER_API_KEY": "<the same key from step 2>"
      }
    }
  }
}
```

Restart Claude Code, then just chat: "open youtube and play X" - it'll call
the tools itself. (`claude mcp add` is also available as a CLI shortcut for
the same thing; run `claude mcp add --help` for its current flags rather
than trusting this README to have them exactly right.)

### ChatGPT, or any other OpenAPI-consuming AI gateway

`integrations/openapi.yaml` describes the relay's REST API as a standard
OpenAPI 3.1 spec - one clean operation per browser action
(`click`, `typeText`, `readTree`, ...), Bearer-authenticated. This is the
portable format most non-Anthropic tools expect for "call this API as a
tool."

For a ChatGPT Custom GPT:
1. Edit the `servers.url` in `integrations/openapi.yaml` to your relay URL (or push the edit and use the raw GitHub URL)
2. chat.openai.com → **Explore GPTs → Create → Configure → Add actions → Import from URL** (or paste the YAML directly)
3. **Authentication → API Key → Bearer**, paste your relay API key
4. Test it in the preview pane: "open youtube.com and search for lofi hip hop"

Any other framework that can import an OpenAPI spec as callable tools
(LangChain's OpenAPI toolkit, Zapier AI Actions, a custom agent loop you
write yourself) works the same way against this same file.

## What it can actually do (and can't)

- **Reading chat/message pages**: `browse_read_tree` and `browse_extract`
  pull message text out of whatever page is open (WhatsApp Web, Discord,
  Slack, etc.) so the agent can summarize or answer questions about it.
  Long history that lazy-loads on scroll needs `browse_scroll_into_view`
  between reads.
- **File uploads cannot be automated.** No browser allows scripting a
  `<input type=file>` from JS — this needs a real OS-level file picker
  interaction. Don't expect `browse_click` + `browse_type` to fill a file field.
- **Cross-origin iframes** (payment forms, some embeds) are a hard security
  boundary the extension can't cross without a matching content-script
  injection into that origin specifically.
- **Anti-bot defenses are real.** Sites actively defending against
  automation (Cloudflare/PerimeterX-protected pages, `navigator.webdriver`
  checks) may block this regardless of how well it's built.

## Repository layout

```
shared/         Instruction-set (ISA) types shared by every layer
relay/          Cloudflare Worker + Durable Object
extension/      Chrome MV3 extension (background + content script + options page)
agent/          Node/TS CLI - Claude Opus 5 + Tool Runner over the relay's API
mcp-server/     MCP server (stdio) for Claude Code / Claude Desktop
integrations/   openapi.yaml - for ChatGPT Custom GPT Actions or any other
                OpenAPI-consuming AI gateway
docs/           Architecture and design notes
```

## Known limitations (MVP)

- **No account system.** The API key is a single shared secret, not a
  per-user credential store. Rotating it means updating both the extension's
  options page and every caller's environment.
- **Service worker keep-alive is a 1-minute polling alarm**, not the
  WebSocket Hibernation API. In the worst case there's a short window after
  Chrome kills an idle service worker before the next alarm reconnects it.
  Hardening this to hibernation-based wake-on-demand is the natural next step.
- **`browse_screenshot` is not yet wired into the agent's tool set** — the
  relay/extension path for it works (`SCREENSHOT` op), but returning the
  image bytes as a proper visual content block back to Claude needs the
  exact tool-result image-block shape verified against the SDK before wiring
  it up, rather than guessed.
