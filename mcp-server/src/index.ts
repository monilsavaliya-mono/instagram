#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { InstructionResult, Op } from "@browser-control/shared";

const RELAY_URL = process.env.BROWSER_RELAY_URL;
const API_KEY = process.env.BROWSER_API_KEY;

if (!RELAY_URL || !API_KEY) {
  console.error("Set BROWSER_RELAY_URL and BROWSER_API_KEY environment variables before starting this MCP server.");
  process.exit(1);
}

const targetShape = {
  strategy: z
    .enum(["css", "xpath", "text", "role", "aiIndex"])
    .describe('How to find the element. Prefer "aiIndex" using the index from the most recent browse_read_tree call.'),
  value: z.string(),
};

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

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function errorResult(err: unknown) {
  return {
    content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
    isError: true,
  };
}

const server = new McpServer({ name: "browser-control", version: "0.1.0" });

server.registerTool(
  "browse_read_tree",
  {
    description:
      "Read the current page as a simplified tree of interactable elements and text content (chat messages, buttons, links, form fields), each with a stable aiIndex. Call this first on any new page, and again after any action that might have changed the page.",
  },
  async () => {
    try {
      return textResult(await callOp({ op: "READ_TREE" }));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "browse_click",
  { description: "Click an element on the page (buttons, links, checkboxes, etc.).", inputSchema: { target: z.object(targetShape) } },
  async ({ target }) => {
    try {
      return textResult(await callOp({ op: "CLICK", target }));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "browse_hover",
  { description: "Hover over an element - for menus or tooltips that only appear on hover.", inputSchema: { target: z.object(targetShape) } },
  async ({ target }) => {
    try {
      return textResult(await callOp({ op: "HOVER", target }));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "browse_scroll_into_view",
  {
    description:
      "Scroll an element into view without clicking it. Use this to page through chat history that lazy-loads older messages on scroll, then call browse_read_tree or browse_extract again.",
    inputSchema: { target: z.object(targetShape) },
  },
  async ({ target }) => {
    try {
      return textResult(await callOp({ op: "SCROLL_INTO_VIEW", target }));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "browse_type",
  {
    description: "Type text into an input, textarea, or contenteditable element.",
    inputSchema: {
      target: z.object(targetShape),
      text: z.string(),
      clearFirst: z.boolean().optional().describe("Clear the field's existing content before typing."),
    },
  },
  async ({ target, text, clearFirst }) => {
    try {
      return textResult(await callOp({ op: "TYPE", target, text, clearFirst }));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "browse_select_option",
  {
    description: "Select an option in a native <select> dropdown by its value.",
    inputSchema: { target: z.object(targetShape), value: z.string() },
  },
  async ({ target, value }) => {
    try {
      return textResult(await callOp({ op: "SELECT_OPTION", target, value }));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "browse_key_press",
  {
    description: 'Send a single key press (e.g. "Enter", "Escape") to an element, or the focused element if no target is given.',
    inputSchema: { key: z.string(), target: z.object(targetShape).optional() },
  },
  async ({ key, target }) => {
    try {
      return textResult(await callOp({ op: "KEY_PRESS", key, target }));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "browse_navigate",
  { description: "Navigate the active tab to a URL and wait for the page to finish loading.", inputSchema: { url: z.string() } },
  async ({ url }) => {
    try {
      return textResult(await callOp({ op: "NAVIGATE", url }, 25000));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "browse_wait_for_selector",
  {
    description: "Wait until an element matching the target appears and is visible.",
    inputSchema: { target: z.object(targetShape), timeoutMs: z.number().optional() },
  },
  async ({ target, timeoutMs }) => {
    try {
      return textResult(await callOp({ op: "WAIT_FOR_SELECTOR", target, timeoutMs }, (timeoutMs ?? 5000) + 2000));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "browse_extract",
  {
    description:
      'Extract structured text from the page. Pass field name -> CSS selector; each field returns an array of every matching element\'s text (e.g. {"messages": ".chat-message"} returns every chat bubble). Prefer this over browse_read_tree when you specifically need bulk text like chat history.',
    inputSchema: { schema: z.record(z.string(), z.string()) },
  },
  async ({ schema }) => {
    try {
      return textResult(await callOp({ op: "EXTRACT", schema }));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "browse_eval",
  {
    description:
      'Run arbitrary JavaScript in the page\'s own context and return the result. The extension may have this disabled by default ("Allow EVAL" setting) - expect a clear error if so.',
    inputSchema: { code: z.string() },
  },
  async ({ code }) => {
    try {
      return textResult(await callOp({ op: "EVAL", code }));
    } catch (err) {
      return errorResult(err);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("browser-control MCP server running on stdio");
