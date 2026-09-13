/**
 * Composer intent = the spawn trigger.
 *
 * Opening an old session must not start pi; focusing the message box must.
 * Mounts the real ChatView in a mobile-sized happy-dom with stubbed fetch and
 * EventSource, so the hook → Composer wiring is exercised end to end.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { ChatView } from "@/components/ChatView";

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const ID = "s1";
let calls: Array<{ url: string; method: string }> = [];

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

function json(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const SESSION = {
  id: ID,
  name: "old session",
  cwd: "/tmp/old",
  provider: "anthropic",
  modelId: "claude-sonnet",
  thinkingLevel: null,
  piSessionId: null,
  piSessionFile: null,
  createdAt: 1,
  updatedAt: 1,
};

function installEnv(opts: { live?: boolean; stats?: unknown } = {}): Window {
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
    calls.push({ url: path, method: init?.method ?? "GET" });
    if (path === `/api/sessions/${ID}`)
      return json({
        session: SESSION,
        state: null,
        stats: opts.stats ?? null,
        messages: [],
        liveError: null,
        live: Boolean(opts.live),
      });
    if (path === `/api/sessions/${ID}/start`) return json({ started: true, live: true });
    if (path === `/api/sessions/${ID}/model`) return json({ models: [], state: null, thinkingLevels: null });
    if (path === `/api/sessions/${ID}/stats`) return json({ state: null, stats: null, live: true });
    if (path === `/api/sessions/${ID}/messages`) return json({ messages: [], live: true });
    if (path === `/api/sessions/${ID}/control`) return json({ response: null, live: true });
    return json({});
  }) as typeof fetch;

  return win;
}

let activeWin: Window | null = null;

async function mountChat(
  win: Window,
): Promise<{ root: ReturnType<typeof createRoot>; doc: Document }> {
  const doc = win.document as unknown as Document;
  const container = doc.createElement("div");
  doc.body.appendChild(container);
  let root: ReturnType<typeof createRoot> | null = null;
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
  return { root: root as unknown as ReturnType<typeof createRoot>, doc };
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

describe("lazy spawn from the composer", () => {
  test("opening a session starts nothing; focusing the input starts pi once", async () => {
    clearDomGlobals();
    calls = [];
    const win = installEnv();
    activeWin = win;
    const { root, doc } = await mountChat(win);

    // Viewing only: no process spawn, no usage chips, explicit asleep hint —
    // and definitely not an "unreachable" error (asleep is the normal state).
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/start"))).toBe(false);
    expect(doc.querySelector('[aria-label="Token usage details"]')).toBeNull();
    expect(doc.body.textContent).toContain("asleep");
    expect(doc.body.textContent).not.toContain("unreachable");

    const textarea = doc.querySelector("textarea");
    expect(textarea).not.toBeNull();

    await act(async () => {
      (textarea as unknown as HTMLElement).focus();
    });
    await act(async () => {});

    const starts = calls.filter((c) => c.url.endsWith("/start"));
    expect(starts.length).toBe(1);
    expect(starts[0].method).toBe("POST");
    // Process attached: the asleep hint is replaced by the normal footer.
    expect(doc.body.textContent).not.toContain("asleep");

    // Refocusing keeps the awake state (the endpoint is idempotent server-side).
    await act(async () => {
      (textarea as unknown as HTMLElement).blur();
      (textarea as unknown as HTMLElement).focus();
    });
    await act(async () => {});
    expect(doc.body.textContent).not.toContain("asleep");

    await act(async () => {
      root.unmount();
    });
  });

  test("a live session shows usage chips in the mobile strip and the desktop row", async () => {
    clearDomGlobals();
    calls = [];
    const win = installEnv({
      live: true,
      stats: {
        tokens: { input: 50_000, output: 10_000, cacheRead: 40_000, cacheWrite: 5_000, total: 105_000 },
        cost: 0.45,
        contextUsage: { percent: 42, tokens: 60_000, contextWindow: 200_000 },
      },
    });
    activeWin = win;
    const { root, doc } = await mountChat(win);

    // Two chips: the lg-gated inline row and the mobile/tablet strip.
    expect(doc.querySelectorAll('[aria-label="Token usage details"]').length).toBe(2);
    expect(doc.body.textContent).toContain("105.0k");
    expect(doc.body.textContent).toContain("42% ctx");

    // The mobile strip is a full-width header row (wraps below lg).
    const strip = doc.querySelector("header div.flex.basis-full");
    expect(strip).not.toBeNull();
    expect(strip!.className).toContain("lg:hidden");

    expect(doc.body.textContent).not.toContain("asleep");

    await act(async () => {
      root.unmount();
    });
  });
});
