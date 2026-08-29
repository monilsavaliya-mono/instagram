# Architecture

## Overview

DM Automation Test Lab is a mock testing environment for exercising an AI
reply-decision loop end-to-end, without touching Instagram or any real
social-media account.

```
Public Mock UI (GitHub Pages)          Test Dashboard (GitHub Pages)
  index.html / app.js / styles.css       test.html
        |                                     |
        |  fetch()                           |  fetch()
        v                                     v
              Cloudflare Worker (backend/worker.js)
                        |
                        v
              Cloudflare D1 (SQLite-compatible)
```

- **Frontend**: static HTML/CSS/vanilla JS, deployable as-is to GitHub
  Pages. No build step, no framework.
- **Backend**: a single Cloudflare Worker script exposing a small REST
  API. Cloudflare Workers' free tier runs this with no server to manage.
- **Database**: Cloudflare D1, a serverless SQLite database with a
  generous free tier, bound to the Worker as `DB`.

## Data model

- `conversations` — one row per mock DM thread. Carries the automation
  `mode` (`auto` | `approval` | `disabled` | `ignore`), a `tone` used only
  to pick a canned suggested reply, and `last_processed_message_id`.
- `messages` — every message in every conversation, `direction` of
  `incoming` (from the mock contact) or `outgoing` (a stored reply).
  Incoming messages carry a `processed` flag used for duplicate
  protection.
- `replies` — an audit trail of every reply ever submitted through
  `POST /api/replies`.
- `actions` — decisions returned by `POST /api/decision` (`reply` or
  `ignore`), with a `status` of `pending` or `completed`. This is what
  the "approval" mode holds until a human/AI actually posts a reply.
- `automation_log` — a timestamped event feed shown as the "Automation
  Log" panel in the UI, and readable via `GET /api/logs`.
- `app_meta` — a one-row-per-key table used to remember which
  conversation is currently "active" (the one returned by
  `GET /api/state`). Opening a conversation, or injecting a message into
  one, makes it active.

## Request flow for the target test loop

1. `POST /api/messages` inserts a new incoming message (`processed = 0`)
   and marks its conversation as the active one.
2. `GET /api/state` (or the `test.html` dashboard that wraps it) reports
   `needs_response: true` for that conversation's mode.
3. An external AI reads that page/endpoint, decides on reply text.
4. `POST /api/replies` stores the reply as a new outgoing message,
   flips the original incoming message to `processed = 1`, and updates
   `last_processed_message_id`. Duplicate replies to the same message are
   rejected with `{"action": "already_processed"}`.
5. The UI and `/api/state` immediately reflect the update on next fetch.

## Why this shape

- Everything is stateless HTTP + SQL — no websockets, queues, or
  background workers, so it fits entirely inside free tiers.
- The "decision" step is separated from the "reply" step
  (`POST /api/decision` vs `POST /api/replies`) so a real LLM can be
  slotted in later purely on the client side (or in a second Worker)
  without changing the storage contract.
- CORS is restricted by an environment variable (`ALLOWED_ORIGIN`) rather
  than hardcoded, so the same Worker code works for local development and
  production GitHub Pages origins.
