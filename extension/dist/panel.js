"use strict";
(() => {
  // src/panel.ts
  var relayUrlEl = document.getElementById("relayUrl");
  var apiKeyEl = document.getElementById("apiKey");
  var allowEvalEl = document.getElementById("allowEval");
  var saveBtn = document.getElementById("save");
  var feedbackEl = document.getElementById("feedback");
  var statusPillEl = document.getElementById("status-pill");
  var statusTextEl = document.getElementById("status-text");
  if (new URLSearchParams(location.search).get("page") === "1") {
    document.body.classList.add("page");
  }
  function setFeedback(text, kind) {
    feedbackEl.textContent = text;
    feedbackEl.className = "feedback " + kind;
  }
  function setStatusPill(state) {
    statusPillEl.className = "status-pill " + state;
    statusTextEl.textContent = state === "connected" ? "CONNECTED" : state === "disconnected" ? "DISCONNECTED" : "NOT CONFIGURED";
  }
  async function refreshStatus() {
    const stored = await chrome.storage.local.get(["relayUrl", "apiKey"]);
    if (!stored.relayUrl || !stored.apiKey) {
      setStatusPill("unconfigured");
      return;
    }
    chrome.runtime.sendMessage({ type: "GET_CONNECTION_STATE" }, (response) => {
      void chrome.runtime.lastError;
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
  async function pasteInto(input) {
    try {
      const text = await navigator.clipboard.readText();
      if (text) input.value = text.trim();
    } catch {
      setFeedback("Couldn't read clipboard - paste manually with Ctrl+V.", "bad");
    }
  }
  document.getElementById("pasteRelayUrl").addEventListener("click", () => pasteInto(relayUrlEl));
  document.getElementById("pasteApiKey").addEventListener("click", () => pasteInto(apiKeyEl));
  document.getElementById("toggleApiKey").addEventListener("click", () => {
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
  setInterval(refreshStatus, 2e3);
})();
//# sourceMappingURL=panel.js.map
