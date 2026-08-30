const relayUrlEl = document.getElementById("relayUrl") as HTMLInputElement;
const apiKeyEl = document.getElementById("apiKey") as HTMLInputElement;
const allowEvalEl = document.getElementById("allowEval") as HTMLInputElement;
const saveBtn = document.getElementById("save") as HTMLButtonElement;
const feedbackEl = document.getElementById("feedback") as HTMLDivElement;
const statusPillEl = document.getElementById("status-pill") as HTMLSpanElement;
const statusTextEl = document.getElementById("status-text") as HTMLSpanElement;

if (new URLSearchParams(location.search).get("page") === "1") {
  document.body.classList.add("page");
}

function setFeedback(text: string, kind: "ok" | "bad" | "") {
  feedbackEl.textContent = text;
  feedbackEl.className = "feedback " + kind;
}

function setStatusPill(state: "connected" | "disconnected" | "unconfigured") {
  statusPillEl.className = "status-pill " + state;
  statusTextEl.textContent = state === "connected" ? "CONNECTED" : state === "disconnected" ? "DISCONNECTED" : "NOT CONFIGURED";
}

async function refreshStatus() {
  const stored = await chrome.storage.local.get(["relayUrl", "apiKey"]);
  if (!stored.relayUrl || !stored.apiKey) {
    setStatusPill("unconfigured");
    return;
  }
  chrome.runtime.sendMessage({ type: "GET_CONNECTION_STATE" }, (response: { connected: boolean } | undefined) => {
    void chrome.runtime.lastError; // background worker may be asleep briefly - ignore, next poll retries
    setStatusPill(response?.connected ? "connected" : "disconnected");
  });
}

async function load() {
  const stored = await chrome.storage.local.get(["relayUrl", "apiKey", "allowEval"]);
  relayUrlEl.value = stored.relayUrl ?? "";
  apiKeyEl.value = stored.apiKey ?? "";
  allowEvalEl.checked = !!stored.allowEval;
  await refreshStatus();
}

async function pasteInto(input: HTMLInputElement) {
  try {
    const text = await navigator.clipboard.readText();
    if (text) input.value = text.trim();
  } catch {
    setFeedback("Couldn't read clipboard - paste manually with Ctrl+V.", "bad");
  }
}

document.getElementById("pasteRelayUrl")!.addEventListener("click", () => pasteInto(relayUrlEl));
document.getElementById("pasteApiKey")!.addEventListener("click", () => pasteInto(apiKeyEl));
document.getElementById("toggleApiKey")!.addEventListener("click", () => {
  apiKeyEl.type = apiKeyEl.type === "password" ? "text" : "password";
});

saveBtn.addEventListener("click", async () => {
  const relayUrl = relayUrlEl.value.trim();
  const apiKey = apiKeyEl.value.trim();
  if (!relayUrl || !apiKey) {
    setFeedback("Both relay URL and API key are required.", "bad");
    return;
  }
  await chrome.storage.local.set({ relayUrl, apiKey, allowEval: allowEvalEl.checked });
  setFeedback("Saved - connecting...", "ok");
  setTimeout(refreshStatus, 800);
});

void load();
setInterval(refreshStatus, 2000);
