/**
 * Pure unit tests for the file-browser helpers (`lib/file-browser.ts`).
 *
 * These are deliberately dependency-free so they can also run in the client
 * bundle: kind detection, syntax-language mapping, path math, byte
 * formatting and the URL builder used by the preview/thumbnail surfaces.
 */
import { describe, expect, test } from "bun:test";
import {
  CODE_LANGUAGES,
  FILE_PREVIEW_MAX_BYTES,
  HIGHLIGHT_MAX_BYTES,
  breadcrumbs,
  fileExtension,
  fileKind,
  formatBytes,
  imageMimeFor,
  isTextKind,
  joinPath,
  languageForFile,
  parentPath,
  rawContentType,
  rawFileUrl,
  shouldHighlight,
  sortBrowseEntries,
  type BrowseEntry,
} from "@/lib/file-browser";
import { highlightLanguageIsRegistered } from "@/lib/highlight";

describe("fileExtension", () => {
  test("lowercases and strips the dot; empty for extensionless names", () => {
    expect(fileExtension("Pic.PNG")).toBe("png");
    expect(fileExtension("a.b.c.ts")).toBe("ts");
    expect(fileExtension("LICENSE")).toBe("");
    expect(fileExtension(".gitignore")).toBe("");
    expect(fileExtension("Makefile")).toBe("");
  });
});

describe("fileKind", () => {
  test("directories are always dirs", () => {
    expect(fileKind("src", "dir")).toBe("dir");
    expect(fileKind("not-an-image.png", "dir")).toBe("dir");
  });

  test("maps images, markdown, code, text and binary extensions", () => {
    expect(fileKind("logo.svg", "file")).toBe("image");
    expect(fileKind("shot.JPEG", "file")).toBe("image");
    expect(fileKind("README.md", "file")).toBe("markdown");
    expect(fileKind("notes.mdx", "file")).toBe("markdown");
    expect(fileKind("main.ts", "file")).toBe("code");
    expect(fileKind("styles.css", "file")).toBe("code");
    expect(fileKind("notes.txt", "file")).toBe("text");
    expect(fileKind("data.csv", "file")).toBe("text");
    expect(fileKind("bundle.zip", "file")).toBe("binary");
    expect(fileKind("archive.tar.gz", "file")).toBe("binary");
  });

  test("extensionless conventions: LICENSE text, Dockerfile code, dotfiles text", () => {
    expect(fileKind("LICENSE", "file")).toBe("text");
    expect(fileKind("Makefile", "file")).toBe("code");
    expect(fileKind("Dockerfile", "file")).toBe("code");
    expect(fileKind(".gitignore", "file")).toBe("text");
    expect(fileKind(".env", "file")).toBe("text");
    expect(fileKind("mystery", "file")).toBe("unknown");
  });
});

describe("languageForFile", () => {
  test("maps extensions to highlight.js language ids", () => {
    expect(languageForFile("main.ts")).toBe("typescript");
    expect(languageForFile("App.tsx")).toBe("typescript");
    expect(languageForFile("index.mjs")).toBe("javascript");
    expect(languageForFile("Component.jsx")).toBe("javascript");
    expect(languageForFile("styles.scss")).toBe("scss");
    expect(languageForFile("README.md")).toBe("markdown");
    expect(languageForFile("conf.yml")).toBe("yaml");
    expect(languageForFile("Cargo.toml")).toBe("ini");
    expect(languageForFile("deploy.sh")).toBe("bash");
    expect(languageForFile("schema.sql")).toBe("sql");
    expect(languageForFile("Dockerfile")).toBe("dockerfile");
    expect(languageForFile("Makefile")).toBe("makefile");
    expect(languageForFile("patch.diff")).toBe("diff");
  });

  test("every mapped language id is registered with highlight.js", () => {
    const ids = new Set(Object.values(CODE_LANGUAGES));
    expect(ids.size).toBeGreaterThan(15);
    for (const id of ids) {
      expect(`${id}:${highlightLanguageIsRegistered(id)}`).toBe(`${id}:true`);
    }
  });

  test("returns null for text/binary/unknown files", () => {
    expect(languageForFile("notes.txt")).toBeNull();
    expect(languageForFile("logo.png")).toBeNull();
    expect(languageForFile("bundle.zip")).toBeNull();
    expect(languageForFile("LICENSE")).toBeNull();
  });
});

describe("imageMimeFor / rawContentType", () => {
  test("known image extensions map to their mime type", () => {
    expect(imageMimeFor("a.png")).toBe("image/png");
    expect(imageMimeFor("a.JPG")).toBe("image/jpeg");
    expect(imageMimeFor("a.svg")).toBe("image/svg+xml");
    expect(imageMimeFor("a.txt")).toBeNull();
  });

  test("raw downloads are never served as html/js", () => {
    expect(rawContentType("a.png", "image")).toBe("image/png");
    expect(rawContentType("a.md", "markdown")).toBe("text/markdown; charset=utf-8");
    expect(rawContentType("a.ts", "code")).toBe("text/plain; charset=utf-8");
    expect(rawContentType("a.txt", "text")).toBe("text/plain; charset=utf-8");
    expect(rawContentType("index.html", "code")).toBe("text/plain; charset=utf-8");
    expect(rawContentType("app.js", "code")).toBe("text/plain; charset=utf-8");
    expect(rawContentType("a.zip", "binary")).toBe("application/octet-stream");
    expect(rawContentType("mystery", "unknown")).toBe("text/plain; charset=utf-8");
  });
});

describe("isTextKind / shouldHighlight", () => {
  test("text-ish kinds are previewable, others are not", () => {
    expect(isTextKind("markdown")).toBe(true);
    expect(isTextKind("code")).toBe(true);
    expect(isTextKind("text")).toBe(true);
    expect(isTextKind("unknown")).toBe(true);
    expect(isTextKind("image")).toBe(false);
    expect(isTextKind("binary")).toBe(false);
    expect(isTextKind("dir")).toBe(false);
  });

  test("very large files skip highlighting but still preview", () => {
    expect(shouldHighlight(0)).toBe(true);
    expect(shouldHighlight(HIGHLIGHT_MAX_BYTES)).toBe(true);
    expect(shouldHighlight(HIGHLIGHT_MAX_BYTES + 1)).toBe(false);
    expect(FILE_PREVIEW_MAX_BYTES).toBeGreaterThan(HIGHLIGHT_MAX_BYTES);
  });
});

describe("formatBytes", () => {
  test("renders human units", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(10 * 1024)).toBe("10 KB");
    expect(formatBytes(1024 * 1024)).toBe("1 MB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3 GB");
  });
});

describe("path math", () => {
  test("joinPath normalizes slashes", () => {
    expect(joinPath("", "a.ts")).toBe("a.ts");
    expect(joinPath("src", "a.ts")).toBe("src/a.ts");
    expect(joinPath("/src/", "/a.ts")).toBe("src/a.ts");
  });

  test("parentPath walks up to the root", () => {
    expect(parentPath("")).toBe("");
    expect(parentPath("a")).toBe("");
    expect(parentPath("a/b")).toBe("a");
    expect(parentPath("a/b/c.ts")).toBe("a/b");
  });

  test("breadcrumbs accumulate paths, root is empty", () => {
    expect(breadcrumbs("")).toEqual([]);
    expect(breadcrumbs("/src/lib/")).toEqual([
      { name: "src", path: "src" },
      { name: "lib", path: "src/lib" },
    ]);
  });
});

describe("sortBrowseEntries", () => {
  const e = (name: string, type: "dir" | "file"): BrowseEntry => ({
    name,
    path: name,
    type,
    kind: type === "dir" ? "dir" : "text",
    size: null,
    mtimeMs: null,
    language: null,
    mime: null,
  });

  test("folders first, then case-insensitive name order", () => {
    const sorted = sortBrowseEntries([e("b.txt", "file"), e("zed", "dir"), e("a.txt", "file"), e("Alpha", "dir")]);
    expect(sorted.map((x) => x.name)).toEqual(["Alpha", "zed", "a.txt", "b.txt"]);
  });
});

describe("rawFileUrl", () => {
  test("encodes the relative path and optional download flag", () => {
    expect(rawFileUrl("s1", "images/pic 1.png")).toBe(
      "/api/sessions/s1/files/raw?path=images%2Fpic%201.png",
    );
    expect(rawFileUrl("s1", "a.md", { download: true })).toBe(
      "/api/sessions/s1/files/raw?path=a.md&download=1",
    );
  });
});
