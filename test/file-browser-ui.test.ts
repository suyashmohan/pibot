/**
 * File-browser UI contract.
 *
 * The panel is collapsed by default and the surfaces are pure-ish, so most of
 * the contract is server-rendered here: breadcrumb/listing/gallery markup,
 * syntax-highlighted code, the markdown Rendered/Source switch, image
 * full-view and the binary/oversized fallbacks. Two happy-dom interaction
 * tests cover the flows a click actually drives (gallery switch, lightbox,
 * Escape nesting) because SSR cannot.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { act, createElement } from "react";
import { renderToString } from "react-dom/server";
import type { createRoot } from "react-dom/client";
import { loadReactDom } from "./helpers/dom";
import { Window } from "happy-dom";
import { AppShell } from "@/components/AppShell";
import { FileBrowser } from "@/components/FileBrowser";
import { FileEntries } from "@/components/FileEntries";
import { FilePreview } from "@/components/FilePreview";
import type { BrowseEntry, FilePreviewData } from "@/lib/file-browser";

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const image: BrowseEntry = {
  name: "pic.png",
  path: "images/pic.png",
  type: "file",
  kind: "image",
  size: 2048,
  mtimeMs: 1_700_000_000_000,
  language: "xml",
  mime: "image/png",
};
const dir: BrowseEntry = {
  name: "src",
  path: "src",
  type: "dir",
  kind: "dir",
  size: null,
  mtimeMs: 1_700_000_000_000,
  language: null,
  mime: null,
};
const markdown: BrowseEntry = {
  name: "README.md",
  path: "README.md",
  type: "file",
  kind: "markdown",
  size: 32,
  mtimeMs: 1_700_000_000_000,
  language: "markdown",
  mime: null,
};
const code: BrowseEntry = {
  name: "main.ts",
  path: "src/main.ts",
  type: "file",
  kind: "code",
  size: 42,
  mtimeMs: 1_700_000_000_000,
  language: "typescript",
  mime: null,
};

const ENTRIES = [dir, image, markdown, code];

function previewOf(entry: BrowseEntry, over: Partial<FilePreviewData> = {}): FilePreviewData {
  return {
    path: entry.path,
    name: entry.name,
    kind: entry.kind,
    language: entry.language,
    mime: entry.mime,
    status: "text",
    content: "",
    size: entry.size ?? 0,
    mtimeMs: entry.mtimeMs,
    ...over,
  };
}

describe("file listing (list view)", () => {
  test("shows folders, files, sizes and kinds", () => {
    const html = renderToString(
      createElement(FileEntries, {
        sessionId: "s1",
        entries: ENTRIES,
        view: "list",
        onOpenDir: () => {},
        onOpenFile: () => {},
      }),
    );
    expect(html).toContain("src");
    expect(html).toContain("pic.png");
    expect(html).toContain("README.md");
    expect(html).toContain("main.ts");
    expect(html).toContain("2 KB"); // 2048 bytes
    expect(html).toContain('data-kind="dir"');
    expect(html).toContain('data-kind="image"');
    expect(html).toContain('data-kind="markdown"');
    expect(html).toContain('data-kind="code"');
    expect(html).not.toContain("<img"); // list view uses icons, not thumbnails
  });
});

describe("file listing (gallery view)", () => {
  test("renders lazy thumbnails for images only", () => {
    const html = renderToString(
      createElement(FileEntries, {
        sessionId: "s1",
        entries: ENTRIES,
        view: "gallery",
        onOpenDir: () => {},
        onOpenFile: () => {},
      }),
    );
    const imgs = html.match(/<img/g) ?? [];
    expect(imgs.length).toBe(1); // folders/markdown/code get icons, not <img>
    expect(html).toContain('src="/api/sessions/s1/files/raw?path=images%2Fpic.png"');
    expect(html).toContain('alt="pic.png"');
    expect(html).toContain('loading="lazy"');
  });
});

describe("text/code preview", () => {
  test("syntax-highlights through highlight.js", () => {
    const html = renderToString(
      createElement(FilePreview, {
        sessionId: "s1",
        entry: code,
        preview: previewOf(code, { content: "export function greet() { return 1; }" }),
        lightboxOpen: false,
        onToggleLightbox: () => {},
        onBack: () => {},
      }),
    );
    expect(html).toContain("hljs-keyword"); // `export`/`function`
    expect(html).toContain("greet");
    expect(html).toContain("1"); // line-number gutter
    expect(html).toContain('title="Toggle line wrap"');
    expect(html).toContain('title="Download"');
  });
});

describe("markdown preview", () => {
  test("offers both a rendered GFM view and the highlighted source", () => {
    const html = renderToString(
      createElement(FilePreview, {
        sessionId: "s1",
        entry: markdown,
        preview: previewOf(markdown, {
          content: "# Title\n\n| a | b |\n| - | - |\n| 1 | 2 |\n",
        }),
        lightboxOpen: false,
        onToggleLightbox: () => {},
        onBack: () => {},
      }),
    );
    expect(html).toContain("Rendered");
    expect(html).toContain("Source");
    // Rendered by default: GFM heading + table markup, not the raw `#`.
    expect(html).toContain("<h1");
    expect(html).toContain("<table");
  });

  test("resolves relative image sources through the raw endpoint", () => {
    const html = renderToString(
      createElement(FilePreview, {
        sessionId: "s1",
        entry: markdown,
        preview: previewOf(markdown, { content: "![shot](images/pic.png)\n" }),
        lightboxOpen: false,
        onToggleLightbox: () => {},
        onBack: () => {},
      }),
    );
    expect(html).toContain("/api/sessions/s1/files/raw?path=images%2Fpic.png");
  });
});

describe("image preview", () => {
  test("shows the image and offers a full view", () => {
    const html = renderToString(
      createElement(FilePreview, {
        sessionId: "s1",
        entry: image,
        preview: null,
        lightboxOpen: false,
        onToggleLightbox: () => {},
        onBack: () => {},
      }),
    );
    expect(html).toContain('src="/api/sessions/s1/files/raw?path=images%2Fpic.png"');
    expect(html).toContain('title="Full view"');
  });
});

describe("non-previewable files", () => {
  test("binary files explain themselves and offer a download", () => {
    const bin: BrowseEntry = { ...code, name: "bundle.zip", path: "bundle.zip", kind: "binary" };
    const html = renderToString(
      createElement(FilePreview, {
        sessionId: "s1",
        entry: bin,
        preview: previewOf(bin, { status: "binary", content: null, language: null }),
        lightboxOpen: false,
        onToggleLightbox: () => {},
        onBack: () => {},
      }),
    );
    expect(html).toContain("Binary file");
    expect(html).toContain("download=1");
  });

  test("oversized files report their size instead of content", () => {
    const big: BrowseEntry = { ...code, name: "huge.txt", path: "huge.txt", kind: "text", size: 5_000_000 };
    const html = renderToString(
      createElement(FilePreview, {
        sessionId: "s1",
        entry: big,
        preview: previewOf(big, { status: "too-large", content: null }),
        lightboxOpen: false,
        onToggleLightbox: () => {},
        onBack: () => {},
      }),
    );
    expect(html).toContain("too large");
    expect(html).toContain("4.8 MB");
    expect(html).not.toContain("hljs-keyword");
  });
});

describe("AppShell entry point", () => {
  test("the file browser is collapsed by default behind a toggle", () => {
    const html = renderToString(createElement(AppShell));
    expect(html).toContain('title="Toggle file browser"');
    expect(html).not.toContain('aria-label="File browser"');
  });
});

/* ── interaction tests (happy-dom) ─────────────────────────────────── */

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

describe("file browser interactions", () => {
  test("gallery toggle swaps the listing to thumbnails", async () => {
    clearDomGlobals();
    const win = installDom({
      "/api/sessions/s1/files/browse": { cwd: "/proj", dir: "", entries: ENTRIES, truncated: false },
    });
    activeWin = win;
    const doc = win.document as unknown as Document;
    const container = doc.createElement("div");
    doc.body.appendChild(container);

    let root: ReturnType<typeof createRoot> | null = null;
    const reactDom = await loadReactDom();
    await act(async () => {
      root = reactDom.createRoot(container as unknown as Element);
      root.render(
        createElement(FileBrowser, {
          sessionId: "s1",
          cwd: "/proj",
          mode: "docked",
          onClose: () => {},
          onCollapse: () => {},
          onExpand: () => {},
        }),
      );
    });
    await act(async () => {}); // flush the browse fetch

    expect(doc.body.innerHTML).toContain("pic.png");
    expect(doc.body.innerHTML).not.toContain("<img");

    const galleryBtn = doc.querySelector('button[title="Gallery view"]');
    expect(galleryBtn).not.toBeNull();
    await act(async () => {
      (galleryBtn as unknown as { click: () => void }).click();
    });
    expect(doc.body.innerHTML).toContain("<img");
    expect(doc.body.innerHTML).toContain("images%2Fpic.png");

    await act(async () => {
      root?.unmount();
    });
  });

  test("image full view opens a lightbox and Escape closes it first", async () => {
    clearDomGlobals();
    const win = installDom({
      "/api/sessions/s1/files/browse": { cwd: "/proj", dir: "", entries: ENTRIES, truncated: false },
    });
    activeWin = win;
    const doc = win.document as unknown as Document;
    const container = doc.createElement("div");
    doc.body.appendChild(container);

    let root: ReturnType<typeof createRoot> | null = null;
    const reactDom = await loadReactDom();
    await act(async () => {
      root = reactDom.createRoot(container as unknown as Element);
      root.render(
        createElement(FileBrowser, {
          sessionId: "s1",
          cwd: "/proj",
          mode: "docked",
          onClose: () => {},
          onCollapse: () => {},
          onExpand: () => {},
        }),
      );
    });
    await act(async () => {});

    const row = doc.querySelector('[data-path="images/pic.png"]');
    expect(row).not.toBeNull();
    await act(async () => {
      (row as unknown as { click: () => void }).click();
    });

    const fullBtn = doc.querySelector('button[title="Full view"]');
    expect(fullBtn).not.toBeNull();
    await act(async () => {
      (fullBtn as unknown as { click: () => void }).click();
    });
    expect(doc.querySelector('[data-testid="lightbox"]')).not.toBeNull();

    // Escape closes the lightbox but keeps the image preview open.
    await act(async () => {
      doc.dispatchEvent(
        new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }) as unknown as Event,
      );
    });
    expect(doc.querySelector('[data-testid="lightbox"]')).toBeNull();
    expect(doc.querySelector('button[title="Back to file list"]')).not.toBeNull();

    await act(async () => {
      root?.unmount();
    });
  });

  test("markdown Source tab shows the highlighted source instead of the render", async () => {
    clearDomGlobals();
    const win = installDom({
      "/api/sessions/s1/files/browse": { cwd: "/proj", dir: "", entries: [markdown], truncated: false },
      "/api/sessions/s1/files/content": previewOf(markdown, { content: "# Title\n\nbody\n" }),
    });
    activeWin = win;
    const doc = win.document as unknown as Document;
    const container = doc.createElement("div");
    doc.body.appendChild(container);

    let root: ReturnType<typeof createRoot> | null = null;
    const reactDom = await loadReactDom();
    await act(async () => {
      root = reactDom.createRoot(container as unknown as Element);
      root.render(
        createElement(FileBrowser, {
          sessionId: "s1",
          cwd: "/proj",
          mode: "docked",
          onClose: () => {},
          onCollapse: () => {},
          onExpand: () => {},
        }),
      );
    });
    await act(async () => {});

    await act(async () => {
      (doc.querySelector('[data-path="README.md"]') as unknown as { click: () => void }).click();
    });
    await act(async () => {}); // flush the content fetch

    expect(doc.body.innerHTML).toContain("<h1");

    const sourceTab = [...doc.querySelectorAll("button")].find((b) => b.textContent === "Source");
    expect(sourceTab).toBeDefined();
    await act(async () => {
      (sourceTab as unknown as { click: () => void }).click();
    });
    expect(doc.body.innerHTML).not.toContain("<h1");
    expect(doc.body.innerHTML).toContain("hljs-section"); // "# Title" highlighted as a markdown heading

    await act(async () => {
      root?.unmount();
    });
  });
});
