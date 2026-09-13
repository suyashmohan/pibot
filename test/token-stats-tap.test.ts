/**
 * Touch interaction regression for the token chip.
 *
 * On iOS Safari a tap does not focus a <button>, so the hover/focus-only
 * popover opened but could never be dismissed. Tapping the chip must open the
 * breakdown and a pointerdown anywhere outside must close it again — the exact
 * path a phone user takes. happy-dom + createRoot mirrors the hydration test's
 * mobile simulation.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { TokenStats } from "@/components/TokenStats";

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
  try {
    await activeWin?.happyDOM?.close?.();
  } catch {
    /* ignore */
  }
  activeWin = null;
  clearDomGlobals();
});

describe("TokenStats tap behaviour", () => {
  test("tap opens the breakdown and an outside tap dismisses it", async () => {
    clearDomGlobals();
    const win = installDom();
    activeWin = win;
    const doc = win.document as unknown as Document;

    const container = doc.createElement("div");
    doc.body.appendChild(container);

    let root: ReturnType<typeof createRoot> | null = null;
    await act(async () => {
      root = createRoot(container as unknown as Element);
      root.render(
        createElement(TokenStats, {
          tokens: { input: 50_000, output: 10_000, cacheRead: 40_000, cacheWrite: 5_000, total: 105_000 },
          cost: 0.45,
        }),
      );
    });

    expect(doc.body.innerHTML).not.toContain("Cache hit");

    const button = doc.querySelector("button");
    expect(button).not.toBeNull();
    await act(async () => {
      button!.click();
    });
    expect(doc.body.innerHTML).toContain("Cache hit");
    expect(doc.body.innerHTML).toContain("40.0k");

    await act(async () => {
      doc.body.dispatchEvent(new win.Event("pointerdown", { bubbles: true }) as unknown as Event);
    });
    expect(doc.body.innerHTML).not.toContain("Cache hit");

    await act(async () => {
      root?.unmount();
    });
  });
});
