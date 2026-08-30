# Architecture

## Why three layers, not one extension

A browser extension can't accept inbound network connections — there is no
way for an external tool to "call the extension" directly. The only path out
is the extension opening an *outbound* connection to something else. That
constraint is why this is three separate pieces rather than one:

```
agent (brain)  --HTTP-->  relay (bus, hosted)  <--WebSocket--  extension (hands)
```

- **extension/** never talks to the internet at large — only to the relay it's configured with.
- **relay/** never touches a DOM — it's a dumb, opaque router keyed by API key.
- **agent/** never touches the browser directly — it's just another HTTP client of the relay's REST API, so it can run anywhere, or be swapped for a different caller entirely (a curl script, a different LLM, a human-driven dashboard) without touching the other two layers.

## The instruction set (ISA)

Defined once in `shared/src/index.ts`, implemented once in
`extension/src/content.ts`, and exposed once as Claude tools in
`agent/src/index.ts`. Each op is deliberately narrow and named for what it
does, not "execute(command)" — see "Bash vs. dedicated tools" below for why.

| Op | What it does | Executed by |
|---|---|---|
| `READ_TREE` | Simplified accessibility-tree snapshot: role, accessible name, value, bounding box, visibility, per-session `aiIndex` for every interesting node (interactive elements *and* text-bearing leaves like chat bubbles) | content script |
| `CLICK` / `HOVER` / `SCROLL_INTO_VIEW` | Real pointer event sequences at the element's actual coordinates, not just `.click()` | content script |
| `TYPE` | Native-value-setter + `input`/`change` events for real inputs; Selection/`execCommand` path for `contenteditable` | content script |
| `SELECT_OPTION` / `KEY_PRESS` | Native `<select>` and keyboard event dispatch | content script |
| `WAIT_FOR_SELECTOR` | `MutationObserver`-based wait with timeout | content script |
| `EXTRACT` | Bulk text pull by CSS selector, returns arrays — built for pulling chat history in one call | content script |
| `NAVIGATE` | Tab navigation + load-complete wait | background (content scripts can't navigate their own tab) |
| `SCREENSHOT` | Visible-viewport capture | background (`chrome.tabs.captureVisibleTab` isn't available to content scripts) |
| `EVAL` | Arbitrary JS in the page's own `MAIN` world | background, via `chrome.scripting.executeScript` — **gated off by default** |

### Why dedicated tools instead of one generic `execute(op, args)`

Per Anthropic's own agent-design guidance: promote an action to a dedicated
tool exactly when the harness needs to gate, audit, or render it
differently. `browse_click` and `browse_eval` need different trust levels —
collapsing them into one opaque tool call would mean the harness (or a
future approval UI) can no longer tell them apart before they run.

### Why accessibility-tree JSON instead of screenshots + coordinates

Anthropic's built-in **Computer Use** tool is the right choice when an agent
*only* has pixels to work with (a real desktop). We have the actual DOM, so a
structured tree is cheaper (far fewer tokens than an image) and more
reliable (`aiIndex` targeting doesn't drift the way pixel coordinates do
after a layout shift).

## The relay's request/response correlation

The core trick, in `relay/src/session.ts`: one Durable Object instance per
API key holds the extension's live WebSocket. An external `POST
/v1/execute` becomes a `Promise` stored in a `pending` map keyed by a
generated instruction ID; the instruction is pushed down the socket; when
the extension's result arrives back up the same socket, the map lookup
resolves the original HTTP request. A timeout (default 15s + 2s grace)
resolves it with a clear error instead of hanging forever if the extension
never replies — verified directly (see the test transcript in the build
session: a socket that never responds correctly times out at the expected
17s wall-clock rather than blocking the caller indefinitely).

## Security model — what's built in and why

This is not a local tool anymore once you point it at a hosted relay: the
API key is the *only* thing separating "your own automation" from "a
stranger driving your logged-in email tab from anywhere on the internet."
Non-negotiables baked into the first commit, not left as later hardening:

1. **Visible control indicator.** The extension's toolbar badge shows
   ON/OFF/unconfigured at all times — never silent. This mirrors how every
   legitimate remote-control product (TeamViewer, Chrome Remote Desktop)
   works, and keeps the extension honest with Chrome Web Store's
   remote-control disclosure expectations.
2. **`EVAL` is off by default**, per-installation, checked server-side (in
   the extension itself, not just documentation) before any arbitrary JS
   runs. Toggled explicitly in the options page.
3. **One key = one identity.** Revoking access means picking a new key and
   reconfiguring the extension — there's no way to partially revoke while
   leaving old access alive, which is a deliberate simplicity trade-off for
   the MVP (see README "Known limitations" for what a real account system
   would add).

## What's honestly not solved yet

- File input automation is impossible from JS in any browser, by design —
  not a bug to fix, a platform wall.
- Cross-origin iframes need their own content-script injection into that
  origin; the current build injects into every origin the extension has host
  permission for (`<all_urls>`), which covers same-page same-origin iframes
  but not sandboxed cross-origin ones that actively resist embedding.
- The MV3 service worker keep-alive is alarm-based polling, not the
  WebSocket Hibernation API — good enough for an MVP, not for a
  production-grade "never miss an instruction" guarantee.
