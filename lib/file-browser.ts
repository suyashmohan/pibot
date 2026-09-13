/**
 * File-browser helpers (pure and client-safe).
 *
 * All path math here is relative to a session working directory and uses
 * forward slashes only, so a single implementation works in the browser and
 * on the server. Filesystem access lives in `lib/files.ts`.
 *
 * `.git` is skipped in listings to match the composer's `@` picker; hidden
 * files are otherwise shown (`.env`, `.gitignore`, …).
 */

export type FileKind = "dir" | "image" | "markdown" | "code" | "text" | "binary" | "unknown";
export type FileView = "list" | "gallery";
export type EntryType = "dir" | "file";

/** One directory level, as returned by `GET …/files/browse`. */
export interface BrowseEntry {
  name: string;
  /** Path relative to the session working directory. */
  path: string;
  type: EntryType;
  kind: FileKind;
  /** Bytes for files, null for directories. */
  size: number | null;
  mtimeMs: number | null;
  /** highlight.js language id when `kind` is code/markdown-like. */
  language: string | null;
  /** MIME type for images, null otherwise (authoritative type comes from `raw`). */
  mime: string | null;
}

/** Hard cap on the bytes a text preview will load into the browser. */
export const FILE_PREVIEW_MAX_BYTES = 1_000_000;
/** Above this size a preview renders as plain (unhighlighted) text. */
export const HIGHLIGHT_MAX_BYTES = 200_000;

/** Payload of `GET …/files/content` — everything a preview surface renders. */
export interface FilePreviewData {
  path: string;
  name: string;
  kind: FileKind;
  language: string | null;
  mime: string | null;
  status: "text" | "binary" | "too-large";
  /** File contents for `status: "text"`, null otherwise. */
  content: string | null;
  size: number;
  mtimeMs: number | null;
}

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
};

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdx", "mdown", "mkd"]);

const TEXT_EXTENSIONS = new Set([
  "txt",
  "text",
  "log",
  "csv",
  "tsv",
  "rst",
  "org",
  "adoc",
  "rtf",
]);

const BINARY_EXTENSIONS = new Set([
  "zip",
  "gz",
  "tgz",
  "tar",
  "bz2",
  "xz",
  "zst",
  "7z",
  "rar",
  "jar",
  "war",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "odt",
  "ods",
  "wasm",
  "exe",
  "dll",
  "so",
  "dylib",
  "bin",
  "dat",
  "class",
  "pyc",
  "o",
  "a",
  "obj",
  "lib",
  "lockb",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "mp3",
  "wav",
  "ogg",
  "oga",
  "flac",
  "m4a",
  "aac",
  "mp4",
  "m4v",
  "mov",
  "avi",
  "mkv",
  "webm",
  "sqlite",
  "sqlite3",
  "db",
  "realm",
]);

/** File extension (lowercased, no dot) → highlight.js language id. */
export const CODE_LANGUAGES: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  json: "json",
  jsonc: "json",
  json5: "json",
  css: "css",
  scss: "scss",
  less: "less",
  html: "xml",
  htm: "xml",
  xml: "xml",
  svg: "xml",
  vue: "xml",
  svelte: "xml",
  py: "python",
  pyi: "python",
  rb: "ruby",
  erb: "erb",
  php: "php",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  cs: "csharp",
  swift: "swift",
  m: "objectivec",
  mm: "objectivec",
  scala: "scala",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ksh: "bash",
  fish: "bash",
  ps1: "powershell",
  psm1: "powershell",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  properties: "properties",
  env: "ini",
  sql: "sql",
  pgsql: "pgsql",
  graphql: "graphql",
  gql: "graphql",
  proto: "protobuf",
  lua: "lua",
  r: "r",
  pl: "perl",
  pm: "perl",
  hs: "haskell",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  clj: "clojure",
  cljs: "clojure",
  dart: "dart",
  groovy: "groovy",
  gradle: "gradle",
  cmake: "cmake",
  nix: "nix",
  diff: "diff",
  patch: "diff",
  tex: "latex",
  vim: "vim",
  nginx: "nginx",
  v: "verilog",
  sv: "verilog",
  vhd: "vhdl",
  asm: "x86asm",
  s: "x86asm",
  tf: "ini",
  hcl: "ini",
};

/** Exact (lowercased) file names that carry a known language. */
const CODE_FILENAMES: Record<string, string> = {
  dockerfile: "dockerfile",
  containerfile: "dockerfile",
  makefile: "makefile",
  gnumakefile: "makefile",
  justfile: "makefile",
  "cmakelists.txt": "cmake",
  gemfile: "ruby",
  rakefile: "ruby",
  "go.mod": "go",
  "go.sum": "plaintext",
};

const TEXT_FILENAMES = new Set([
  "license",
  "licence",
  "copying",
  "notice",
  "changelog",
  "changes",
  "authors",
  "contributors",
  "readme",
  "todo",
  "version",
  "patents",
]);

/** Lowercased extension after the last dot; "" when there is none. */
export function fileExtension(name: string): string {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const i = base.lastIndexOf(".");
  // A leading dot (".gitignore") is not an extension.
  if (i <= 0) return "";
  return base.slice(i + 1).toLowerCase();
}

/** highlight.js language id for a file name, or null when there is none. */
export function languageForFile(name: string): string | null {
  const base = name.slice(name.lastIndexOf("/") + 1).toLowerCase();
  const byName = CODE_FILENAMES[base];
  if (byName) return byName === "plaintext" ? null : byName;
  const ext = fileExtension(base);
  if (!ext) return null;
  const byExt = CODE_LANGUAGES[ext];
  if (byExt) return byExt; // includes svg → xml
  if (MARKDOWN_EXTENSIONS.has(ext)) return "markdown";
  return null;
}

/** Classify a directory entry from its name + type (no I/O). */
export function fileKind(name: string, type: EntryType): FileKind {
  if (type === "dir") return "dir";
  const base = name.slice(name.lastIndexOf("/") + 1).toLowerCase();
  const ext = fileExtension(base);
  if (IMAGE_MIME[ext]) return "image";
  if (MARKDOWN_EXTENSIONS.has(ext)) return "markdown";
  if (ext && CODE_LANGUAGES[ext]) return "code";
  if (TEXT_FILENAMES.has(base)) return "text";
  if (CODE_FILENAMES[base]) return "code";
  if (BINARY_EXTENSIONS.has(ext)) return "binary";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  // `.env`, `.gitignore`, `.npmrc`, … — dotfiles with no further extension
  if (base.startsWith(".") && base.lastIndexOf(".") === 0) return "text";
  return "unknown";
}

/** MIME type for a known image extension, else null. */
export function imageMimeFor(name: string): string | null {
  return IMAGE_MIME[fileExtension(name)] ?? null;
}

/** Text-ish kinds can be opened in the preview (content may still be binary). */
export function isTextKind(kind: FileKind): boolean {
  return kind === "code" || kind === "markdown" || kind === "text" || kind === "unknown";
}

/** Highlighting very large files would block the browser; render them plain. */
export function shouldHighlight(size: number): boolean {
  return size <= HIGHLIGHT_MAX_BYTES;
}

/**
 * Content-Type for the `raw` endpoint. Deliberately *never* returns
 * `text/html` or a script type: a downloaded file opened in a tab must not
 * run as same-origin code.
 */
export function rawContentType(name: string, kind: FileKind): string {
  if (kind === "image") return imageMimeFor(name) ?? "application/octet-stream";
  if (kind === "markdown") return "text/markdown; charset=utf-8";
  if (isTextKind(kind)) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

/** Human byte size; `null`/negative render as an em dash. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return `${rounded} ${units[unit]}`;
}

/** Join a relative directory and a child name, normalizing stray slashes. */
export function joinPath(dir: string, name: string): string {
  const clean = dir.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  const child = name.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!clean) return child;
  if (!child) return clean;
  return `${clean}/${child}`;
}

/** Parent of a relative path; "" is the project root. */
export function parentPath(p: string): string {
  const clean = p.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  const i = clean.lastIndexOf("/");
  return i <= 0 ? "" : clean.slice(0, i);
}

/** Root-first breadcrumb chain for a relative directory. */
export function breadcrumbs(dir: string): Array<{ name: string; path: string }> {
  const clean = dir.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!clean) return [];
  const out: Array<{ name: string; path: string }> = [];
  let acc = "";
  for (const part of clean.split("/")) {
    if (!part) continue;
    acc = acc ? `${acc}/${part}` : part;
    out.push({ name: part, path: acc });
  }
  return out;
}

/** Folders first, then case-insensitive alphabetical (stable tiebreak). */
export function sortBrowseEntries(entries: readonly BrowseEntry[]): BrowseEntry[] {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return (
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
      a.name.localeCompare(b.name)
    );
  });
}

/** URL for the raw file (thumbnails, full image view, downloads). */
export function rawFileUrl(
  sessionId: string,
  path: string,
  opts: { download?: boolean } = {},
): string {
  const base = `/api/sessions/${encodeURIComponent(sessionId)}/files/raw?path=${encodeURIComponent(path)}`;
  return opts.download ? `${base}&download=1` : base;
}
