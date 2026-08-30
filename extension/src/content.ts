import type { AXNode, ElementTarget, Op } from "@browser-control/shared";

// Per-frame, per-page-load index of elements handed out by the last READ_TREE
// call. "aiIndex" targeting resolves through this map, so it only survives
// until the next READ_TREE - which is the point: a stale index should fail
// loudly rather than silently clicking the wrong (recycled) element.
let lastIndexMap = new Map<number, Element>();
let nextIndex = 0;

const INTERACTIVE_TAGS = new Set(["A", "BUTTON", "INPUT", "TEXTAREA", "SELECT"]);
const MAX_NODES = 1500;

function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
  return true;
}

function accessibleName(el: Element): string {
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

  // Direct text content only (not descendants' text re-counted many times
  // as we walk up the tree) - good enough for buttons/links/labels/bubbles.
  const direct = Array.from(el.childNodes)
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent?.trim() ?? "")
    .join(" ")
    .trim();
  if (direct) return direct;

  return el.textContent?.trim().slice(0, 200) ?? "";
}

function computedRole(el: Element): string {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit;

  const tag = el.tagName.toLowerCase();
  if (tag === "a" && el.hasAttribute("href")) return "link";
  if (tag === "button") return "button";
  if (tag === "input") {
    const type = (el as HTMLInputElement).type;
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

function isInterestingLeaf(el: Element): boolean {
  if (INTERACTIVE_TAGS.has(el.tagName)) return true;
  if (el.hasAttribute("role") || el.hasAttribute("contenteditable")) return true;
  // A leaf-ish node with meaningful direct text (chat bubbles, paragraphs,
  // list items) - this is what makes "summarize this chat" possible: the
  // agent needs message text, not just interactive controls.
  const hasElementChildren = Array.from(el.children).some((c) => !isSkippable(c));
  if (!hasElementChildren) {
    const text = el.textContent?.trim() ?? "";
    if (text.length > 0 && text.length < 2000) return true;
  }
  return false;
}

function isSkippable(el: Element): boolean {
  return ["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "PATH", "LINK", "META"].includes(el.tagName);
}

function buildTree(root: Element, depth = 0): AXNode | null {
  if (isSkippable(root)) return null;
  if (nextIndex >= MAX_NODES) return null;

  const visible = isVisible(root);
  const interesting = isInterestingLeaf(root);

  const children: AXNode[] = [];
  if (!interesting || root.children.length === 0) {
    for (const child of Array.from(root.children)) {
      const node = buildTree(child, depth + 1);
      if (node) children.push(node);
    }
  }

  // Skip uninteresting wrapper divs with no interesting descendants and no
  // useful text of their own - keeps the tree from being 90% <div> noise.
  if (!interesting && children.length === 0) return null;

  const index = nextIndex++;
  lastIndexMap.set(index, root);

  const rect = root.getBoundingClientRect();
  const node: AXNode = {
    aiIndex: index,
    role: computedRole(root),
    name: accessibleName(root),
    visible,
    box: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
  };
  if (root instanceof HTMLInputElement || root instanceof HTMLTextAreaElement) {
    node.value = root.value;
  }
  if (children.length > 0) node.children = children;
  return node;
}

function readTree() {
  lastIndexMap = new Map();
  nextIndex = 0;
  const tree = buildTree(document.body) ?? {
    aiIndex: -1,
    role: "document",
    name: document.title,
    visible: true,
  };
  return { url: location.href, title: document.title, tree };
}

function resolveTarget(target: ElementTarget): Element | null {
  switch (target.strategy) {
    case "css":
      return document.querySelector(target.value);
    case "xpath": {
      const result = document.evaluate(target.value, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      return (result.singleNodeValue as Element) ?? null;
    }
    case "aiIndex": {
      const idx = Number(target.value);
      return lastIndexMap.get(idx) ?? null;
    }
    case "role": {
      const all = Array.from(document.querySelectorAll<HTMLElement>("*"));
      return all.find((el) => computedRole(el) === target.value && isVisible(el)) ?? null;
    }
    case "text": {
      const needle = target.value.trim().toLowerCase();
      const candidates = Array.from(document.querySelectorAll<HTMLElement>("a, button, [role], input, textarea, label, li, span, div, p"));
      let best: HTMLElement | null = null;
      for (const el of candidates) {
        const text = (el.textContent ?? "").trim().toLowerCase();
        if (text === needle || (text.includes(needle) && needle.length > 2)) {
          if (!best || el.textContent!.length < best.textContent!.length) best = el;
        }
      }
      return best;
    }
  }
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

function dispatchPointerSequence(el: Element, type: "click" | "hover") {
  const rect = el.getBoundingClientRect();
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  const opts: PointerEventInit = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };

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
  (el as HTMLElement).focus?.();
  el.dispatchEvent(new PointerEvent("pointerup", opts));
  el.dispatchEvent(new MouseEvent("mouseup", opts));
  el.dispatchEvent(new MouseEvent("click", opts));
}

function typeInto(el: Element, text: string, clearFirst?: boolean) {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus();
    const nextValue = clearFirst ? text : el.value + text;
    setNativeValue(el, nextValue);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  if (el.hasAttribute("contenteditable")) {
    (el as HTMLElement).focus();
    if (clearFirst) document.execCommand("selectAll", false);
    const inserted = document.execCommand("insertText", false, text);
    if (!inserted) {
      // execCommand can be unsupported/disabled - fall back to a direct
      // text-node append plus an input event so most editors still notice.
      el.appendChild(document.createTextNode(text));
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
    return;
  }
  throw new Error("target is not a text input, textarea, or contenteditable element");
}

async function waitForSelector(target: ElementTarget, timeoutMs: number): Promise<Element> {
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

function extract(schema: Record<string, string>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [field, selector] of Object.entries(schema)) {
    out[field] = Array.from(document.querySelectorAll(selector)).map((el) => (el.textContent ?? "").trim());
  }
  return out;
}

async function execute(op: Op): Promise<unknown> {
  switch (op.op) {
    case "READ_TREE":
      return readTree();

    case "CLICK": {
      const el = resolveTarget(op.target);
      if (!el) throw new Error(`no element matched target ${JSON.stringify(op.target)}`);
      el.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
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
      el.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
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
      const el = op.target ? resolveTarget(op.target) : (document.activeElement ?? document.body);
      if (!el) throw new Error("no element to send key to");
      const opts: KeyboardEventInit = { bubbles: true, cancelable: true, key: op.key };
      el.dispatchEvent(new KeyboardEvent("keydown", opts));
      el.dispatchEvent(new KeyboardEvent("keyup", opts));
      return { pressed: true };
    }

    case "WAIT_FOR_SELECTOR": {
      await waitForSelector(op.target, op.timeoutMs ?? 5000);
      return { found: true };
    }

    case "EXTRACT":
      return extract(op.schema);

    default:
      throw new Error(`op ${(op as Op).op} is not handled by the content script`);
  }
}

chrome.runtime.onMessage.addListener((message: { op: Op }, _sender, sendResponse) => {
  execute(message.op)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err: Error) => sendResponse({ ok: false, error: err.message }));
  return true; // keep the message channel open for the async response
});
