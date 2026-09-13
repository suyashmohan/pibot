/**
 * Composer slash-command menu — real DOM interaction tests.
 *
 * These mount the actual component in happy-dom (createRoot + act) and drive
 * it with native input/keydown/click events, so the keyboard contract cannot
 * silently regress: `/` opens the menu, arrows navigate, Enter/Tab pick a
 * command *without sending*, and a custom message typed after the picked
 * command is sent together with it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { Window } from "happy-dom";
import type { SlashCommand } from "@/lib/slash-commands";

// react-dom/client must NOT be imported at module load: it feature-detects
// `window`/`document` once and, without a DOM, silently switches to legacy
// input polyfills (onChange/onKeyDown never fire on form controls). Mount
// helpers therefore import it *after* happy-dom globals exist.

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const DOM_GLOBALS = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLDivElement",
  "HTMLTextAreaElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "Element",
  "Node",
  "Text",
  "Comment",
  "DocumentFragment",
  "Event",
  "CustomEvent",
  "MouseEvent",
  "KeyboardEvent",
  "InputEvent",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
];

function clearDomGlobals(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  for (const k of DOM_GLOBALS) delete g[k];
}

function installDom(): Window {
  const win = new Window({ width: 1024, height: 768, url: "http://localhost:3000/" });
  const g = globalThis as unknown as Record<string, unknown>;
  const w = win as unknown as Record<string, unknown>;
  for (const k of DOM_GLOBALS) g[k] = k === "window" ? win : k === "document" ? w.document : k === "navigator" ? w.navigator : w[k];
  return win;
}

const COMMANDS: SlashCommand[] = [
  { name: "compact", description: "Compact the context", source: "extension" },
  { name: "model", description: "Switch the active model", source: "prompt" },
  { name: "review", description: "Review changes with compact output", source: "skill" },
];

interface Harness {
  win: Window;
  container: HTMLElement;
  sent: string[];
  type: (el: HTMLTextAreaElement, value: string) => Promise<void>;
  keydown: (el: Element, key: string) => Promise<void>;
  dispose: () => Promise<void>;
}

async function mount(commands: SlashCommand[] = COMMANDS): Promise<Harness> {
  const win = installDom();
  const container = win.document.createElement("div");
  win.document.body.appendChild(container);
  const { createRoot } = await import("react-dom/client");
  const { Composer } = await import("@/components/Composer");
  const sent: string[] = [];
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(container as unknown as Element);
    root.render(
      createElement(Composer, {
        streaming: false,
        compacting: false,
        queueCounts: { steering: 0, followUp: 0 },
        commands,
        onSend: (t: string) => {
          sent.push(t);
        },
        onAbort: () => {},
      }),
    );
  });

  const type = async (el: HTMLTextAreaElement, value: string) => {
    await act(async () => {
      const desc = Object.getOwnPropertyDescriptor(
        win.HTMLTextAreaElement.prototype as unknown as object,
        "value",
      );
      if (desc?.set) desc.set.call(el, value);
      else el.value = value;
      el.dispatchEvent(new win.Event("input", { bubbles: true }) as unknown as Event);
    });
  };

  const keydown = async (el: Element, key: string) => {
    await act(async () => {
      el.dispatchEvent(new win.KeyboardEvent("keydown", { key, bubbles: true }) as unknown as Event);
    });
  };

  return {
    win,
    container: container as unknown as HTMLElement,
    sent,
    type,
    keydown,
    dispose: async () => {
      await act(async () => {
        root?.unmount();
      });
      try {
        await win.happyDOM.close();
      } catch {
        /* ignore */
      }
      clearDomGlobals();
    },
  };
}

function textareaOf(container: HTMLElement): HTMLTextAreaElement {
  const el = container.querySelector("textarea");
  if (!el) throw new Error("no textarea in composer");
  return el as HTMLTextAreaElement;
}

function menuOf(container: HTMLElement): Element | null {
  return container.querySelector('[role="listbox"]');
}

beforeEach(() => {
  clearDomGlobals();
});

afterEach(async () => {
  clearDomGlobals();
});

describe("Composer slash-command menu", () => {
  test("typing / opens the menu with every command and sends nothing", async () => {
    const h = await mount();
    try {
      const ta = textareaOf(h.container);
      await h.type(ta, "/");
      expect(menuOf(h.container)).not.toBeNull();
      const text = h.container.textContent ?? "";
      expect(text).toContain("/compact");
      expect(text).toContain("/model");
      expect(text).toContain("/review");
      expect(h.sent).toEqual([]);
    } finally {
      await h.dispose();
    }
  });

  test("typing filters the menu to matching names", async () => {
    const h = await mount();
    try {
      const ta = textareaOf(h.container);
      await h.type(ta, "/comp");
      const text = h.container.textContent ?? "";
      expect(text).toContain("/compact");
      expect(text).not.toContain("/model");
      expect(menuOf(h.container)).not.toBeNull();
    } finally {
      await h.dispose();
    }
  });

  test("Enter picks the top command, keeps the input open, then sends command + custom message", async () => {
    const h = await mount();
    try {
      const ta = textareaOf(h.container);
      await h.type(ta, "/comp");
      await h.keydown(ta, "Enter");
      expect(ta.value).toBe("/compact ");
      expect(menuOf(h.container)).toBeNull();
      expect(h.sent).toEqual([]); // picking is not sending

      await h.type(ta, "/compact focus on the API layer");
      await h.keydown(ta, "Enter");
      expect(h.sent).toEqual(["/compact focus on the API layer"]);
    } finally {
      await h.dispose();
    }
  });

  test("ArrowDown moves the selection and Tab accepts it", async () => {
    const h = await mount();
    try {
      const ta = textareaOf(h.container);
      await h.type(ta, "/co"); // matches compact (name) then review (description)
      await h.keydown(ta, "ArrowDown");
      await h.keydown(ta, "Tab");
      expect(ta.value).toBe("/review ");
      expect(h.sent).toEqual([]);
    } finally {
      await h.dispose();
    }
  });

  test("clicking a command inserts it without sending", async () => {
    const h = await mount();
    try {
      const ta = textareaOf(h.container);
      await h.type(ta, "/");
      const item = [...h.container.querySelectorAll("button")].find((b) =>
        (b.textContent ?? "").includes("/review"),
      );
      expect(item).toBeTruthy();
      await act(async () => {
        item!.dispatchEvent(new h.win.MouseEvent("click", { bubbles: true }) as unknown as Event);
      });
      expect(ta.value).toBe("/review ");
      expect(h.sent).toEqual([]);
    } finally {
      await h.dispose();
    }
  });

  test("Escape dismisses the menu and a later Enter sends the raw text", async () => {
    const h = await mount();
    try {
      const ta = textareaOf(h.container);
      await h.type(ta, "/co");
      await h.keydown(ta, "Escape");
      expect(menuOf(h.container)).toBeNull();
      await h.keydown(ta, "Enter");
      expect(h.sent).toEqual(["/co"]);
    } finally {
      await h.dispose();
    }
  });
});
