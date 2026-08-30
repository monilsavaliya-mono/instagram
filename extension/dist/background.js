"use strict";
(() => {
  // src/background.ts
  var socket = null;
  var reconnectDelayMs = 1e3;
  var MAX_RECONNECT_DELAY_MS = 3e4;
  async function getConfig() {
    const stored = await chrome.storage.local.get(["relayUrl", "apiKey", "allowEval"]);
    if (!stored.relayUrl || !stored.apiKey) return null;
    return { relayUrl: stored.relayUrl, apiKey: stored.apiKey, allowEval: !!stored.allowEval };
  }
  function setBadge(state) {
    const map = {
      connected: { text: "ON", color: "#1f9d55" },
      disconnected: { text: "OFF", color: "#d94f4f" },
      unconfigured: { text: "?", color: "#c98a12" }
    };
    const { text, color } = map[state];
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color });
  }
  async function connect() {
    const config = await getConfig();
    if (!config) {
      setBadge("unconfigured");
      return;
    }
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const wsUrl = config.relayUrl.replace(/^http/, "ws").replace(/\/+$/, "") + `/connect?key=${encodeURIComponent(config.apiKey)}`;
    const ws = new WebSocket(wsUrl);
    socket = ws;
    ws.addEventListener("open", () => {
      reconnectDelayMs = 1e3;
      setBadge("connected");
      const hello = { type: "hello", extensionVersion: chrome.runtime.getManifest().version };
      ws.send(JSON.stringify(hello));
    });
    ws.addEventListener("message", (event) => {
      void handleRelayMessage(event.data);
    });
    ws.addEventListener("close", () => {
      if (socket === ws) socket = null;
      setBadge("disconnected");
      scheduleReconnect();
    });
    ws.addEventListener("error", () => {
    });
  }
  function scheduleReconnect() {
    setTimeout(() => {
      void connect();
    }, reconnectDelayMs);
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
  }
  async function handleRelayMessage(data) {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.type === "ping") return;
    if (msg.type !== "instruction") return;
    const result = await runInstruction(msg.instruction);
    if (socket && socket.readyState === WebSocket.OPEN) {
      const reply = { type: "result", result };
      socket.send(JSON.stringify(reply));
    }
  }
  async function resolveTabId(tabId) {
    if (typeof tabId === "number") return tabId;
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) throw new Error('no active tab found to target (tabId: "auto")');
    return tab.id;
  }
  async function runInstruction(instruction) {
    const { id, payload, frameId } = instruction;
    try {
      const tabId = await resolveTabId(instruction.tabId);
      const data = await runOp(tabId, frameId ?? 0, payload);
      return { id, ok: true, data };
    } catch (err) {
      return { id, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  async function runOp(tabId, frameId, op) {
    switch (op.op) {
      case "NAVIGATE":
        return navigateAndWait(tabId, op.url);
      case "SCREENSHOT": {
        const dataUrl = await chrome.tabs.captureVisibleTab({ format: "png" });
        return { dataUrl };
      }
      case "EVAL": {
        const config = await getConfig();
        if (!config?.allowEval) {
          throw new Error('EVAL is disabled - enable "Allow EVAL" in the extension options to permit arbitrary JS execution');
        }
        const [injection] = await chrome.scripting.executeScript({
          target: { tabId, frameIds: [frameId] },
          world: "MAIN",
          func: (code) => {
            return (0, eval)(code);
          },
          args: [op.code]
        });
        return injection?.result;
      }
      default:
        return sendToContentScript(tabId, frameId, op);
    }
  }
  function navigateAndWait(tabId, url) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error("NAVIGATE timed out waiting for page load"));
      }, 2e4);
      function listener(updatedTabId, info) {
        if (updatedTabId === tabId && info.status === "complete") {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve({ navigated: true });
        }
      }
      chrome.tabs.onUpdated.addListener(listener);
      chrome.tabs.update(tabId, { url }).catch((err) => {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        reject(err);
      });
    });
  }
  function sendToContentScript(tabId, frameId, op) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { op }, { frameId }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message ?? "content script did not respond (page may not be loaded, or is a restricted chrome:// page)"));
          return;
        }
        if (!response) {
          reject(new Error("no response from content script"));
          return;
        }
        if (!response.ok) {
          reject(new Error(response.error ?? "content script reported an error"));
          return;
        }
        resolve(response.data);
      });
    });
  }
  chrome.alarms.create("keepalive", { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "keepalive") void connect();
  });
  chrome.runtime.onInstalled.addListener(() => void connect());
  chrome.runtime.onStartup.addListener(() => void connect());
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.relayUrl || changes.apiKey) {
      if (socket) socket.close();
      void connect();
    }
  });
  void connect();
})();
//# sourceMappingURL=background.js.map
