"use strict";
(() => {
  // src/content.ts
  var lastIndexMap = /* @__PURE__ */ new Map();
  var nextIndex = 0;
  var INTERACTIVE_TAGS = /* @__PURE__ */ new Set(["A", "BUTTON", "INPUT", "TEXTAREA", "SELECT"]);
  var MAX_NODES = 1500;
  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    return true;
  }
  function accessibleName(el) {
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel.trim();
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl?.textContent) return labelEl.textContent.trim();
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (el.labels && el.labels.length > 0) return el.labels[0].textContent?.trim() ?? "";
      if (el.placeholder) return el.placeholder;
    }
    const alt = el.getAttribute("alt");
    if (alt) return alt.trim();
    const title = el.getAttribute("title");
    if (title) return title.trim();
    const direct = Array.from(el.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent?.trim() ?? "").join(" ").trim();
    if (direct) return direct;
    return el.textContent?.trim().slice(0, 200) ?? "";
  }
  function computedRole(el) {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "a" && el.hasAttribute("href")) return "link";
    if (tag === "button") return "button";
    if (tag === "input") {
      const type = el.type;
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "submit" || type === "button") return "button";
      return "textbox";
    }
    if (tag === "textarea") return "textbox";
    if (tag === "select") return "combobox";
    if (el.hasAttribute("contenteditable")) return "textbox";
    if (/^h[1-6]$/.test(tag)) return "heading";
    return "text";
  }
  function isInterestingLeaf(el) {
    if (INTERACTIVE_TAGS.has(el.tagName)) return true;
    if (el.hasAttribute("role") || el.hasAttribute("contenteditable")) return true;
    const hasElementChildren = Array.from(el.children).some((c) => !isSkippable(c));
    if (!hasElementChildren) {
      const text = el.textContent?.trim() ?? "";
      if (text.length > 0 && text.length < 2e3) return true;
    }
    return false;
  }
  function isSkippable(el) {
    return ["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "PATH", "LINK", "META"].includes(el.tagName);
  }
  function buildTree(root, depth = 0) {
    if (isSkippable(root)) return null;
    if (nextIndex >= MAX_NODES) return null;
    const visible = isVisible(root);
    const interesting = isInterestingLeaf(root);
    const children = [];
    if (!interesting || root.children.length === 0) {
      for (const child of Array.from(root.children)) {
        const node2 = buildTree(child, depth + 1);
        if (node2) children.push(node2);
      }
    }
    if (!interesting && children.length === 0) return null;
    const index = nextIndex++;
    lastIndexMap.set(index, root);
    const rect = root.getBoundingClientRect();
    const node = {
      aiIndex: index,
      role: computedRole(root),
      name: accessibleName(root),
      visible,
      box: { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
    };
    if (root instanceof HTMLInputElement || root instanceof HTMLTextAreaElement) {
      node.value = root.value;
    }
    if (children.length > 0) node.children = children;
    return node;
  }
  function readTree() {
    lastIndexMap = /* @__PURE__ */ new Map();
    nextIndex = 0;
    const tree = buildTree(document.body) ?? {
      aiIndex: -1,
      role: "document",
      name: document.title,
      visible: true
    };
    return { url: location.href, title: document.title, tree };
  }
  function resolveTarget(target) {
    switch (target.strategy) {
      case "css":
        return document.querySelector(target.value);
      case "xpath": {
        const result = document.evaluate(target.value, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        return result.singleNodeValue ?? null;
      }
      case "aiIndex": {
        const idx = Number(target.value);
        return lastIndexMap.get(idx) ?? null;
      }
      case "role": {
        const all = Array.from(document.querySelectorAll("*"));
        return all.find((el) => computedRole(el) === target.value && isVisible(el)) ?? null;
      }
      case "text": {
        const needle = target.value.trim().toLowerCase();
        const candidates = Array.from(document.querySelectorAll("a, button, [role], input, textarea, label, li, span, div, p"));
        let best = null;
        for (const el of candidates) {
          const text = (el.textContent ?? "").trim().toLowerCase();
          if (text === needle || text.includes(needle) && needle.length > 2) {
            if (!best || el.textContent.length < best.textContent.length) best = el;
          }
        }
        return best;
      }
    }
  }
  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  }
  function dispatchPointerSequence(el, type) {
    const rect = el.getBoundingClientRect();
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
    if (type === "hover") {
      el.dispatchEvent(new PointerEvent("pointerover", opts));
      el.dispatchEvent(new PointerEvent("pointerenter", opts));
      el.dispatchEvent(new MouseEvent("mouseover", opts));
      el.dispatchEvent(new MouseEvent("mouseenter", opts));
      el.dispatchEvent(new MouseEvent("mousemove", opts));
      return;
    }
    el.dispatchEvent(new PointerEvent("pointerdown", opts));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.focus?.();
    el.dispatchEvent(new PointerEvent("pointerup", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", opts));
  }
  function typeInto(el, text, clearFirst) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.focus();
      const nextValue = clearFirst ? text : el.value + text;
      setNativeValue(el, nextValue);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    if (el.hasAttribute("contenteditable")) {
      el.focus();
      if (clearFirst) document.execCommand("selectAll", false);
      const inserted = document.execCommand("insertText", false, text);
      if (!inserted) {
        el.appendChild(document.createTextNode(text));
        el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      }
      return;
    }
    throw new Error("target is not a text input, textarea, or contenteditable element");
  }
  async function waitForSelector(target, timeoutMs) {
    const existing = resolveTarget(target);
    if (existing && isVisible(existing)) return existing;
    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        const el = resolveTarget(target);
        if (el && isVisible(el)) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(el);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`WAIT_FOR_SELECTOR timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }
  function extract(schema) {
    const out = {};
    for (const [field, selector] of Object.entries(schema)) {
      out[field] = Array.from(document.querySelectorAll(selector)).map((el) => (el.textContent ?? "").trim());
    }
    return out;
  }
  async function execute(op) {
    switch (op.op) {
      case "READ_TREE":
        return readTree();
      case "CLICK": {
        const el = resolveTarget(op.target);
        if (!el) throw new Error(`no element matched target ${JSON.stringify(op.target)}`);
        el.scrollIntoView({ block: "center", behavior: "instant" });
        dispatchPointerSequence(el, "click");
        return { clicked: true };
      }
      case "HOVER": {
        const el = resolveTarget(op.target);
        if (!el) throw new Error(`no element matched target ${JSON.stringify(op.target)}`);
        dispatchPointerSequence(el, "hover");
        return { hovered: true };
      }
      case "SCROLL_INTO_VIEW": {
        const el = resolveTarget(op.target);
        if (!el) throw new Error(`no element matched target ${JSON.stringify(op.target)}`);
        el.scrollIntoView({ block: "center", behavior: "instant" });
        return { scrolled: true };
      }
      case "TYPE": {
        const el = resolveTarget(op.target);
        if (!el) throw new Error(`no element matched target ${JSON.stringify(op.target)}`);
        typeInto(el, op.text, op.clearFirst);
        return { typed: true };
      }
      case "SELECT_OPTION": {
        const el = resolveTarget(op.target);
        if (!el || !(el instanceof HTMLSelectElement)) throw new Error("target is not a <select> element");
        el.value = op.value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { selected: true };
      }
      case "KEY_PRESS": {
        const el = op.target ? resolveTarget(op.target) : document.activeElement ?? document.body;
        if (!el) throw new Error("no element to send key to");
        const opts = { bubbles: true, cancelable: true, key: op.key };
        el.dispatchEvent(new KeyboardEvent("keydown", opts));
        el.dispatchEvent(new KeyboardEvent("keyup", opts));
        return { pressed: true };
      }
      case "WAIT_FOR_SELECTOR": {
        await waitForSelector(op.target, op.timeoutMs ?? 5e3);
        return { found: true };
      }
      case "EXTRACT":
        return extract(op.schema);
      default:
        throw new Error(`op ${op.op} is not handled by the content script`);
    }
  }
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    execute(message.op).then((data) => sendResponse({ ok: true, data })).catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  });
})();
//# sourceMappingURL=content.js.map
