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

## Setup

### 1. Install dependencies

```bash
git clone <this repo>
cd <repo>
npm install
```

### 2. Deploy the relay (Cloudflare Workers, free tier)

```bash
cd relay
npx wrangler login
npx wrangler deploy
```

Wrangler prints your relay's URL, e.g. `https://browser-control-relay.YOUR-SUBDOMAIN.workers.dev`.

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

Click the extension's **Details → Extension options**, and enter:
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
shared/       Instruction-set (ISA) types shared by every layer
relay/        Cloudflare Worker + Durable Object
extension/    Chrome MV3 extension (background + content script + options page)
agent/        Node/TS CLI - Claude Opus 5 + Tool Runner over the relay's API
docs/         Architecture and design notes
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
