import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { InstructionResult, Op } from "@browser-control/shared";

const RELAY_URL = process.env.BROWSER_RELAY_URL;
const API_KEY = process.env.BROWSER_API_KEY;

if (!RELAY_URL || !API_KEY) {
  console.error("Set BROWSER_RELAY_URL and BROWSER_API_KEY environment variables first (see README).");
  process.exit(1);
}

const targetSchema = z.object({
  strategy: z
    .enum(["css", "xpath", "text", "role", "aiIndex"])
    .describe('How to find the element. Prefer "aiIndex" using the index from the most recent browse_read_tree call - it is the most reliable.'),
  value: z.string(),
});

async function callOp(op: Op, timeoutMs = 15000): Promise<unknown> {
  const res = await fetch(`${RELAY_URL}/v1/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ op, timeoutMs }),
  });
  const result = (await res.json()) as InstructionResult;
  if (!result.ok) throw new Error(result.error ?? `browser op ${op.op} failed`);
  return result.data;
}

const tools = [
  betaZodTool({
    name: "browse_read_tree",
    description:
      "Read the current page as a simplified tree of interactable elements and text content (chat messages, buttons, links, form fields), each with a stable aiIndex. Call this first on any new page, and again after any action that might have changed the page.",
    inputSchema: z.object({}),
    run: async () => JSON.stringify(await callOp({ op: "READ_TREE" })),
  }),
  betaZodTool({
    name: "browse_click",
    description: "Click an element on the page (buttons, links, checkboxes, etc.).",
    inputSchema: z.object({ target: targetSchema }),
    run: async (input) => JSON.stringify(await callOp({ op: "CLICK", target: input.target })),
  }),
  betaZodTool({
    name: "browse_hover",
    description: "Hover over an element - for menus or tooltips that only appear on hover.",
    inputSchema: z.object({ target: targetSchema }),
    run: async (input) => JSON.stringify(await callOp({ op: "HOVER", target: input.target })),
  }),
  betaZodTool({
    name: "browse_scroll_into_view",
    description:
      "Scroll an element into view without clicking it. Use this to page through chat history that lazy-loads older messages on scroll, then call browse_read_tree or browse_extract again.",
    inputSchema: z.object({ target: targetSchema }),
    run: async (input) => JSON.stringify(await callOp({ op: "SCROLL_INTO_VIEW", target: input.target })),
  }),
  betaZodTool({
    name: "browse_type",
    description: "Type text into an input, textarea, or contenteditable element.",
    inputSchema: z.object({
      target: targetSchema,
      text: z.string(),
      clearFirst: z.boolean().optional().describe("Clear the field's existing content before typing."),
    }),
    run: async (input) =>
      JSON.stringify(await callOp({ op: "TYPE", target: input.target, text: input.text, clearFirst: input.clearFirst })),
  }),
  betaZodTool({
    name: "browse_select_option",
    description: "Select an option in a native <select> dropdown by its value.",
    inputSchema: z.object({ target: targetSchema, value: z.string() }),
    run: async (input) => JSON.stringify(await callOp({ op: "SELECT_OPTION", target: input.target, value: input.value })),
  }),
  betaZodTool({
    name: "browse_key_press",
    description: 'Send a single key press (e.g. "Enter", "Escape") to an element, or the focused element if no target is given.',
    inputSchema: z.object({ key: z.string(), target: targetSchema.optional() }),
    run: async (input) => JSON.stringify(await callOp({ op: "KEY_PRESS", key: input.key, target: input.target })),
  }),
  betaZodTool({
    name: "browse_navigate",
    description: "Navigate the active tab to a URL and wait for the page to finish loading.",
    inputSchema: z.object({ url: z.string() }),
    run: async (input) => JSON.stringify(await callOp({ op: "NAVIGATE", url: input.url }, 25000)),
  }),
  betaZodTool({
    name: "browse_wait_for_selector",
    description: "Wait until an element matching the target appears and is visible.",
    inputSchema: z.object({ target: targetSchema, timeoutMs: z.number().optional() }),
    run: async (input) =>
      JSON.stringify(
        await callOp({ op: "WAIT_FOR_SELECTOR", target: input.target, timeoutMs: input.timeoutMs }, (input.timeoutMs ?? 5000) + 2000),
      ),
  }),
  betaZodTool({
    name: "browse_extract",
    description:
      'Extract structured text from the page. Pass field name -> CSS selector; each field returns an array of every matching element\'s text (e.g. {"messages": ".chat-message"} returns every chat bubble). Prefer this over browse_read_tree when you specifically need bulk text like chat history.',
    inputSchema: z.object({ schema: z.record(z.string(), z.string()) }),
    run: async (input) => JSON.stringify(await callOp({ op: "EXTRACT", schema: input.schema })),
  }),
  betaZodTool({
    name: "browse_eval",
    description:
      'Run arbitrary JavaScript in the page\'s own context and return the result. The extension may have this disabled by default ("Allow EVAL" setting) - expect a clear error if so. Prefer the other tools when they can do the job; this one is not gated for specific risky patterns, so use it deliberately.',
    inputSchema: z.object({ code: z.string() }),
    run: async (input) => JSON.stringify(await callOp({ op: "EVAL", code: input.code })),
  }),
];

async function main() {
  const task = process.argv.slice(2).join(" ").trim();
  if (!task) {
    console.error('Usage: npm run agent -- "open youtube and play believer by imagine dragons"');
    process.exit(1);
  }

  const client = new Anthropic();

  const finalMessage = await client.beta.messages.toolRunner({
    model: "claude-opus-5",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system:
      "You control a real browser tab through a small set of tools. Always call browse_read_tree first to see what is on the page before acting, and target elements by aiIndex from the most recent tree read rather than guessing selectors. Re-read the tree after any action that likely changed the page. If the task does not require the browser at all - answering a question, summarizing text already given to you - just answer directly without calling any browser tool.",
    tools,
    messages: [{ role: "user", content: task }],
  });

  for (const block of finalMessage.content) {
    if (block.type === "text") console.log(block.text);
  }
  if (finalMessage.stop_reason === "refusal") {
    console.error("Claude declined this task:", finalMessage.stop_details);
  }
}

main().catch((err) => {
  console.error("Agent failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
