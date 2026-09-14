/**
 * Guards the `react-dom/client` import contract (see test/helpers/dom.ts).
 *
 * Regression context: CI failed 15 happy-dom interaction tests while the same
 * commit passed locally. Cause: several test files imported `react-dom/client`
 * statically at module load, i.e. before any DOM existed, and Bun runs test
 * files concurrently in one process — so React DOM's import-time input-event
 * feature detection raced. When it lost, `onChange` never fired and every
 * typing-driven menu stayed closed.
 *
 * The fix is only as good as the discipline, so this pins both halves:
 *  1. no test file may statically import `react-dom/client` at runtime;
 *  2. loading it through the helper (after a DOM exists) really does deliver
 *     `input` events to `onChange`.
 */
import { describe, expect, test } from "bun:test";
import { createElement, useState, act } from "react";
import { Window } from "happy-dom";
import { loadReactDom } from "./helpers/dom";

const HERE = new URL(".", import.meta.url).pathname;

/**
 * A runtime (non-type) static import of react-dom/client. `import type …` is
 * erased by the bundler and is therefore fine — several files use it for
 * `ReturnType<typeof createRoot>`.
 */
const STATIC_IMPORT =
  /^\s*import\s+(?!type\s)[^;]*?from\s+["']react-dom\/client["']/m;

async function testSourceFiles(): Promise<Array<{ name: string; text: string }>> {
  const names: string[] = [];
  for (const name of new Bun.Glob("*.test.ts").scanSync({ cwd: HERE })) names.push(name);
  const out: Array<{ name: string; text: string }> = [];
  for (const name of names.sort()) {
    // Skip this file: its own source contains the pattern it looks for.
    if (name === "dom-bootstrap.test.ts") continue;
    out.push({ name, text: await Bun.file(`${HERE}${name}`).text() });
  }
  return out;
}

describe("react-dom/client import contract", () => {
  test("no test file imports react-dom/client statically at runtime", async () => {
    const offenders: string[] = [];
    for (const { name, text } of await testSourceFiles()) {
      if (STATIC_IMPORT.test(text)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });

  test("loading through the helper delivers input events to onChange", async () => {
    const win = new Window({ width: 1024, height: 768, url: "http://localhost:3000/" });
    const g = globalThis as unknown as Record<string, unknown>;
    const w = win as unknown as Record<string, unknown>;
    const keys = [
      "window", "document", "navigator", "HTMLElement", "HTMLDivElement",
      "HTMLTextAreaElement", "HTMLInputElement", "HTMLButtonElement", "Element",
      "Node", "Text", "Comment", "DocumentFragment", "Event", "CustomEvent",
      "MouseEvent", "KeyboardEvent", "InputEvent", "getComputedStyle",
      "requestAnimationFrame", "cancelAnimationFrame",
    ];
    // Save-and-restore: other test files run concurrently in this process.
    const saved = new Map<string, unknown>();
    for (const k of keys) saved.set(k, g[k]);
    for (const k of keys) {
      g[k] = k === "window" ? win : k === "document" ? w.document : k === "navigator" ? w.navigator : w[k];
    }
    g.IS_REACT_ACT_ENVIRONMENT = true;

    const doc = win.document as unknown as Document;
    const container = doc.createElement("div");
    doc.body.appendChild(container);

    try {
      const { createRoot } = await loadReactDom();
      let changes = 0;

      function Probe() {
        const [value, setValue] = useState("");
        return createElement("textarea", {
          value,
          onChange: (e: { target: { value: string } }) => {
            changes++;
            setValue(e.target.value);
          },
        });
      }

      const root = createRoot(container as unknown as Element);
      await act(async () => root.render(createElement(Probe) as never));

      const ta = container.querySelector("textarea") as unknown as HTMLTextAreaElement;
      await act(async () => {
        // React patches the *instance* value setter for change tracking, so go
        // through the prototype setter (same trick as the composer harness) and
        // then fire a plain `input` event.
        const desc = Object.getOwnPropertyDescriptor(
          win.HTMLTextAreaElement.prototype as unknown as object,
          "value",
        );
        if (desc?.set) desc.set.call(ta, "look at @");
        else ta.value = "look at @";
        ta.dispatchEvent(new win.Event("input", { bubbles: true }) as unknown as Event);
      });
      for (let i = 0; i < 3; i++) {
        await act(async () => {
          await new Promise((r) => setTimeout(r, 0));
        });
      }

      expect(changes).toBeGreaterThan(0);
      await act(async () => root.unmount());
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) delete g[k];
        else g[k] = v;
      }
      await win.happyDOM?.close?.();
    }
  });
});
