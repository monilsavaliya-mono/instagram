-- DM Automation Test Lab - synthetic seed data
-- All names, messages and accounts below are fictional test fixtures.
-- Nothing here is real Instagram data, and no real credentials are involved.

DELETE FROM automation_log;
DELETE FROM actions;
DELETE FROM replies;
DELETE FROM messages;
DELETE FROM conversations;
DELETE FROM app_meta;

INSERT INTO app_meta (key, value) VALUES ('active_conversation_id', 'rahul-001');

-- ===================== Conversations =====================
INSERT INTO conversations (id, display_name, mode, tone, enabled, last_processed_message_id) VALUES
  ('rahul-001',     'Rahul',     'auto',     'casual', 1, 'msg-104'),
  ('professor-001', 'Professor', 'approval', 'formal', 1, 'msg-202'),
  ('aman-001',      'Aman',      'auto',     'casual', 1, 'msg-302'),
  ('family-001',    'Family',    'disabled', 'casual', 1, NULL),
  ('unknown-001',   'Unknown',   'ignore',   'neutral',1, NULL);

-- ===================== Rahul (AUTO) =====================
-- Scenario 1: normal casual chat -> expected action = reply (auto-sent, no approval)
INSERT INTO messages (id, conversation_id, sender, direction, text, processed, timestamp) VALUES
  ('msg-101', 'rahul-001', 'Rahul', 'incoming', 'Bro where are you?',              1, '2026-08-29 02:50:00'),
  ('msg-102', 'rahul-001', 'You',   'outgoing', 'At IITD',                          1, '2026-08-29 02:50:30'),
  ('msg-103', 'rahul-001', 'Rahul', 'incoming', 'Are you coming tomorrow?',         1, '2026-08-29 02:51:00'),
  ('msg-104', 'rahul-001', 'You',   'outgoing', 'Yeah bro, leaving now',            1, '2026-08-29 02:51:30'),
  ('msg-105', 'rahul-001', 'Rahul', 'incoming', 'Bring your charger, mine died',    0, '2026-08-29 03:12:10');

-- ===================== Professor (APPROVAL) =====================
-- Scenario 2: formal request -> expected action = reply, requires_approval = true
INSERT INTO messages (id, conversation_id, sender, direction, text, processed, timestamp) VALUES
  ('msg-201', 'professor-001', 'Professor', 'incoming', 'I wanted to ask about the assignment deadline.',                        1, '2026-08-29 01:00:00'),
  ('msg-202', 'professor-001', 'You',       'outgoing', 'The deadline is next Friday.',                                          1, '2026-08-29 01:05:00'),
  ('msg-203', 'professor-001', 'Professor', 'incoming', 'Thank you. Could we schedule a meeting to discuss my project as well?', 0, '2026-08-29 03:00:00');

-- ===================== Aman (AUTO) =====================
INSERT INTO messages (id, conversation_id, sender, direction, text, processed, timestamp) VALUES
  ('msg-301', 'aman-001', 'Aman', 'incoming', 'Yo, gym today?',        1, '2026-08-29 02:00:00'),
  ('msg-302', 'aman-001', 'You',  'outgoing', 'Yeah 6pm',              1, '2026-08-29 02:01:00'),
  ('msg-303', 'aman-001', 'Aman', 'incoming', 'Bet, see you there',    0, '2026-08-29 02:02:00');

-- ===================== Family (DISABLED) =====================
-- Scenario 4: automation disabled -> expected action = no automatic reply of any kind
INSERT INTO messages (id, conversation_id, sender, direction, text, processed, timestamp) VALUES
  ('msg-401', 'family-001', 'Mom', 'incoming', 'Beta, khana kha liya?', 0, '2026-08-29 01:30:00');

-- ===================== Unknown (IGNORE) =====================
-- Scenario 3: unsolicited contact -> expected action = ignore, no reply
INSERT INTO messages (id, conversation_id, sender, direction, text, processed, timestamp) VALUES
  ('msg-501', 'unknown-001', 'Unknown', 'incoming', 'Hey! Check out this link: totally-not-a-scam.example', 0, '2026-08-29 00:45:00');

-- ===================== Seed automation log =====================
INSERT INTO automation_log (conversation_id, event, created_at) VALUES
  ('rahul-001', 'Test environment seeded', '2026-08-29 03:12:10');

