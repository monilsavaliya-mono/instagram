const relayUrlEl = document.getElementById("relayUrl") as HTMLInputElement;
const apiKeyEl = document.getElementById("apiKey") as HTMLInputElement;
const allowEvalEl = document.getElementById("allowEval") as HTMLInputElement;
const saveBtn = document.getElementById("save") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;

function setStatus(text: string, kind: "ok" | "bad" | "warn") {
  statusEl.textContent = text;
  statusEl.className = kind;
}

async function load() {
  const stored = await chrome.storage.local.get(["relayUrl", "apiKey", "allowEval"]);
  relayUrlEl.value = stored.relayUrl ?? "";
  apiKeyEl.value = stored.apiKey ?? "";
  allowEvalEl.checked = !!stored.allowEval;
  if (stored.relayUrl && stored.apiKey) {
    setStatus("Configured. The background worker will (re)connect automatically.", "ok");
  } else {
    setStatus("Not configured yet - enter a relay URL and API key, then Save.", "warn");
  }
}

saveBtn.addEventListener("click", async () => {
  const relayUrl = relayUrlEl.value.trim();
  const apiKey = apiKeyEl.value.trim();
  if (!relayUrl || !apiKey) {
    setStatus("Both relay URL and API key are required.", "bad");
    return;
  }
  await chrome.storage.local.set({ relayUrl, apiKey, allowEval: allowEvalEl.checked });
  setStatus("Saved. Connecting to relay...", "ok");
});

void load();
