/**
 * Hydration regression tests (happy-dom + React hydrateRoot).
 *
 * Why this exists: `bun test` runs without a DOM, so SSR-vs-first-client-
 * render divergence is invisible to every other gate (tsc, build, SSR curl).
 * The mobile-drawer hydration crash shipped exactly because of that blind
 * spot. These tests close it: SSR-render to string with NO browser globals
 * (true SSR conditions), then hydrate inside a mobile-simulated DOM and
 * fail on any React hydration warning.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { AppShell } from "@/components/AppShell";

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const GLobalsToClean = [
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
  "KeyboardEvent",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
];

function clearDomGlobals(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  for (const k of GLobalsToClean) delete g[k];
  delete g.fetch;
}

function installMobileDom(seedCollapsed: string[]): Window {
  const win = new Window({ width: 390, height: 844, url: "http://localhost:3000/" });
  // Deterministic viewport: mobile matches, desktop doesn't.
  const mm = (query: string) => {
    const m = /max-width:\s*(\d+)px/.exec(query);
    const matches = m ? win.innerWidth <= Number(m[1]) : false;
    return {
      matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    };
  };
  (win as unknown as Record<string, unknown>).matchMedia = mm;
  win.localStorage.setItem("pibot.project.collapsed", JSON.stringify(seedCollapsed));

  const g = globalThis as unknown as Record<string, unknown>;
  const w = win as unknown as Record<string, unknown>;
  g.window = win;
  g.document = w.document;
  g.navigator = w.navigator;
  for (const k of [
    "HTMLElement",
    "Element",
    "Node",
    "Text",
    "Comment",
    "DocumentFragment",
    "Event",
    "CustomEvent",
    "MouseEvent",
    "KeyboardEvent",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ]) {
    g[k] = w[k];
  }
  // Offline API stubs so mount effects resolve without a server.
  const routes: Record<string, unknown> = {
    "/api/sessions": { sessions: [] },
    "/api/health": { defaultCwd: "/tmp", piVersion: "0.0.0-test", piAvailable: true },
    "/api/projects": { projects: [] },
  };
  g.fetch = (async (input: unknown) => {
    const url = String((input as { url?: unknown })?.url ?? input);
    const pathname = new URL(url, "http://localhost:3000").pathname;
    return new Response(JSON.stringify({ ok: true, data: routes[pathname] ?? {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return win;
}

let captured: string[] = [];
let origConsoleError: typeof console.error | null = null;

function startCapture(): void {
  captured = [];
  origConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    captured.push(args.map((a) => String(a)).join(" "));
  };
}

function stopCapture(): string[] {
  if (origConsoleError) console.error = origConsoleError;
  origConsoleError = null;
  return captured;
}

beforeEach(() => {
  clearDomGlobals();
});

afterEach(async () => {
  stopCapture();
  const g = globalThis as unknown as Record<string, unknown>;
  const win = g.window as unknown as { happyDOM?: { close?: () => Promise<void> } } | undefined;
  try {
    await win?.happyDOM?.close?.();
  } catch {
    /* ignore */
  }
  clearDomGlobals();
});

describe("AppShell hydration", () => {
  test("mobile viewport hydrates with zero hydration warnings", async () => {
    // 1. True SSR: no browser globals at all.
    clearDomGlobals();
    const ssr = renderToString(createElement(AppShell));
    expect(ssr).toContain("<aside");

    // 2. Mobile client: 390px viewport + pre-collapsed project in storage
    //    (the exact conditions of the shipped hydration crash).
    const win = installMobileDom(["/some/project"]);
    const doc = win.document;
    const container = doc.createElement("div");
    container.innerHTML = ssr;
    doc.body.appendChild(container);

    startCapture();
    let root: ReturnType<typeof hydrateRoot> | null = null;
    await act(async () => {
      // happy-dom elements are structurally compatible at runtime.
      root = hydrateRoot(container as unknown as Element, createElement(AppShell));
    });
    const errors = stopCapture();
    await act(async () => {
      root?.unmount();
    });

    const hydrationErrors = errors.filter((e) => /hydrat/i.test(e));
    expect(hydrationErrors).toEqual([]);
  }, 30_000);
});
