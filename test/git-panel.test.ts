/**
 * Git changes panel — the right-side rail that shares the file browser's
 * footprint. Covers the server-rendered states (changes, clean tree,
 * not-a-repository, error), the rail's widths/placement, the one-at-a-time
 * rail rule, and a happy-dom round trip through `GET …/git`.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { act, createElement } from "react";
import { renderToString } from "react-dom/server";
import type { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { loadReactDom } from "./helpers/dom";
import { AppShell } from "@/components/AppShell";
import { FileBrowser } from "@/components/FileBrowser";
import { GitPanel, GitPanelBody } from "@/components/GitPanel";
import type { GitStatusSnapshot } from "@/lib/git-status";
import { nextRightPanel } from "@/lib/layout";

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const CLEAN: GitStatusSnapshot = {
  isRepo: true,
  root: "/Users/me/code/proj",
  branch: "main",
  files: [],
  added: 0,
  removed: 0,
  truncated: false,
  error: null,
};

const CHANGES: GitStatusSnapshot = {
  isRepo: true,
  root: "/Users/me/code/proj",
  branch: "feature/git-panel",
  files: [
    {
      path: "README.md",
      origPath: null,
      kind: "modified",
      staged: false,
      unstaged: true,
      added: 12,
      removed: 3,
    },
    {
      path: "src/old-name.ts",
      origPath: "src/new-name.ts",
      kind: "renamed",
      staged: true,
      unstaged: false,
      added: 0,
      removed: 0,
    },
    {
      path: "assets/logo.bin",
      origPath: null,
      kind: "untracked",
      staged: false,
      unstaged: true,
      added: null,
      removed: null,
    },
  ],
  added: 12,
  removed: 3,
  truncated: false,
  error: null,
};

const NOT_REPO: GitStatusSnapshot = {
  isRepo: false,
  root: null,
  branch: null,
  files: [],
  added: 0,
  removed: 0,
  truncated: false,
  error: null,
};

function renderBody(over: Partial<Parameters<typeof GitPanelBody>[0]> = {}): string {
  return renderToString(
    createElement(GitPanelBody, {
      status: CHANGES,
      cwd: "/Users/me/code/proj",
      loading: false,
      error: null,
      onRetry: () => {},
      ...over,
    }),
  );
}

describe("GitPanelBody states", () => {
  test("lists changed files with status letters and line counts", () => {
    const html = renderBody({ status: CHANGES });
    expect(html).toContain('data-path="README.md"');
    expect(html).toContain("README.md");
    expect(html).toContain("+12");
    expect(html).toContain("−3");
    expect(html).toContain('data-path="src/old-name.ts"');
    expect(html).toContain("old-name.ts"); // renamed shows the new path
    expect(html).toContain('title="src/new-name.ts"'); // source path on hover
    // Binary / uncountable files show a dash rather than a fake number.
    expect(html).toContain('data-path="assets/logo.bin"');
    expect(html).toContain("—");
  });

  test("shows a clean working tree message when there are no changes", () => {
    const html = renderBody({ status: CLEAN });
    expect(html).toContain("No changes");
    expect(html).toContain("Working tree is clean");
  });

  test("explains when the folder is not a git repository", () => {
    const html = renderBody({ status: NOT_REPO });
    expect(html).toContain("Not a git repository");
    expect(html).toContain("/Users/me/code/proj");
  });

  test("shows a spinner while the first load is in flight", () => {
    const html = renderBody({ status: null, loading: true });
    expect(html).toContain("Loading");
  });

  test("renders errors with a retry action", () => {
    const html = renderBody({ status: null, loading: false, error: "git is not available" });
    expect(html).toContain("git is not available");
    expect(html).toContain("Retry");
  });

  test("notes truncation when the change list is capped", () => {
    const html = renderBody({ status: { ...CHANGES, truncated: true } });
    expect(html).toContain("first");
    expect(html).toContain("changed files");
  });
});

describe("right rail exclusivity", () => {
  test("opening git closes files and vice versa; clicking the open one closes it", () => {
    expect(nextRightPanel("closed", "files")).toBe("files");
    expect(nextRightPanel("closed", "git")).toBe("git");
    expect(nextRightPanel("files", "git")).toBe("git");
    expect(nextRightPanel("git", "files")).toBe("files");
    expect(nextRightPanel("git", "git")).toBe("closed");
    expect(nextRightPanel("files", "files")).toBe("closed");
  });
});

describe("right rail footprint", () => {
  function asideClasses(html: string): string {
    const m = /<aside[^>]*class="([^"]*)"/.exec(html);
    if (!m) throw new Error("no <aside> in rendered output");
    return m[1];
  }

  test("the git panel is docked exactly like the file browser", () => {
    const git = renderToString(
      createElement(GitPanel, {
        sessionId: "s1",
        cwd: "/Users/me/code/proj",
        mode: "docked" as const,
        onClose: () => {},
        onCollapse: () => {},
        onExpand: () => {},
      }),
    );
    const files = renderToString(
      createElement(FileBrowser, {
        sessionId: "s1",
        cwd: "/Users/me/code/proj",
        mode: "docked" as const,
        onClose: () => {},
        onCollapse: () => {},
        onExpand: () => {},
      }),
    );
    const gitClasses = asideClasses(git);
    expect(gitClasses).toContain("md:w-[300px]");
    expect(gitClasses).toContain("lg:w-[340px]");
    expect(gitClasses).toContain("md:border-l");
    expect(gitClasses).toBe(asideClasses(files));
  });

  test("full mode takes over the viewport", () => {
    const html = renderToString(
      createElement(GitPanel, {
        sessionId: "s1",
        cwd: "/Users/me/code/proj",
        mode: "full" as const,
        onClose: () => {},
        onCollapse: () => {},
        onExpand: () => {},
      }),
    );
    expect(asideClasses(html)).toContain("fixed inset-0 z-50");
  });
});

describe("AppShell entry point", () => {
  test("the git toggle sits next to Files and the rail starts closed", () => {
    const html = renderToString(createElement(AppShell));
    expect(html).toContain('title="Toggle git changes"');
    expect(html).toContain('title="Toggle file browser"');
    expect(html).not.toContain('aria-label="Git changes"');
    expect(html).not.toContain('aria-label="File browser"');
  });
});

/* ── interaction test (happy-dom) ──────────────────────────────────── */

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
  "KeyboardEvent",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
];

function clearDomGlobals(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  for (const k of DOM_GLOBALS) delete g[k];
  delete g.fetch;
}

function installDom(routes: Record<string, unknown>): Window {
  const win = new Window({ width: 1280, height: 900, url: "http://localhost:3000/" });
  const g = globalThis as unknown as Record<string, unknown>;
  const w = win as unknown as Record<string, unknown>;
  g.window = win;
  g.document = w.document;
  g.navigator = w.navigator;
  for (const k of DOM_GLOBALS) {
    if (k === "window" || k === "document" || k === "navigator") continue;
    g[k] = w[k];
  }
  g.fetch = (async (input: unknown) => {
    const url = String((input as { url?: unknown })?.url ?? input);
    const { pathname } = new URL(url, "http://localhost:3000");
    return new Response(JSON.stringify({ ok: true, data: routes[pathname] ?? {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
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

async function renderPanel(routes: Record<string, unknown>): Promise<{
  doc: Document;
  root: ReturnType<typeof createRoot>;
}> {
  clearDomGlobals();
  const win = installDom(routes);
  activeWin = win;
  const doc = win.document as unknown as Document;
  const container = doc.createElement("div");
  doc.body.appendChild(container);

  let root: ReturnType<typeof createRoot> | null = null;
  const reactDom = await loadReactDom();
  await act(async () => {
    root = reactDom.createRoot(container as unknown as Element);
    root.render(
      createElement(GitPanel, {
        sessionId: "s1",
        cwd: "/Users/me/code/proj",
        mode: "docked" as const,
        onClose: () => {},
        onCollapse: () => {},
        onExpand: () => {},
      }),
    );
  });
  await act(async () => {}); // flush the status fetch
  return { doc, root: root as unknown as ReturnType<typeof createRoot> };
}

describe("git panel interactions", () => {
  test("renders the change list from the API", async () => {
    const { doc, root } = await renderPanel({ "/api/sessions/s1/git": CHANGES });
    expect(doc.body.innerHTML).toContain("README.md");
    expect(doc.body.innerHTML).toContain("+12");
    expect(doc.body.innerHTML).toContain("feature/git-panel"); // branch in the header
    await act(async () => {
      root.unmount();
    });
  });

  test("shows the not-a-repository message from the API", async () => {
    const { doc, root } = await renderPanel({ "/api/sessions/s1/git": NOT_REPO });
    expect(doc.body.innerHTML).toContain("Not a git repository");
    await act(async () => {
      root.unmount();
    });
  });
});
