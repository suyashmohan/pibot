/**
 * Turn duration display (persisted).
 *
 * The manager measures each turn (`agent_start` → `agent_settled`), persists
 * it on the session row, and tags the settle event with the same number — so
 * the value survives refreshes and the open tab never disagrees with it. This
 * mounts the real ChatView with an EventSource stub that actually dispatches
 * named events, exercising the projector → hook → view path (SSR cannot: the
 * duration only exists after live events / a row read).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { Window } from "happy-dom";
import { loadReactDom } from "./helpers/dom";
import { ChatView } from "@/components/ChatView";

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const ID = "turn-session";

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
  name: "turn",
  cwd: "/tmp/turn",
  provider: null,
  modelId: null,
  thinkingLevel: null,
  piSessionId: null,
  piSessionFile: null,
  createdAt: 1,
  updatedAt: 1,
  lastTurnMs: null as number | null,
};

/** EventSource stub that stores listeners so tests can dispatch named events. */
class FakeEventSource {
  static current: FakeEventSource | null = null;
  static readonly CLOSED = 2;
  readyState = 0;
  onmessage: ((ev: unknown) => void) | null = null;
  onerror: (() => void) | null = null;
  private readonly listeners = new Map<string, Set<EventListener>>();

  constructor(readonly url: string) {
    FakeEventSource.current = this;
  }

  addEventListener(type: string, fn: EventListener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }

  removeEventListener(type: string, fn: EventListener): void {
    this.listeners.get(type)?.delete(fn);
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }

  emit(type: string, payload: Record<string, unknown> = {}): void {
    const ev = { data: JSON.stringify({ type, ...payload }) } as MessageEvent;
    for (const fn of this.listeners.get(type) ?? []) fn(ev as unknown as Event);
  }
}

let activeWin: Window | null = null;

function installEnv(
  session: typeof SESSION = SESSION,
  state: Record<string, unknown> | null = null,
): Window {
  const win = new Window({ width: 1280, height: 800, url: "http://localhost:3000/" });
  const g = globalThis as unknown as Record<string, unknown>;
  const w = win as unknown as Record<string, unknown>;
  g.window = win;
  for (const k of DOM_GLOBALS) g[k] = w[k];
  g.EventSource = FakeEventSource as unknown as typeof EventSource;

  g.fetch = (async (input: unknown) => {
    const url = String((input as { url?: unknown })?.url ?? input);
    const path = new URL(url, "http://localhost:3000").pathname;
    if (path === `/api/sessions/${ID}`)
      return json({ session, state, stats: null, messages: [], liveError: null, live: true });
    if (path === `/api/sessions/${ID}/messages`) return json({ messages: [], live: true });
    if (path === `/api/sessions/${ID}/stats`) return json({ state: null, stats: null, live: true });
    if (path === `/api/sessions/${ID}/model`) return json({ models: [], state: null, thinkingLevels: null });
    if (path === `/api/sessions/${ID}/control`) return json({ response: null, live: true });
    if (path === `/api/sessions/${ID}/start`) return json({ started: true, live: true });
    return json({});
  }) as typeof fetch;

  return win;
}

interface Harness {
  win: Window;
  container: HTMLElement;
  es: FakeEventSource;
  dispose: () => Promise<void>;
}

async function mount(
  session: typeof SESSION = SESSION,
  state: Record<string, unknown> | null = null,
): Promise<Harness> {
  clearDomGlobals();
  FakeEventSource.current = null;
  const win = installEnv(session, state);
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
  const es = FakeEventSource.current;
  if (!es) throw new Error("ChatView did not subscribe to the SSE stream");
  return {
    win,
    container: container as unknown as HTMLElement,
    es,
    dispose: async () => {
      await act(async () => {
        root?.unmount();
      });
    },
  };
}

/** The muted duration line, if rendered. */
function durationLine(container: HTMLElement): HTMLElement | null {
  return (
    [...container.querySelectorAll("p")].find((p) =>
      (p.textContent ?? "").startsWith("Completed in"),
    ) ?? null
  );
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

describe("turn duration", () => {
  test("shows the manager-measured duration after settle, small and muted", async () => {
    const h = await mount();
    try {
      await act(async () => {
        h.es.emit("agent_start");
      });
      // Running turns do not show a finished duration.
      expect(durationLine(h.container)).toBeNull();

      await act(async () => {
        h.es.emit("agent_settled", { durationMs: 1500 });
      });
      await act(async () => {});

      const line = durationLine(h.container);
      expect(line?.textContent).toBe("Completed in 1.5s");
      expect(line?.className).toContain("text-fg-faint");
      expect(line?.className).toContain("text-[11px]");
    } finally {
      await h.dispose();
    }
  });

  test("restores the persisted duration when a session is (re)loaded", async () => {
    const h = await mount({ ...SESSION, lastTurnMs: 4200 });
    try {
      expect(durationLine(h.container)?.textContent).toBe("Completed in 4.2s");
    } finally {
      await h.dispose();
    }
  });

  test("ignores malformed durations instead of rendering a dash", async () => {
    // A drifted schema used to make drizzle hand back the raw column name
    // (`"last_turn_ms"`); that rendered as “Completed in —”.
    const h = await mount({
      ...SESSION,
      lastTurnMs: "last_turn_ms" as unknown as number,
    });
    try {
      expect(durationLine(h.container)).toBeNull();

      await act(async () => {
        h.es.emit("agent_start");
      });
      await act(async () => {
        h.es.emit("agent_settled", { durationMs: "1234" });
      });
      await act(async () => {});
      expect(durationLine(h.container)).toBeNull();
    } finally {
      await h.dispose();
    }
  });

  test("a new turn hides the previous duration and replaces it when settled", async () => {
    const h = await mount({ ...SESSION, lastTurnMs: 3000 });
    try {
      expect(durationLine(h.container)?.textContent).toBe("Completed in 3.0s");

      await act(async () => {
        h.es.emit("agent_start");
      });
      expect(durationLine(h.container)).toBeNull();

      await act(async () => {
        h.es.emit("agent_settled", { durationMs: 2500 });
      });
      await act(async () => {});
      expect(durationLine(h.container)?.textContent).toBe("Completed in 2.5s");
    } finally {
      await h.dispose();
    }
  });

  test("a process exit mid-turn does not resurrect the old duration", async () => {
    // Loaded while a turn is already streaming: the row holds the previous
    // turn's time, which must stay hidden — and must not come back when the
    // process dies before settling.
    const h = await mount({ ...SESSION, lastTurnMs: 3000 }, { isStreaming: true });
    try {
      expect(durationLine(h.container)).toBeNull();

      await act(async () => {
        h.es.emit("client_exit", { reason: "crash" });
      });
      await act(async () => {});
      expect(durationLine(h.container)).toBeNull();
    } finally {
      await h.dispose();
    }
  });
});
