-- DM Automation Test Lab - D1 schema
-- This is a MOCK system. No real Instagram data of any kind is stored here.

DROP TABLE IF EXISTS automation_log;
DROP TABLE IF EXISTS actions;
DROP TABLE IF EXISTS replies;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS conversations;
DROP TABLE IF EXISTS app_meta;

CREATE TABLE conversations (
  id                       TEXT PRIMARY KEY,
  display_name             TEXT NOT NULL,
  mode                     TEXT NOT NULL DEFAULT 'auto',   -- auto | approval | disabled | ignore
  tone                     TEXT NOT NULL DEFAULT 'casual',
  enabled                  INTEGER NOT NULL DEFAULT 1,
  last_processed_message_id TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  sender          TEXT NOT NULL,
  direction       TEXT NOT NULL,              -- incoming | outgoing
  text            TEXT NOT NULL,
  processed       INTEGER NOT NULL DEFAULT 0, -- only meaningful for incoming messages
  timestamp       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE replies (
  id                  TEXT PRIMARY KEY,
  conversation_id     TEXT NOT NULL REFERENCES conversations(id),
  reply_to_message_id TEXT NOT NULL,
  reply_text          TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'sent',
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE actions (
  id                 TEXT PRIMARY KEY,
  conversation_id    TEXT NOT NULL REFERENCES conversations(id),
  message_id         TEXT NOT NULL,
  action             TEXT NOT NULL,            -- reply | ignore
  reply_text         TEXT,
  requires_approval  INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'pending', -- pending | completed
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE automation_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT,
  event           TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Single-row key/value table used to track which conversation is
-- currently "active" (the one shown as CURRENT CHAT / returned by /api/state).
CREATE TABLE app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_actions_message ON actions(message_id);
CREATE INDEX idx_replies_message ON replies(reply_to_message_id);
