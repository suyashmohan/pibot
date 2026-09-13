/**
 * Composer `@` file-mention picker — real DOM interaction tests.
 *
 * Mounts the actual component in happy-dom against a stubbed session files
 * API and drives it with native events: `@` opens the picker at the project
 * root, folders navigate one level deeper, files complete to `@rel/path `,
 * and Escape cancels while leaving the `@` in place.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { Window } from "happy-dom";
import type { MentionEntry } from "@/lib/file-mentions";
import type { SlashCommand } from "@/lib/slash-commands";

// See composer-commands.test.ts: react-dom/client must be imported *after*
// happy-dom globals exist or it switches to legacy input polyfills.
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
  "Response",
  "Request",
  "Headers",
  "fetch",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
];

const savedGlobals = new Map<string, unknown>();

function installDom(): Window {
  const win = new Window({ width: 1024, height: 768, url: "http://localhost:3000/" });
  const g = globalThis as unknown as Record<string, unknown>;
  const w = win as unknown as Record<string, unknown>;
  for (const k of DOM_GLOBALS) {
    // Save-and-restore: Bun globals (Response, Headers, …) must survive for
    // other test files sharing this process.
    if (!savedGlobals.has(k)) savedGlobals.set(k, g[k]);
    g[k] = k === "window" ? win : k === "document" ? w.document : k === "navigator" ? w.navigator : w[k];
  }
  return win;
}

function restoreDom(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  for (const [k, v] of savedGlobals) {
    if (v === undefined) delete g[k];
    else g[k] = v;
  }
  savedGlobals.clear();
}

function clearDomGlobals(): void {
  restoreDom();
}

const TREE: Record<string, MentionEntry[]> = {
  "": [
    { name: "docs", type: "dir", path: "docs" },
    { name: "src", type: "dir", path: "src" },
    { name: "README.md", type: "file", path: "README.md" },
  ],
  src: [
    { name: "lib", type: "dir", path: "src/lib" },
    { name: "main.ts", type: "file", path: "src/main.ts" },
  ],
  "src/lib": [{ name: "utils.ts", type: "file", path: "src/lib/utils.ts" }],
  docs: [],
};

interface Harness {
  win: Window;
  container: HTMLElement;
  sent: string[];
  requestedDirs: string[];
  type: (el: HTMLTextAreaElement, value: string) => Promise<void>;
  keydown: (el: Element, key: string) => Promise<void>;
  click: (el: Element) => Promise<void>;
  settle: () => Promise<void>;
  dispose: () => Promise<void>;
}

async function mount(commands: SlashCommand[] = []): Promise<Harness> {
  const win = installDom();
  const g = globalThis as unknown as Record<string, unknown>;
  const requestedDirs: string[] = [];
  g.fetch = (async (input: unknown) => {
    const url = new URL(String((input as { url?: unknown })?.url ?? input), "http://localhost:3000");
    const dir = (url.searchParams.get("dir") ?? "").replace(/\/+$/, "");
    requestedDirs.push(dir);
    return new Response(
      JSON.stringify({
        ok: true,
        data: { cwd: "/tmp/proj", dir, entries: TREE[dir] ?? [] },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  g.IS_REACT_ACT_ENVIRONMENT = true;

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
        sessionId: "session-1",
        commands,
        onSend: (t: string) => {
          sent.push(t);
        },
        onAbort: () => {},
      }),
    );
  });

  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
  };

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
    await settle();
  };

  const keydown = async (el: Element, key: string) => {
    await act(async () => {
      el.dispatchEvent(new win.KeyboardEvent("keydown", { key, bubbles: true }) as unknown as Event);
    });
    await settle();
  };

  const click = async (el: Element) => {
    await act(async () => {
      el.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event);
    });
    await settle();
  };

  return {
    win,
    container: container as unknown as HTMLElement,
    sent,
    requestedDirs,
    type,
    keydown,
    click,
    settle,
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

function menuText(container: HTMLElement): string {
  return container.querySelector('[role="listbox"]')?.textContent ?? "";
}

function option(container: HTMLElement, path: string): Element {
  const el = container.querySelector(`[data-mention-path="${path}"]`);
  if (!el) throw new Error(`no mention option for ${path} in ${menuText(container)}`);
  return el;
}

beforeEach(() => {
  clearDomGlobals();
});

afterEach(() => {
  clearDomGlobals();
});

describe("Composer @ file mentions", () => {
  test("@ opens the picker at the project root with folders and files", async () => {
    const h = await mount();
    try {
      const ta = textareaOf(h.container);
      await h.type(ta, "look at @");
      expect(h.container.querySelector('[role="listbox"]')).not.toBeNull();
      const text = menuText(h.container);
      expect(text).toContain("src");
      expect(text).toContain("docs");
      expect(text).toContain("README.md");
      expect(h.requestedDirs).toContain("");
      expect(h.sent).toEqual([]);
    } finally {
      await h.dispose();
    }
  });

  test("clicking a folder goes into it and lists its contents", async () => {
    const h = await mount();
    try {
      const ta = textareaOf(h.container);
      await h.type(ta, "look at @");
      await h.click(option(h.container, "src"));
      expect(ta.value).toBe("look at @src/");
      expect(h.requestedDirs).toContain("src");
      const text = menuText(h.container);
      expect(text).toContain("lib");
      expect(text).toContain("main.ts");
    } finally {
      await h.dispose();
    }
  });

  test("clicking a file replaces the @ token with the relative path", async () => {
    const h = await mount();
    try {
      const ta = textareaOf(h.container);
      await h.type(ta, "look at @src/");
      await h.click(option(h.container, "src/main.ts"));
      expect(ta.value).toBe("look at @src/main.ts ");
      expect(h.container.querySelector('[role="listbox"]')).toBeNull();
      expect(h.sent).toEqual([]);
    } finally {
      await h.dispose();
    }
  });

  test("typing filters the current folder without refetching, and Enter picks the file", async () => {
    const h = await mount();
    try {
      const ta = textareaOf(h.container);
      await h.type(ta, "@src/ma");
      const text = menuText(h.container);
      expect(text).toContain("main.ts");
      expect(text).not.toContain("lib");
      const fetchesForSrc = h.requestedDirs.filter((d) => d === "src").length;
      expect(fetchesForSrc).toBe(1); // filter is client-side
      await h.keydown(ta, "Enter");
      expect(ta.value).toBe("@src/main.ts ");
      expect(h.sent).toEqual([]);
    } finally {
      await h.dispose();
    }
  });

  test("Escape cancels the picker and leaves the @ as typed", async () => {
    const h = await mount();
    try {
      const ta = textareaOf(h.container);
      await h.type(ta, "look at @sr");
      expect(h.container.querySelector('[role="listbox"]')).not.toBeNull();
      await h.keydown(ta, "Escape");
      expect(h.container.querySelector('[role="listbox"]')).toBeNull();
      expect(ta.value).toBe("look at @sr");
      expect(h.sent).toEqual([]);
    } finally {
      await h.dispose();
    }
  });

  test("the parent row navigates back up to the root", async () => {
    const h = await mount();
    try {
      const ta = textareaOf(h.container);
      await h.type(ta, "look at @src/");
      await h.click(option(h.container, ".."));
      expect(ta.value).toBe("look at @");
      expect(h.container.querySelector('[role="listbox"]')).not.toBeNull();
      expect(menuText(h.container)).toContain("README.md");
    } finally {
      await h.dispose();
    }
  });

  test("with commands loaded, @ still opens the file picker", async () => {
    const h = await mount([{ name: "compact", description: "Compact", source: "builtin" }]);
    try {
      const ta = textareaOf(h.container);
      await h.type(ta, "@RE");
      const text = menuText(h.container);
      expect(text).toContain("README.md");
      expect(text).not.toContain("/compact");
    } finally {
      await h.dispose();
    }
  });

  test("a later @ in a message opens a fresh picker after a completed mention", async () => {
    const h = await mount();
    try {
      const ta = textareaOf(h.container);
      await h.type(ta, "@README.md and @");
      expect(h.container.querySelector('[role="listbox"]')).not.toBeNull();
      expect(menuText(h.container)).toContain("src");
    } finally {
      await h.dispose();
    }
  });
});
