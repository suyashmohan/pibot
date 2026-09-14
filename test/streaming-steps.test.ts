/**
 * Streaming-step stability regression.
 *
 * Reported bug: while the agent works, the *active* step (thinking/reasoning/
 * tool card/text) blinks; finished steps are fine. Cause: `usePiSession`
 * rebuilds the assistant draft on every streamed delta with a fresh
 * `Date.now()` timestamp, and the transcript keyed rows by index+timestamp —
 * so every token remounted the row, replaying the `.fade-up` animation (the
 * blink) and resetting expanded thinking/tool state.
 *
 * These tests render the real transcript component in a mobile-sized happy-dom
 * and re-render it the way the hook does for each delta: a brand-new message
 * object with a new timestamp. The row must keep its DOM identity.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { act, createElement } from "react";
import type { createRoot } from "react-dom/client";
import { loadReactDom } from "./helpers/dom";
import { Window } from "happy-dom";
import { MessageList, messageKey } from "@/components/MessageList";
import { streamingAssistantMessage } from "@/lib/pi/types";

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const DOM_GLOBALS = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "Text",
  "Comment",
  "DocumentFragment",
  "Event",
  "CustomEvent",
  "MouseEvent",
  "PointerEvent",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
];

function clearDomGlobals(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  for (const k of DOM_GLOBALS) delete g[k];
}

function installDom(): Window {
  const win = new Window({ width: 390, height: 844, url: "http://localhost:3000/" });
  const g = globalThis as unknown as Record<string, unknown>;
  const w = win as unknown as Record<string, unknown>;
  g.window = win;
  for (const k of DOM_GLOBALS) g[k] = w[k];
  return win;
}

const USER = { role: "user", content: "hi", timestamp: 1 };

/** One transcript render, exactly as the hook would produce it for a delta. */
function tree(draft: ReturnType<typeof streamingAssistantMessage>) {
  return createElement(MessageList, {
    messages: [USER as never, draft as never],
    toolResults: new Map(),
    toolLive: {},
    streaming: true,
  });
}

async function mount(doc: Document, node: ReturnType<typeof tree>) {
  const container = doc.createElement("div");
  doc.body.appendChild(container);
  let root: ReturnType<typeof createRoot> | null = null;
  const reactDom = await loadReactDom();
  await act(async () => {
    root = reactDom.createRoot(container as unknown as Element);
    root.render(node as never);
  });
  return root as unknown as ReturnType<typeof createRoot>;
}

let activeWin: Window | null = null;

afterEach(async () => {
  try {
    await activeWin?.happyDOM?.close?.();
  } catch {
    /* ignore */
  }
  activeWin = null;
  clearDomGlobals();
});

describe("active streaming step", () => {
  test("keeps its DOM node (and .fade-up animation) while deltas stream in", async () => {
    clearDomGlobals();
    const win = installDom();
    activeWin = win;
    const doc = win.document as unknown as Document;

    // Direct mechanism check: the draft's key must not move with its timestamp.
    const first = streamingAssistantMessage([{ type: "text", text: "he" }], 1_000);
    const later = streamingAssistantMessage([{ type: "text", text: "hello world" }], 2_000);
    expect(messageKey(first as never, 1)).toBe(messageKey(later as never, 1));

    const root = await mount(doc, tree(first));

    const activeRow = doc.querySelectorAll(".fade-up")[1];
    expect(activeRow).toBeDefined();
    expect(activeRow.textContent).toContain("he");

    await act(async () => {
      root.render(tree(later) as never);
    });

    const activeRowAfter = doc.querySelectorAll(".fade-up")[1];
    expect(activeRowAfter).toBe(activeRow); // same DOM node → no fade-up replay
    expect(activeRowAfter.textContent).toContain("hello world");

    await act(async () => {
      root.unmount();
    });
  });

  test("an expanded reasoning step survives deltas", async () => {
    clearDomGlobals();
    const win = installDom();
    activeWin = win;
    const doc = win.document as unknown as Document;

    const first = streamingAssistantMessage([{ type: "thinking", thinking: "first thought" }], 1_000);
    const later = streamingAssistantMessage(
      [{ type: "thinking", thinking: "first thought, and more" }],
      2_000,
    );

    const root = await mount(doc, tree(first));

    const toggle = doc.querySelector("button[aria-expanded]");
    expect(toggle).not.toBeNull();
    await act(async () => {
      (toggle as unknown as HTMLElement).click();
    });
    expect(toggle!.getAttribute("aria-expanded")).toBe("true");
    expect(toggle!.parentElement?.querySelector("div.border-t")).not.toBeNull();

    await act(async () => {
      root.render(tree(later) as never);
    });

    const toggleAfter = doc.querySelector("button[aria-expanded]");
    expect(toggleAfter).toBe(toggle); // a remount would collapse the step
    expect(toggleAfter!.getAttribute("aria-expanded")).toBe("true");
    expect(toggleAfter!.parentElement?.querySelector("div.border-t")).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
  });
});
