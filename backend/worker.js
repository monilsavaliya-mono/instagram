/**
 * DM Automation Test Lab - backend worker
 *
 * IMPORTANT: This is a MOCK system for testing an AI reply-decision loop.
 * It is NOT connected to Instagram in any way: no Instagram credentials,
 * cookies, sessions, scraping, or browser automation are used anywhere in
 * this code. All data is synthetic test fixtures created by this project.
 *
 * Runs on Cloudflare Workers with a D1 database binding named `DB`.
 */

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

function corsHeaders(env, request) {
  const configured = (env.ALLOWED_ORIGIN || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const origin = request.headers.get('Origin');
  let allowOrigin = configured[0] || '*';

  if (configured.includes('*')) {
    allowOrigin = '*';
  } else if (origin && configured.includes(origin)) {
    allowOrigin = origin;
  }

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data, null, 2), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function newId(prefix) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

async function getMeta(db, key) {
  const row = await db.prepare('SELECT value FROM app_meta WHERE key = ?').bind(key).first();
  return row ? row.value : null;
}

async function setMeta(db, key, value) {
  await db
    .prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value)
    .run();
}

async function logEvent(db, conversationId, event) {
  await db
    .prepare('INSERT INTO automation_log (conversation_id, event) VALUES (?, ?)')
    .bind(conversationId, event)
    .run();
}

async function getConversation(db, id) {
  return db.prepare('SELECT * FROM conversations WHERE id = ?').bind(id).first();
}

async function getMessage(db, id) {
  return db.prepare('SELECT * FROM messages WHERE id = ?').bind(id).first();
}

async function latestIncoming(db, conversationId) {
  return db
    .prepare(
      `SELECT * FROM messages WHERE conversation_id = ? AND direction = 'incoming'
       ORDER BY timestamp DESC, rowid DESC LIMIT 1`
    )
    .bind(conversationId)
    .first();
}

function needsResponse(conversation, latestIncomingMsg) {
  if (!latestIncomingMsg) return false;
  if (latestIncomingMsg.processed) return false;
  return conversation.mode === 'auto' || conversation.mode === 'approval';
}

// ---------------------------------------------------------------------------
// Seed data (mirrors backend/seed.sql, used by POST /api/reset)
// ---------------------------------------------------------------------------

async function resetDatabase(db) {
  const stmts = [
    db.prepare('DELETE FROM automation_log'),
    db.prepare('DELETE FROM actions'),
    db.prepare('DELETE FROM replies'),
    db.prepare('DELETE FROM messages'),
    db.prepare('DELETE FROM conversations'),
    db.prepare('DELETE FROM app_meta'),

    db.prepare("INSERT INTO app_meta (key, value) VALUES ('active_conversation_id', 'rahul-001')"),

    db.prepare(
      `INSERT INTO conversations (id, display_name, mode, tone, enabled, last_processed_message_id) VALUES
        ('rahul-001','Rahul','auto','casual',1,'msg-104'),
        ('professor-001','Professor','approval','formal',1,'msg-202'),
        ('aman-001','Aman','auto','casual',1,'msg-302'),
        ('family-001','Family','disabled','casual',1,NULL),
        ('unknown-001','Unknown','ignore','neutral',1,NULL)`
    ),

    db.prepare(
      `INSERT INTO messages (id, conversation_id, sender, direction, text, processed, timestamp) VALUES
        ('msg-101','rahul-001','Rahul','incoming','Bro where are you?',1,'2026-08-29 02:50:00'),
        ('msg-102','rahul-001','You','outgoing','At IITD',1,'2026-08-29 02:50:30'),
        ('msg-103','rahul-001','Rahul','incoming','Are you coming tomorrow?',1,'2026-08-29 02:51:00'),
        ('msg-104','rahul-001','You','outgoing','Yeah bro, leaving now',1,'2026-08-29 02:51:30'),
        ('msg-105','rahul-001','Rahul','incoming','Bring your charger, mine died',0,'2026-08-29 03:12:10')`
    ),

    db.prepare(
      `INSERT INTO messages (id, conversation_id, sender, direction, text, processed, timestamp) VALUES
        ('msg-201','professor-001','Professor','incoming','I wanted to ask about the assignment deadline.',1,'2026-08-29 01:00:00'),
        ('msg-202','professor-001','You','outgoing','The deadline is next Friday.',1,'2026-08-29 01:05:00'),
        ('msg-203','professor-001','Professor','incoming','Thank you. Could we schedule a meeting to discuss my project as well?',0,'2026-08-29 03:00:00')`
    ),

    db.prepare(
      `INSERT INTO messages (id, conversation_id, sender, direction, text, processed, timestamp) VALUES
        ('msg-301','aman-001','Aman','incoming','Yo, gym today?',1,'2026-08-29 02:00:00'),
        ('msg-302','aman-001','You','outgoing','Yeah 6pm',1,'2026-08-29 02:01:00'),
        ('msg-303','aman-001','Aman','incoming','Bet, see you there',0,'2026-08-29 02:02:00')`
    ),

    db.prepare(
      `INSERT INTO messages (id, conversation_id, sender, direction, text, processed, timestamp) VALUES
        ('msg-401','family-001','Mom','incoming','Beta, khana kha liya?',0,'2026-08-29 01:30:00')`
    ),

    db.prepare(
      `INSERT INTO messages (id, conversation_id, sender, direction, text, processed, timestamp) VALUES
        ('msg-501','unknown-001','Unknown','incoming','Hey! Check out this link: totally-not-a-scam.example',0,'2026-08-29 00:45:00')`
    ),

    db.prepare(
      "INSERT INTO automation_log (conversation_id, event) VALUES ('rahul-001', 'Test environment reset to seed state')"
    ),
  ];

  await db.batch(stmts);
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleListConversations(db) {
  const { results } = await db
    .prepare(
      `SELECT c.*,
              (SELECT text FROM messages m WHERE m.conversation_id = c.id ORDER BY m.timestamp DESC, m.rowid DESC LIMIT 1) AS latest_text,
              (SELECT sender FROM messages m WHERE m.conversation_id = c.id ORDER BY m.timestamp DESC, m.rowid DESC LIMIT 1) AS latest_sender,
              (SELECT timestamp FROM messages m WHERE m.conversation_id = c.id ORDER BY m.timestamp DESC, m.rowid DESC LIMIT 1) AS latest_timestamp
       FROM conversations c
       ORDER BY latest_timestamp DESC`
    )
    .all();

  const conversations = [];
  for (const row of results) {
    const inc = await latestIncoming(db, row.id);
    conversations.push({
      id: row.id,
      display_name: row.display_name,
      mode: row.mode,
      tone: row.tone,
      enabled: !!row.enabled,
      last_processed_message_id: row.last_processed_message_id,
      latest_message: row.latest_text
        ? { sender: row.latest_sender, text: row.latest_text, timestamp: row.latest_timestamp }
        : null,
      needs_response: needsResponse(row, inc),
    });
  }
  return conversations;
}

async function handleGetConversation(db, id) {
  const convo = await getConversation(db, id);
  if (!convo) return null;
  const { results: messages } = await db
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC, rowid ASC')
    .bind(id)
    .all();
  const inc = await latestIncoming(db, id);
  return {
    ...convo,
    enabled: !!convo.enabled,
    needs_response: needsResponse(convo, inc),
    messages,
  };
}

async function buildState(db, conversationId) {
  const activeId = conversationId || (await getMeta(db, 'active_conversation_id')) || 'rahul-001';
  const convo = await getConversation(db, activeId);
  if (!convo) return null;

  const inc = await latestIncoming(db, activeId);
  const pendingAction = await db
    .prepare(
      `SELECT * FROM actions WHERE conversation_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`
    )
    .bind(activeId)
    .first();

  return {
    active_conversation: { id: convo.id, name: convo.display_name, mode: convo.mode },
    latest_incoming_message: inc ? { id: inc.id, text: inc.text, processed: !!inc.processed } : null,
    latest_processed_message_id: convo.last_processed_message_id,
    needs_response: needsResponse(convo, inc),
    pending_action: pendingAction
      ? {
          id: pendingAction.id,
          action: pendingAction.action,
          requires_approval: !!pendingAction.requires_approval,
          status: pendingAction.status,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Main fetch handler
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env, request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const db = env.DB;

    try {
      // ---- GET /api/health ----
      if (path === '/api/health' && request.method === 'GET') {
        let dbOk = false;
        try {
          await db.prepare('SELECT 1 as ok').first();
          dbOk = true;
        } catch (e) {
          dbOk = false;
        }
        return json(
          { api: 'online', database: dbOk ? 'online' : 'offline', mock: true, connected_to_instagram: false },
          200,
          cors
        );
      }

      // ---- GET /api/conversations ----
      if (path === '/api/conversations' && request.method === 'GET') {
        const conversations = await handleListConversations(db);
        return json({ conversations }, 200, cors);
      }

      // ---- GET /api/conversations/:id ----
      let m = path.match(/^\/api\/conversations\/([^/]+)$/);
      if (m && request.method === 'GET') {
        const convo = await handleGetConversation(db, m[1]);
        if (!convo) return json({ error: 'conversation not found' }, 404, cors);
        await setMeta(db, 'active_conversation_id', m[1]);
        return json({ conversation: convo }, 200, cors);
      }

      // ---- GET /api/messages/:conversationId ----
      m = path.match(/^\/api\/messages\/([^/]+)$/);
      if (m && request.method === 'GET') {
        const convo = await getConversation(db, m[1]);
        if (!convo) return json({ error: 'conversation not found' }, 404, cors);
        const { results } = await db
          .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC, rowid ASC')
          .bind(m[1])
          .all();
        return json({ messages: results }, 200, cors);
      }

      // ---- POST /api/messages (inject an incoming message) ----
      if (path === '/api/messages' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const { conversation_id, text } = body;
        if (!conversation_id || !text) {
          return json({ error: 'conversation_id and text are required' }, 400, cors);
        }
        const convo = await getConversation(db, conversation_id);
        if (!convo) return json({ error: 'conversation not found' }, 404, cors);

        const sender = body.sender && body.sender.trim() ? body.sender.trim() : convo.display_name;
        const id = newId('msg');
        const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

        await db
          .prepare(
            `INSERT INTO messages (id, conversation_id, sender, direction, text, processed, timestamp)
             VALUES (?, ?, ?, 'incoming', ?, 0, ?)`
          )
          .bind(id, conversation_id, sender, text, timestamp)
          .run();

        await setMeta(db, 'active_conversation_id', conversation_id);
        await logEvent(db, conversation_id, `New message detected: "${text}"`);

        return json({ success: true, message: { id, conversation_id, sender, direction: 'incoming', text, processed: 0, timestamp } }, 201, cors);
      }

      // ---- POST /api/decision (simulated AI decision) ----
      if (path === '/api/decision' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const { conversation_id, message_id } = body;
        if (!conversation_id || !message_id) {
          return json({ error: 'conversation_id and message_id are required' }, 400, cors);
        }
        const convo = await getConversation(db, conversation_id);
        const msg = await getMessage(db, message_id);
        if (!convo || !msg || msg.conversation_id !== conversation_id) {
          return json({ error: 'conversation or message not found' }, 404, cors);
        }

        await logEvent(db, conversation_id, 'AI decision requested');

        if (msg.processed) {
          return json({ action: 'already_processed' }, 200, cors);
        }

        const existingAction = await db
          .prepare("SELECT * FROM actions WHERE message_id = ? AND status = 'pending' LIMIT 1")
          .bind(message_id)
          .first();
        if (existingAction) {
          return json(
            {
              action: existingAction.action,
              requires_approval: !!existingAction.requires_approval,
              action_id: existingAction.id,
              status: existingAction.status,
            },
            200,
            cors
          );
        }

        let action, requiresApproval, autoComplete;
        if (convo.mode === 'disabled') {
          action = 'ignore';
          requiresApproval = false;
          autoComplete = true;
        } else if (convo.mode === 'ignore') {
          action = 'ignore';
          requiresApproval = false;
          autoComplete = true;
        } else if (convo.mode === 'approval') {
          action = 'reply';
          requiresApproval = true;
          autoComplete = false;
        } else {
          // auto
          action = 'reply';
          requiresApproval = false;
          autoComplete = false;
        }

        const actionId = newId('action');
        await db
          .prepare(
            `INSERT INTO actions (id, conversation_id, message_id, action, requires_approval, status)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .bind(actionId, conversation_id, message_id, action, requiresApproval ? 1 : 0, autoComplete ? 'completed' : 'pending')
          .run();

        if (autoComplete) {
          await db.prepare('UPDATE messages SET processed = 1 WHERE id = ?').bind(message_id).run();
          await db.prepare('UPDATE conversations SET last_processed_message_id = ? WHERE id = ?').bind(message_id, conversation_id).run();
          await logEvent(db, conversation_id, `Message ignored (mode: ${convo.mode})`);
        } else {
          await logEvent(db, conversation_id, action === 'reply' ? 'Reply decision generated' : 'Ignore decision generated');
        }

        return json({ action, requires_approval: requiresApproval, action_id: actionId, status: autoComplete ? 'completed' : 'pending' }, 200, cors);
      }

      // ---- POST /api/replies ----
      if (path === '/api/replies' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const { conversation_id, reply_to_message_id, reply_text } = body;
        if (!conversation_id || !reply_to_message_id || !reply_text) {
          return json({ error: 'conversation_id, reply_to_message_id and reply_text are required' }, 400, cors);
        }
        const convo = await getConversation(db, conversation_id);
        const msg = await getMessage(db, reply_to_message_id);
        if (!convo || !msg || msg.conversation_id !== conversation_id) {
          return json({ error: 'conversation or message not found' }, 404, cors);
        }

        // Mandatory duplicate protection: never reply to the same message twice.
        if (msg.processed) {
          return json({ action: 'already_processed' }, 200, cors);
        }

        const replyId = newId('reply');
        const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

        await logEvent(db, conversation_id, 'Reply generated');

        await db.batch([
          db
            .prepare(
              `INSERT INTO replies (id, conversation_id, reply_to_message_id, reply_text, status)
               VALUES (?, ?, ?, ?, 'sent')`
            )
            .bind(replyId, conversation_id, reply_to_message_id, reply_text),
          db
            .prepare(
              `INSERT INTO messages (id, conversation_id, sender, direction, text, processed, timestamp)
               VALUES (?, ?, 'You', 'outgoing', ?, 1, ?)`
            )
            .bind(newId('msg'), conversation_id, reply_text, timestamp),
          db.prepare('UPDATE messages SET processed = 1 WHERE id = ?').bind(reply_to_message_id),
          db
            .prepare('UPDATE conversations SET last_processed_message_id = ? WHERE id = ?')
            .bind(reply_to_message_id, conversation_id),
          db
            .prepare("UPDATE actions SET status = 'completed' WHERE message_id = ? AND status = 'pending'")
            .bind(reply_to_message_id),
        ]);

        await logEvent(db, conversation_id, 'Reply submitted');
        await logEvent(db, conversation_id, 'Message marked processed');

        return json({ success: true, status: 'sent', reply_id: replyId }, 201, cors);
      }

      // ---- GET /api/pending ----
      if (path === '/api/pending' && request.method === 'GET') {
        const { results: pendingMessages } = await db
          .prepare(
            `SELECT m.*, c.display_name, c.mode FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
             WHERE m.direction = 'incoming' AND m.processed = 0
             ORDER BY m.timestamp ASC`
          )
          .all();
        const { results: pendingActions } = await db
          .prepare("SELECT * FROM actions WHERE status = 'pending' ORDER BY created_at ASC")
          .all();
        return json({ pending_messages: pendingMessages, pending_actions: pendingActions }, 200, cors);
      }

      // ---- POST /api/actions/:id/complete ----
      m = path.match(/^\/api\/actions\/([^/]+)\/complete$/);
      if (m && request.method === 'POST') {
        const action = await db.prepare('SELECT * FROM actions WHERE id = ?').bind(m[1]).first();
        if (!action) return json({ error: 'action not found' }, 404, cors);
        if (action.status === 'completed') {
          return json({ action: 'already_processed' }, 200, cors);
        }

        await db.prepare("UPDATE actions SET status = 'completed' WHERE id = ?").bind(m[1]).run();
        if (action.action === 'ignore') {
          await db.prepare('UPDATE messages SET processed = 1 WHERE id = ?').bind(action.message_id).run();
          await db
            .prepare('UPDATE conversations SET last_processed_message_id = ? WHERE id = ?')
            .bind(action.message_id, action.conversation_id)
            .run();
        }
        await logEvent(db, action.conversation_id, `Action ${m[1]} marked completed`);

        return json({ success: true, action_id: m[1], status: 'completed' }, 200, cors);
      }

      // ---- GET /api/state ----
      if (path === '/api/state' && request.method === 'GET') {
        const conversationId = url.searchParams.get('conversation_id');
        const state = await buildState(db, conversationId);
        if (!state) return json({ error: 'no active conversation found' }, 404, cors);
        return json(state, 200, cors);
      }

      // ---- GET /api/rules ----
      if (path === '/api/rules' && request.method === 'GET') {
        const { results } = await db.prepare('SELECT id, mode, tone, enabled FROM conversations').all();
        const rules = {};
        for (const row of results) {
          rules[row.id] = { mode: row.mode, tone: row.tone, enabled: !!row.enabled };
        }
        return json(rules, 200, cors);
      }

      // ---- GET /api/logs ----
      if (path === '/api/logs' && request.method === 'GET') {
        const conversationId = url.searchParams.get('conversation_id');
        const stmt = conversationId
          ? db
              .prepare('SELECT * FROM automation_log WHERE conversation_id = ? ORDER BY id DESC LIMIT 50')
              .bind(conversationId)
          : db.prepare('SELECT * FROM automation_log ORDER BY id DESC LIMIT 50');
        const { results } = await stmt.all();
        return json({ logs: results }, 200, cors);
      }

      // ---- POST /api/reset ----
      if (path === '/api/reset' && request.method === 'POST') {
        await resetDatabase(db);
        return json({ success: true, status: 'reset' }, 200, cors);
      }

      return json({ error: 'not found', path }, 404, cors);
    } catch (err) {
      return json({ error: 'internal error', message: String(err && err.message ? err.message : err) }, 500, cors);
    }
  },
};
