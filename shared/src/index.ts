/**
 * The instruction set (ISA) shared by all three layers:
 *   - extension  (executes these against a real page)
 *   - relay      (routes these between callers and the extension, opaque payload)
 *   - agent      (a Claude tool-use loop that emits these)
 *
 * Keeping this in one package means the wire format can only drift in one
 * place, and the agent's tool schemas can be derived from the same types
 * the extension implements against.
 */

export type TargetStrategy = "css" | "xpath" | "text" | "role" | "aiIndex";

/** How to locate an element. `aiIndex` refers to the stable per-session index
 * assigned by the last READ_TREE call - the cheapest and most reliable way
 * for an LLM caller to reference "the button I just saw at index 14". */
export interface ElementTarget {
  strategy: TargetStrategy;
  value: string;
}

export type Op =
  | { op: "READ_TREE" }
  | { op: "CLICK"; target: ElementTarget }
  | { op: "HOVER"; target: ElementTarget }
  | { op: "SCROLL_INTO_VIEW"; target: ElementTarget }
  | { op: "TYPE"; target: ElementTarget; text: string; clearFirst?: boolean }
  | { op: "SELECT_OPTION"; target: ElementTarget; value: string }
  | { op: "KEY_PRESS"; target?: ElementTarget; key: string }
  | { op: "NAVIGATE"; url: string }
  | { op: "WAIT_FOR_SELECTOR"; target: ElementTarget; timeoutMs?: number }
  | { op: "EXTRACT"; schema: Record<string, string> }
  | { op: "SCREENSHOT" }
  /** Runs in the page's own MAIN world. Highest-risk op - gate this one. */
  | { op: "EVAL"; code: string };

export type OpName = Op["op"];

/** Envelope wrapping every instruction sent over the relay -> extension link. */
export interface Instruction {
  id: string;
  /** "auto" = whatever tab the extension currently considers active. */
  tabId?: "auto" | number;
  frameId?: number;
  timeoutMs?: number;
  payload: Op;
}

/** One node in the simplified accessibility-style tree returned by READ_TREE.
 * This is what the agent reasons over instead of raw HTML - far fewer tokens,
 * and every interactable node carries a stable `aiIndex` for later targeting. */
export interface AXNode {
  aiIndex: number;
  role: string;
  name: string;
  value?: string;
  visible: boolean;
  box?: { x: number; y: number; w: number; h: number };
  children?: AXNode[];
}

export interface ReadTreeResult {
  url: string;
  title: string;
  tree: AXNode;
}

export interface InstructionResult {
  id: string;
  ok: boolean;
  error?: string;
  data?: unknown;
}

/** Messages sent extension -> relay over the persistent WebSocket. */
export type ExtensionToRelayMessage =
  | { type: "hello"; extensionVersion: string }
  | { type: "result"; result: InstructionResult };

/** Messages sent relay -> extension over the same socket. */
export type RelayToExtensionMessage =
  | { type: "instruction"; instruction: Instruction }
  | { type: "ping" };
