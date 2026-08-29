# DM Automation Test Lab

A **mock** Instagram-DM-automation test environment. It simulates an inbox,
lets you inject incoming messages, and exposes a REST API + a
machine-readable status page so an external AI assistant can read the
current conversation state, decide on a reply, submit it, and verify it
was recorded.

> **This project is NOT connected to Instagram.** It does not use
> Instagram credentials, session cookies, scraping, or browser automation,
> and never claims to be the real Instagram API. All conversations,
> contacts, and messages are synthetic test fixtures created by this
> repository.

## What's in here

```
dm-automation-test-lab/
├── index.html          Mock Instagram-style inbox UI
├── test.html            Machine-readable test dashboard
├── app.js               Frontend logic for index.html
├── config.js             Points the frontend at your deployed backend
├── styles.css           Shared styling (not Instagram branding)
├── README.md             This file
│
├── backend/
│   ├── worker.js         Cloudflare Worker - the REST API
│   ├── wrangler.toml      Worker + D1 configuration
│   ├── schema.sql         Database schema
│   └── seed.sql           Seed/test data (also embedded in worker.js for /api/reset)
│
└── docs/
    └── architecture.md    Diagram + design notes
```

## 1. Architecture

```
Public Mock Instagram UI (GitHub Pages, static)
        |
        | HTTPS (fetch)
        v
Cloudflare Worker  (backend/worker.js)  <-- serverless, free tier
        |
        v
Cloudflare D1  (SQLite-compatible)      <-- serverless, free tier
```

No Docker, no VPS, no GPU, no local server or database required for the
deployed system. See `docs/architecture.md` for details.

---

## 2. Deploy the backend (Cloudflare Workers + D1)

Cloudflare's free tier is genuinely free (no credit card required for the
tiers this project needs) and requires no Docker/VPS.

### 2.1 Prerequisites

```bash
npm install -g wrangler
wrangler login
```

### 2.2 Create the D1 database

```bash
cd backend
wrangler d1 create dm_automation_test_lab
```

This prints a `database_id`. Copy it into `backend/wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "dm_automation_test_lab"
database_id = "PASTE_YOUR_DATABASE_ID_HERE"
```

### 2.3 Load the schema and seed data

```bash
wrangler d1 execute dm_automation_test_lab --remote --file=schema.sql
wrangler d1 execute dm_automation_test_lab --remote --file=seed.sql
```

(Use `--local` instead of `--remote` first if you want to test with
`wrangler dev` before deploying.)

### 2.4 Set the allowed CORS origin

Edit `backend/wrangler.toml`:

```toml
[vars]
ALLOWED_ORIGIN = "https://YOUR_GITHUB_USERNAME.github.io"
```

You can pass a comma-separated list (e.g. to also allow local testing):

```toml
ALLOWED_ORIGIN = "https://YOUR_GITHUB_USERNAME.github.io,http://localhost:5500"
```

### 2.5 Deploy

```bash
wrangler deploy
```

Wrangler prints your Worker's public URL, e.g.:

```
https://dm-automation-test-lab.YOUR-SUBDOMAIN.workers.dev
```

That is your backend base URL — used in every API call below.

---

## 3. Deploy the frontend (GitHub Pages)

### 3.1 Point the frontend at your backend

Edit `config.js` at the repo root:

```js
window.DM_LAB_CONFIG = {
  API_BASE: "https://dm-automation-test-lab.YOUR-SUBDOMAIN.workers.dev",
};
```

Commit and push this change.

### 3.2 Enable GitHub Pages

In your repository on GitHub:

```
Repository
→ Settings
→ Pages
→ Build and deployment → Source: "Deploy from a branch"
→ Branch: main
→ Folder: / (root)
→ Save
```

GitHub will publish the site at:

```
https://USERNAME.github.io/REPOSITORY/
```

(substituting your GitHub username and repository name). It can take a
minute or two after the first save for the page to go live.

The test dashboard will then be at:

```
https://USERNAME.github.io/REPOSITORY/test.html
```

---

## 4. Local development (optional)

You do not need this to use the deployed system, but it's convenient
while editing:

```bash
git clone https://github.com/USERNAME/REPOSITORY.git
cd REPOSITORY

# Backend: run the Worker locally with a local D1 instance
cd backend
wrangler d1 execute dm_automation_test_lab --local --file=schema.sql
wrangler d1 execute dm_automation_test_lab --local --file=seed.sql
wrangler dev
# Worker now listening on http://localhost:8787

# Frontend: serve the static files with any static server, e.g.
cd ..
python3 -m http.server 5500
# open http://localhost:5500/index.html
```

While developing locally, set `config.js`'s `API_BASE` to
`http://localhost:8787` and add `http://localhost:5500` to
`ALLOWED_ORIGIN` in `backend/wrangler.toml`.

---

## 5. Data model

**Conversation**
```json
{
  "id": "rahul-001",
  "display_name": "Rahul",
  "mode": "auto",
  "enabled": true,
  "last_processed_message_id": "msg-104"
}
```

**Message**
```json
{
  "id": "msg-105",
  "conversation_id": "rahul-001",
  "sender": "Rahul",
  "direction": "incoming",
  "text": "Bro are you coming tomorrow?",
  "timestamp": "2026-08-29 03:12:10"
}
```

**Reply / action**
```json
{
  "id": "action-123",
  "conversation_id": "rahul-001",
  "action": "reply",
  "reply_text": "Yeah bro, I'll be there",
  "status": "pending"
}
```

### Seed conversations

| Conversation | Mode      | Notes                                    |
|--------------|-----------|-------------------------------------------|
| Rahul        | AUTO      | Casual chat, replies sent automatically   |
| Professor    | APPROVAL  | Formal chat, replies require approval     |
| Aman         | AUTO      | Casual chat, replies sent automatically   |
| Family       | DISABLED  | Automation off, never auto-replies        |
| Unknown      | IGNORE    | Unsolicited contact, always ignored       |

---

## 6. API reference

All endpoints are relative to your Worker's base URL. All responses are
JSON. CORS is restricted to the origin(s) set in `ALLOWED_ORIGIN`.

| Method | Path                          | Purpose                                      |
|--------|-------------------------------|-----------------------------------------------|
| GET    | `/api/health`                 | Backend + database liveness                  |
| GET    | `/api/conversations`          | List all conversations with latest preview   |
| GET    | `/api/conversations/:id`      | One conversation + full message history      |
| GET    | `/api/messages/:conversationId` | Messages for a conversation                |
| POST   | `/api/messages`               | Inject a new incoming message                |
| POST   | `/api/decision`                | Simulated AI decision (reply/ignore)         |
| POST   | `/api/replies`                 | Store a reply, mark message processed        |
| GET    | `/api/pending`                 | Unprocessed messages + pending actions       |
| POST   | `/api/actions/:id/complete`    | Mark a pending action completed              |
| GET    | `/api/state`                   | Machine-readable current state (see below)   |
| GET    | `/api/rules`                   | Automation rules per conversation            |
| GET    | `/api/logs`                    | Automation log entries                       |
| POST   | `/api/reset`                   | Restore seed data                            |

### `GET /api/state`

The single most important endpoint for automated testing. Optionally pass
`?conversation_id=<id>` to inspect a specific conversation; otherwise it
reports whichever conversation is currently "active" (the last one opened
in the UI or the last one a message was injected into).

```json
{
  "active_conversation": { "id": "rahul-001", "name": "Rahul", "mode": "auto" },
  "latest_incoming_message": { "id": "msg-105", "text": "Bro where are you?", "processed": false },
  "latest_processed_message_id": "msg-104",
  "needs_response": true,
  "pending_action": null
}
```

### `POST /api/messages` — inject an incoming message

```json
{ "conversation_id": "rahul-001", "sender": "Rahul", "text": "Bro where are you?" }
```
`sender` is optional and defaults to the conversation's display name.

### `POST /api/decision` — simulated AI decision

```json
{ "conversation_id": "rahul-001", "message_id": "msg-105" }
```
Returns one of:
```json
{ "action": "reply", "requires_approval": false, "action_id": "action-abc123", "status": "pending" }
{ "action": "ignore", "requires_approval": false, "action_id": "action-abc123", "status": "completed" }
{ "action": "already_processed" }
```

### `POST /api/replies` — submit a reply

```json
{
  "conversation_id": "rahul-001",
  "reply_to_message_id": "msg-105",
  "reply_text": "Yeah bro, coming in 10 mins"
}
```
Success:
```json
{ "success": true, "status": "sent", "reply_id": "reply-abc123" }
```
Duplicate protection — replying to an already-processed message:
```json
{ "action": "already_processed" }
```

### `GET /api/rules`

```json
{
  "rahul-001": { "mode": "auto", "tone": "casual", "enabled": true },
  "professor-001": { "mode": "approval", "tone": "formal", "enabled": true },
  "family-001": { "mode": "disabled", "tone": "casual", "enabled": true },
  "unknown-001": { "mode": "ignore", "tone": "neutral", "enabled": true }
}
```

### `POST /api/reset`

Restores the five seed conversations and their seed messages. Does not
drop or recreate tables — only clears and reinserts the mock rows.

---

## 7. Test scenarios

These map directly to the seeded data (also restored by `POST /api/reset`):

1. **Rahul (AUTO)** — incoming: *"Bring your charger, mine died"* (`msg-105`,
   unprocessed). Expected: `POST /api/decision` returns
   `{"action":"reply","requires_approval":false}`; a reply can be sent
   immediately via `POST /api/replies`.
2. **Professor (APPROVAL)** — incoming: *"Thank you. Could we schedule a
   meeting to discuss my project as well?"* (`msg-203`). Expected:
   `POST /api/decision` returns `{"action":"reply","requires_approval":true}`;
   the reply is only stored once a human/AI explicitly calls
   `POST /api/replies`.
3. **Unknown (IGNORE)** — incoming: *"Hey! Check out this link:
   totally-not-a-scam.example"* (`msg-501`). Expected: `POST /api/decision`
   returns `{"action":"ignore"}` and the message is auto-marked processed
   with no reply ever sent.
4. **Family (DISABLED)** — incoming: *"Beta, khana kha liya?"* (`msg-401`).
   Expected: automation is off entirely; `needs_response` is always
   `false` for this conversation regardless of unprocessed messages.

---

## 8. External AI testing workflow

This is the exact loop the system is built to support:

```
1. Open /test.html
2. Read CURRENT CHAT
3. Read NEWEST MESSAGE
4. Determine required response
5. Call POST /api/replies
6. Reload /test.html
7. Confirm reply appears
8. Confirm message is marked processed
```

Equivalent curl commands:

```bash
# 1-4: read current state
curl https://YOUR-BACKEND/api/state

# 5: submit a reply
curl -X POST https://YOUR-BACKEND/api/replies \
  -H "Content-Type: application/json" \
  -d '{
    "conversation_id":"rahul-001",
    "reply_to_message_id":"msg-105",
    "reply_text":"Yeah bro, coming in 10 mins"
  }'

# 6-8: re-check state - latest_processed_message_id should now match
# the message you just replied to, and needs_response should be false
# (unless a new unprocessed message has arrived since).
curl https://YOUR-BACKEND/api/state
```

Other useful commands:

```bash
# Inject a fresh incoming message to test against
curl -X POST https://YOUR-BACKEND/api/messages \
  -H "Content-Type: application/json" \
  -d '{"conversation_id":"rahul-001","text":"Bro where are you?"}'

# Ask for a decision before replying
curl -X POST https://YOUR-BACKEND/api/decision \
  -H "Content-Type: application/json" \
  -d '{"conversation_id":"rahul-001","message_id":"msg-105"}'

# List everything still waiting on a response
curl https://YOUR-BACKEND/api/pending

# Reset back to seed data
curl -X POST https://YOUR-BACKEND/api/reset
```

---

## 9. Security notes

- No Instagram login, session cookies, or real auth tokens are used or
  stored anywhere in this project.
- No browser automation or scraping of any real site occurs.
- All conversation data is synthetic and created by this repository's
  seed data or by testers using the "Inject Incoming Message" control.
- CORS is restricted to `ALLOWED_ORIGIN`; avoid `*` in a real deployment.
- The backend never identifies itself as, or claims to be, the real
  Instagram API.
