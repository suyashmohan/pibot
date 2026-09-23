/**
 * ChatView steer-retry regression (PR 1 characterization).
 *
 * A failed *direct* prompt must be retried exactly once with
 * `streamingBehavior: "steer"`; the retry must reuse the same URL and keep the
 * original message. ChatView owns this through the client migration.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { Window } from "happy-dom";
import { loadReactDom } from "./helpers/dom";
import { ChatView } from "@/components/ChatView";

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const ID = "retry-session";
let promptBodies: Array<Record<string, unknown>> = [];

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
  delete g.EventSource;
  delete g.fetch;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ ok: status < 400, data, ...(status >= 400 ? { error: String((data as { error?: string }).error ?? "err") } : {}) }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SESSION = {
  id: ID,
  name: "retry",
  cwd: "/tmp/retry",
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
  const win = new Window({ width: 390, height: 844, url: "http://localhost:3000/" });
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
    if (path === `/api/sessions/${ID}/prompt`) {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      promptBodies.push(body);
      // First direct attempt: busy 409. The steer retry succeeds.
      if (promptBodies.length === 1) return json({ error: "agent is busy" }, 409);
      return json({ response: { type: "response", success: true, command: "prompt" } });
    }
    if (path === `/api/sessions/${ID}`)
      return json({ session: SESSION, state: null, stats: null, messages: [], liveError: null, live: true });
    if (path === `/api/sessions/${ID}/messages`) return json({ messages: [], live: true });
    if (path === `/api/sessions/${ID}/stats`) return json({ state: null, stats: null, live: true });
    if (path === `/api/sessions/${ID}/model`) return json({ models: [], state: null, thinkingLevels: null });
    if (path === `/api/sessions/${ID}/control`) return json({ response: null, live: true });
    if (path === `/api/sessions/${ID}/start`) return json({ started: true, live: true });
    return json({});
  }) as typeof fetch;

  return win;
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

describe("ChatView direct-prompt steer retry", () => {
  test("a failed direct prompt retries once with streamingBehavior=steer", async () => {
    clearDomGlobals();
    promptBodies = [];
    const win = installEnv();
    activeWin = win;
    const doc = win.document as unknown as Document;
    const container = doc.createElement("div");
    doc.body.appendChild(container);
    const reactDom = await loadReactDom();
    let root: Root | null = null;
    await act(async () => {
      root = reactDom.createRoot(container as unknown as Element);
      root.render(
        createElement(ChatView, {
          sessionId: ID,
          onRenamed: () => {},
          onSessionCloned: () => {},
        }) as never,
      );
    });

    const textarea = doc.querySelector("textarea") as unknown as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();

    await act(async () => {
      textarea.dispatchEvent(
        new win.Event("focus", { bubbles: true }) as unknown as Event,
      );
    });

    // Type through the native setter so React sees the input change.
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        win.HTMLTextAreaElement.prototype as unknown as object,
        "value",
      )?.set;
      setter?.call(textarea, "do the thing");
      textarea.dispatchEvent(new win.InputEvent("input", { bubbles: true }) as unknown as Event);
    });
    await act(async () => {
      textarea.dispatchEvent(
        new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as unknown as Event,
      );
    });
    await act(async () => {});

    expect(promptBodies).toHaveLength(2);
    // Mode "direct" omits `mode` entirely (server defaults to prompt).
    expect(promptBodies[0].mode).toBeUndefined();
    expect(promptBodies[0].message).toBe("do the thing");
    expect(promptBodies[1].mode).toBeUndefined();
    expect(promptBodies[1].streamingBehavior).toBe("steer");
    expect(promptBodies[1].message).toBe("do the thing");

    await act(async () => {
      root?.unmount();
    });
  });
});
