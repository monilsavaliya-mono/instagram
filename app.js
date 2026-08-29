// DM Automation Test Lab - frontend logic (plain JS, no framework)
// This talks only to the mock backend configured in config.js. It never
// touches Instagram in any way.

const API_BASE = (window.DM_LAB_CONFIG && window.DM_LAB_CONFIG.API_BASE) || "";

const state = {
  conversations: [],
  currentId: null,
};

function apiUrl(path) {
  return API_BASE.replace(/\/+$/, "") + path;
}

async function apiGet(path) {
  const res = await fetch(apiUrl(path));
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return res.json();
}

function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function setStatus(el, online) {
  el.innerHTML =
    `<span class="status-dot ${online ? "status-online" : "status-offline"}"></span>` +
    (online ? "ONLINE" : "OFFLINE");
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderConversationList() {
  const list = document.getElementById("conversation-list");
  list.innerHTML = "";
  for (const c of state.conversations) {
    const li = document.createElement("li");
    li.className = "convo-item" + (c.id === state.currentId ? " active" : "");
    li.dataset.id = c.id;
    li.innerHTML = `
      <div class="row1">
        <span class="name">${escapeHtml(c.display_name)}${c.needs_response ? '<span class="needs-response-dot" title="Needs response"></span>' : ""}</span>
        <span class="mode-pill mode-${c.mode}">${c.mode}</span>
      </div>
      <div class="preview">${c.latest_message ? escapeHtml(c.latest_message.sender + ": " + c.latest_message.text) : "no messages yet"}</div>
    `;
    li.addEventListener("click", () => selectConversation(c.id));
    list.appendChild(li);
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderMessages(convo) {
  document.getElementById("chat-title").textContent = convo.display_name;
  document.getElementById("chat-subtitle").textContent =
    `mode: ${convo.mode.toUpperCase()} · tone: ${convo.tone}`;

  const list = document.getElementById("message-list");
  list.innerHTML = "";
  for (const msg of convo.messages) {
    const row = document.createElement("div");
    row.className = "bubble-row " + msg.direction;
    const unprocessed = msg.direction === "incoming" && !msg.processed;
    row.innerHTML = `
      <div class="bubble ${unprocessed ? "unprocessed" : ""}">
        <span class="sender">${escapeHtml(msg.sender)}</span>
        ${escapeHtml(msg.text)}
        <span class="meta">${fmtTime(msg.timestamp)}${unprocessed ? " · UNPROCESSED" : ""}</span>
      </div>
    `;
    list.appendChild(row);
  }
  list.scrollTop = list.scrollHeight;
}

function renderConversationStateScriptTag(payload) {
  const tag = document.getElementById("conversation-state");
  if (tag) tag.textContent = JSON.stringify(payload, null, 2);
}

function renderStatePanel(convo, apiState) {
  const inc = apiState.latest_incoming_message;
  document.getElementById("state-current-chat").textContent = convo.display_name;
  document.getElementById("state-newest-message").textContent = inc ? `${convo.display_name}: "${inc.text}"` : "(none)";
  document.getElementById("state-message-status").textContent = inc ? (inc.processed ? "PROCESSED" : "UNPROCESSED") : "N/A";
  document.getElementById("state-chat-mode").textContent = convo.mode.toUpperCase();
  document.getElementById("state-needs-response").textContent = apiState.needs_response ? "YES" : "NO";
  document.getElementById("state-pending-action").textContent = apiState.pending_action
    ? `${apiState.pending_action.action.toUpperCase()} (${apiState.pending_action.status})`
    : "NONE";
}

function renderLogs(logs) {
  const list = document.getElementById("automation-log");
  list.innerHTML = "";
  if (!logs.length) {
    list.innerHTML = '<li>No automation events yet. Inject a message to get started.</li>';
    return;
  }
  for (const entry of logs) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="ts">${fmtTime(entry.created_at)}</span>${escapeHtml(entry.event)}`;
    list.appendChild(li);
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function refreshHealth() {
  try {
    const health = await apiGet("/api/health");
    setStatus(document.getElementById("backend-status"), health.api === "online");
    setStatus(document.getElementById("database-status"), health.database === "online");
  } catch (e) {
    setStatus(document.getElementById("backend-status"), false);
    setStatus(document.getElementById("database-status"), false);
  }
}

async function loadConversations() {
  const data = await apiGet("/api/conversations");
  state.conversations = data.conversations || [];
  renderConversationList();
  return state.conversations;
}

async function selectConversation(id) {
  state.currentId = id;
  const data = await apiGet(`/api/conversations/${id}`);
  if (!data.conversation) return;
  const convo = data.conversation;
  renderConversationList();
  renderMessages(convo);

  const apiState = await apiGet(`/api/state?conversation_id=${id}`);
  renderStatePanel(convo, apiState);
  renderConversationStateScriptTag({ conversation: convo, state: apiState });

  const logData = await apiGet(`/api/logs?conversation_id=${id}`);
  renderLogs(logData.logs || []);

  const reply = document.getElementById("reply-box");
  reply.placeholder = suggestReply(convo);
}

function suggestReply(convo) {
  return convo.tone === "formal"
    ? "Thank you for your message, I will get back to you shortly."
    : "Yeah, on it! 😂";
}

async function refreshAll() {
  await refreshHealth();
  await loadConversations();
  if (state.currentId) {
    await selectConversation(state.currentId);
  } else if (state.conversations.length) {
    await selectConversation(state.conversations[0].id);
  }
}

async function processCurrentMessage() {
  if (!state.currentId) return;
  const convoData = await apiGet(`/api/conversations/${state.currentId}`);
  const convo = convoData.conversation;
  const unprocessed = [...convo.messages].reverse().find((m) => m.direction === "incoming" && !m.processed);
  if (!unprocessed) {
    alert("No unprocessed incoming message in this conversation.");
    return;
  }
  const decision = await apiPost("/api/decision", { conversation_id: state.currentId, message_id: unprocessed.id });

  if (decision.action === "already_processed") {
    await selectConversation(state.currentId);
    return;
  }

  if (decision.action === "reply" && !decision.requires_approval) {
    await apiPost("/api/replies", {
      conversation_id: state.currentId,
      reply_to_message_id: unprocessed.id,
      reply_text: suggestReply(convo),
    });
  }
  // "ignore" and "reply requiring approval" cases are already reflected in
  // backend state (message stays unprocessed while awaiting approval).

  await loadConversations();
  await selectConversation(state.currentId);
}

async function sendTestReply() {
  if (!state.currentId) return;
  const textarea = document.getElementById("reply-box");
  const text = textarea.value.trim();
  if (!text) {
    alert("Type a reply first.");
    return;
  }
  const convoData = await apiGet(`/api/conversations/${state.currentId}`);
  const convo = convoData.conversation;
  const unprocessed = [...convo.messages].reverse().find((m) => m.direction === "incoming" && !m.processed);
  if (!unprocessed) {
    alert("No unprocessed incoming message to reply to.");
    return;
  }
  const result = await apiPost("/api/replies", {
    conversation_id: state.currentId,
    reply_to_message_id: unprocessed.id,
    reply_text: text,
  });
  if (result.action === "already_processed") {
    alert("That message was already processed (duplicate protection).");
  }
  textarea.value = "";
  await loadConversations();
  await selectConversation(state.currentId);
}

async function resetEnvironment() {
  if (!confirm("Reset the mock test environment back to seed data? This only affects test data, not your deployment.")) {
    return;
  }
  await apiPost("/api/reset", {});
  state.currentId = null;
  await refreshAll();
}

function openInjectModal() {
  const select = document.getElementById("inject-conversation");
  select.innerHTML = state.conversations
    .map((c) => `<option value="${c.id}">${escapeHtml(c.display_name)} (${c.mode})</option>`)
    .join("");
  if (state.currentId) select.value = state.currentId;
  document.getElementById("inject-message").value = "";
  document.getElementById("inject-modal").hidden = false;
}

function closeInjectModal() {
  document.getElementById("inject-modal").hidden = true;
}

async function submitInject() {
  const conversation_id = document.getElementById("inject-conversation").value;
  const text = document.getElementById("inject-message").value.trim();
  if (!text) {
    alert("Enter a message to inject.");
    return;
  }
  await apiPost("/api/messages", { conversation_id, text });
  closeInjectModal();
  await loadConversations();
  await selectConversation(conversation_id);
}

// ---------------------------------------------------------------------------
// Wire up
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btn-refresh").addEventListener("click", refreshAll);
  document.getElementById("btn-inject").addEventListener("click", openInjectModal);
  document.getElementById("btn-process").addEventListener("click", processCurrentMessage);
  document.getElementById("btn-send-reply").addEventListener("click", sendTestReply);
  document.getElementById("btn-reset").addEventListener("click", resetEnvironment);
  document.getElementById("inject-cancel").addEventListener("click", closeInjectModal);
  document.getElementById("inject-submit").addEventListener("click", submitInject);

  refreshAll();
});
