/**
 * Toast auto-dismiss timers must be cancelled on unmount.
 *
 * CI run 35860424510: `test/turn-duration.test.ts` emits `client_exit`, which
 * pushes an error toast, then unmounts ChatView and tears down the happy-dom
 * globals. The 6s auto-dismiss timer outlived the test; when it fired while
 * `test/control/policy.test.ts` was running, React's `dispatchSetState` read
 * `window.event` in a process with no DOM and threw
 * `ReferenceError: window is not defined` — attributed to the policy test.
 *
 * The timer is faked here so the leak is deterministic instead of a 6-second
 * race against whatever file happens to be running when it fires.
 */
import { afterEach, describe, expect, jest, test } from "bun:test";
import { act, createElement, useEffect } from "react";
import type { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { loadReactDom } from "./helpers/dom";
import { usePiSession, type Toast } from "@/hooks/usePiSession";

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

let activeWin: Window | null = null;

afterEach(async () => {
  jest.useRealTimers();
  try {
    await activeWin?.happyDOM?.close?.();
  } catch {
    /* ignore */
  }
  activeWin = null;
  clearDomGlobals();
});

describe("usePiSession toast auto-dismiss", () => {
  test("unmounting cancels the auto-dismiss timer before it touches React", async () => {
    const win = installDom();
    activeWin = win;
    const doc = win.document as unknown as Document;
    const container = doc.createElement("div");
    doc.body.appendChild(container);

    let push: ((kind: Toast["kind"], message: string) => void) | null = null;
    function Harness() {
      const s = usePiSession(null);
      useEffect(() => {
        push = s.pushToast;
      }, [s.pushToast]);
      return null;
    }

    const reactDom = await loadReactDom();
    let root: ReturnType<typeof createRoot> | null = null;
    await act(async () => {
      root = reactDom.createRoot(container as unknown as Element);
      root.render(createElement(Harness));
    });
    expect(push).not.toBeNull();

    // Fake only from here on: the toast timer is the code under test.
    jest.useFakeTimers();
    await act(async () => {
      push!("error", "boom");
    });
    await act(async () => {
      root?.unmount();
    });

    // The next test file runs without any DOM globals — the same conditions
    // that turned the leaked timer into `ReferenceError: window is not defined`.
    clearDomGlobals();

    // Without the fix this pending timer calls setToasts(), which reaches
    // React DOM's `resolveUpdatePriority()` → `window.event` and throws.
    expect(() => jest.advanceTimersByTime(6000)).not.toThrow();
  });
});
