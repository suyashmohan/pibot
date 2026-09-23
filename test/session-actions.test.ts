/**
 * ChatView session-action regressions.
 *
 * 1. Export used to only toast the staged path — the browser never received
 *    the file. Clicking Export must trigger a download of the same-origin
 *    `GET /api/sessions/[id]/export` URL with the session's export file name.
 *
 * 2. "New pi session" was removed from Commands & session options; the clone
 *    action stays. (The lifecycle API keeps the `new_session` op.)
 */
import { afterEach, describe, expect, test } from "bun:test";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { Window } from "happy-dom";
import { loadReactDom } from "./helpers/dom";
import { ChatView } from "@/components/ChatView";
import { exportFileName } from "@/lib/export-html";

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const ID = "actions-session";
let controlBodies: Array<Record<string, unknown>> = [];

const DOM_GLOBALS = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLAnchorElement",
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
  delete g.EventSource;
  delete g.fetch;
}

function json(data: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({
      ok: status < 400,
      data,
      ...(status >= 400 ? { error: String((data as { error?: string }).error ?? "err") } : {}),
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

const SESSION = {
  id: ID,
  name: "actions",
  cwd: "/tmp/actions",
  provider: null,
  modelId: null,
  thinkingLevel: null,
  piSessionId: null,
  piSessionFile: null,
  createdAt: 1,
  updatedAt: 1,
};

let activeWin: Window | null = null;

function installEnv(): Window {
  const win = new Window({ width: 1280, height: 800, url: "http://localhost:3000/" });
  const g = globalThis as unknown as Record<string, unknown>;
  const w = win as unknown as Record<string, unknown>;
  g.window = win;
  for (const k of DOM_GLOBALS) g[k] = w[k];

  class FakeEventSource {
    static readonly CLOSED = 2;
    readyState = 0;
    onmessage: ((ev: unknown) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(readonly url: string) {}
    addEventListener(): void {}
    removeEventListener(): void {}
    close(): void {}
  }
  g.EventSource = FakeEventSource;

  g.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String((input as { url?: unknown })?.url ?? input);
    const path = new URL(url, "http://localhost:3000").pathname;
    if (path === `/api/sessions/${ID}/control`) {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      controlBodies.push(body);
      if (body.action === "export_html") {
        return json({
          response: {
            type: "response",
            command: "export_html",
            success: true,
            data: { path: `/tmp/${exportFileName(ID)}` },
          },
          live: true,
        });
      }
      return json({ response: null, live: true });
    }
    if (path === `/api/sessions/${ID}`)
      return json({ session: SESSION, state: null, stats: null, messages: [], liveError: null, live: true });
    if (path === `/api/sessions/${ID}/messages`) return json({ messages: [], live: true });
    if (path === `/api/sessions/${ID}/stats`) return json({ state: null, stats: null, live: true });
    if (path === `/api/sessions/${ID}/model`) return json({ models: [], state: null, thinkingLevels: null });
    if (path === `/api/sessions/${ID}/start`) return json({ started: true, live: true });
    return json({});
  }) as typeof fetch;

  return win;
}

interface Harness {
  win: Window;
  doc: Document;
  container: HTMLElement;
  root: Root;
  dispose: () => Promise<void>;
}

async function mount(): Promise<Harness> {
  clearDomGlobals();
  controlBodies = [];
  const win = installEnv();
  activeWin = win;
  const doc = win.document as unknown as Document;
  const container = doc.createElement("div");
  doc.body.appendChild(container);
  const { createRoot } = await loadReactDom();
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(container as unknown as Element);
    root.render(
      createElement(ChatView, {
        sessionId: ID,
        onRenamed: () => {},
        onSessionCloned: () => {},
      }) as never,
    );
  });
  return {
    win,
    doc,
    container: container as unknown as HTMLElement,
    root: root!,
    dispose: async () => {
      await act(async () => {
        root?.unmount();
      });
    },
  };
}

afterEach(async () => {
  try {
    await activeWin?.happyDOM?.close?.();
  } catch {
    /* ignore */
  }
  activeWin = null;
  clearDomGlobals();
});

describe("export session download", () => {
  test("clicking Export downloads the staged temp file", async () => {
    const h = await mount();
    try {
      // happy-dom has no download manager: record anchor clicks instead.
      const clicks: HTMLAnchorElement[] = [];
      const proto = h.win.HTMLAnchorElement.prototype as unknown as { click: () => void };
      proto.click = function (this: HTMLAnchorElement) {
        clicks.push(this);
      };

      const button = h.doc.querySelector('button[title="Export session to HTML"]');
      expect(button).not.toBeNull();
      await act(async () => {
        (button as HTMLElement).click();
      });
      await act(async () => {});

      expect(controlBodies.some((b) => b.action === "export_html")).toBe(true);
      expect(clicks).toHaveLength(1);
      expect(clicks[0].getAttribute("href")).toBe(`/api/sessions/${ID}/export`);
      expect(clicks[0].getAttribute("download")).toBe(exportFileName(ID));
    } finally {
      await h.dispose();
    }
  });
});

describe("commands & session options panel", () => {
  test("offers clone but no 'New pi session'", async () => {
    const h = await mount();
    try {
      const toggle = h.doc.querySelector(
        'button[title="Commands & session options (fork, clone)"]',
      );
      expect(toggle).not.toBeNull();
      await act(async () => {
        (toggle as HTMLElement).click();
      });

      const text = h.container.textContent ?? "";
      expect(text).toContain("Clone branch");
      expect(text).not.toContain("New pi session");
    } finally {
      await h.dispose();
    }
  });
});
