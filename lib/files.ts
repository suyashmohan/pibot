import path from "node:path";
import { assertBunRuntime } from "./runtime";
import { sortMentionEntries, type MentionEntry } from "./file-mentions";
import {
  FILE_PREVIEW_MAX_BYTES,
  fileKind,
  imageMimeFor,
  languageForFile,
  sortBrowseEntries,
  type BrowseEntry,
} from "./file-browser";

/**
 * Bun-native filesystem helpers (no `node:fs`).
 *
 * Notes:
 * - `node:path` is still used for pure string path math (`join`, `dirname`,
 *   `basename`, `resolve`) — Bun has no equivalent module for that, and it
 *   runs natively under Bun. Only *I/O* goes through Bun APIs.
 * - `Bun.file(path).exists()` only detects files, so directory checks probe
 *   with `Bun.Glob`, which throws ENOENT for missing paths.
 */

/** True when `p` exists and is a directory (false for files and missing paths). */
export async function dirExists(p: string): Promise<boolean> {
  assertBunRuntime("fs");
  try {
    const it = new Bun.Glob("*").scan({ cwd: p });
    await it.next();
    return true;
  } catch {
    return false;
  }
}

/** True when `dir` contains at least one `*.sql` file. */
export async function hasSqlMigrations(dir: string): Promise<boolean> {
  assertBunRuntime("fs");
  try {
    for await (const _ of new Bun.Glob("*.sql").scan({ cwd: dir })) {
      void _;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Max entries returned for one folder (the picker paginates by folder). */
export const MENTION_ENTRY_LIMIT = 300;

/**
 * Absolute path of `dir` inside `root`, or null when it is absolute or
 * escapes the root (`..`). The `@` picker must never browse outside the
 * session working directory.
 */
export function resolveWithinRoot(root: string, dir: string): string | null {
  if (dir.trim().startsWith("/") || path.isAbsolute(dir.trim())) return null;
  const absRoot = path.resolve(root);
  // `turbopackIgnore` opts out of the build-time filesystem tracer: "dir"
  // points into a user's project folder, so bundling the app project would
  // be meaningless (see the Turbopack dynamic-filesystem-access warning).
  const abs = path.resolve(/* turbopackIgnore: true */ absRoot, dir);
  if (abs !== absRoot && !abs.startsWith(absRoot + path.sep)) return null;
  return abs;
}

/**
 * Best starting directory for the sidebar folder picker: the candidate when
 * it exists, else its parent (partially typed paths), else the fallback,
 * else the filesystem root.
 */
export async function resolveBrowseDir(candidate: string, fallback: string): Promise<string> {
  assertBunRuntime("fs");
  const c = candidate.trim();
  if (c) {
    const abs = path.resolve(c);
    if (await dirExists(abs)) return abs;
    const parent = path.dirname(abs);
    // A partially typed path browses its existing parent — unless that parent
    // is the filesystem root, where the fallback (home) is more useful.
    if (parent !== abs && parent !== path.parse(parent).root && (await dirExists(parent))) {
      return parent;
    }
  }
  const f = fallback.trim();
  if (f) {
    const abs = path.resolve(f);
    if (await dirExists(abs)) return abs;
  }
  const parent = c ? path.dirname(path.resolve(c)) : "";
  if (parent && parent !== path.parse(parent).root && (await dirExists(parent))) return parent;
  return "/";
}

/** Direct subdirectories of `absDir` (files skipped), case-insensitive sorted. */
export async function listSubdirectories(absDir: string): Promise<Array<{ name: string; path: string }>> {
  assertBunRuntime("fs");
  const abs = path.resolve(absDir);
  const names: string[] = [];
  try {
    for await (const name of new Bun.Glob("*").scan({ cwd: abs, dot: true, onlyFiles: false })) {
      names.push(name);
    }
  } catch {
    return []; // missing path or a plain file
  }
  const out: Array<{ name: string; path: string }> = [];
  for (const name of names) {
    const entry = path.join(abs, name);
    if (await Bun.file(entry).exists()) continue; // files are never offered
    out.push({ name, path: entry });
  }
  return out.sort(
    (a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.name.localeCompare(b.name),
  );
}

/**
 * One directory level for the `@` mention picker: folders + files, `.git`
 * skipped, dotfiles kept. Returns [] for missing folders or escapes so the
 * UI can show an empty state instead of an error.
 */
export async function listMentionEntries(root: string, dir: string): Promise<MentionEntry[]> {
  assertBunRuntime("fs");
  const abs = resolveWithinRoot(root, dir);
  if (!abs) return [];
  const clean = dir.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  const names: string[] = [];
  try {
    for await (const name of new Bun.Glob("*").scan({ cwd: abs, dot: true, onlyFiles: false })) {
      if (name !== ".git") names.push(name);
    }
  } catch {
    return [];
  }
  const entries: MentionEntry[] = [];
  for (const name of names) {
    const isFile = await Bun.file(path.join(/* turbopackIgnore: true */ abs, name)).exists();
    entries.push({ name, type: isFile ? "file" : "dir", path: clean ? `${clean}/${name}` : name });
  }
  return sortMentionEntries(entries).slice(0, MENTION_ENTRY_LIMIT);
}

/** Max entries returned for one folder by the file browser (defends big dirs). */
export const BROWSE_ENTRY_LIMIT = 2000;

/** One directory level plus whether the limit cut it short. */
export interface BrowseListing {
  entries: BrowseEntry[];
  truncated: boolean;
}

/**
 * One directory level for the right-side file browser: folders + files with
 * size/mtime and a preview kind. `.git` is skipped (same as the `@` picker).
 * Returns an empty listing for missing folders and escapes so the UI can show
 * an empty state instead of an error.
 */
export async function listBrowseEntries(
  root: string,
  dir: string,
  opts: { limit?: number } = {},
): Promise<BrowseListing> {
  assertBunRuntime("fs");
  const limit = opts.limit ?? BROWSE_ENTRY_LIMIT;
  const abs = resolveWithinRoot(root, dir);
  if (!abs) return { entries: [], truncated: false };
  const clean = dir.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  const names: string[] = [];
  try {
    for await (const name of new Bun.Glob("*").scan({ cwd: abs, dot: true, onlyFiles: false })) {
      if (name !== ".git") names.push(name);
    }
  } catch {
    return { entries: [], truncated: false };
  }
  const entries: BrowseEntry[] = [];
  for (const name of names) {
    try {
      const stat = await Bun.file(path.join(/* turbopackIgnore: true */ abs, name)).stat();
      const type = stat.isDirectory() ? "dir" : "file";
      const kind = fileKind(name, type);
      entries.push({
        name,
        path: clean ? `${clean}/${name}` : name,
        type,
        kind,
        size: type === "file" ? stat.size : null,
        mtimeMs: stat.mtimeMs ?? null,
        language: type === "file" ? languageForFile(name) : null,
        mime: kind === "image" ? imageMimeFor(name) : null,
      });
    } catch {
      // Entry vanished between the glob and the stat — skip it.
    }
  }
  const sorted = sortBrowseEntries(entries);
  return { entries: sorted.slice(0, limit), truncated: sorted.length > limit };
}

/** Outcome of a text-preview read. */
export type PreviewStatus = "text" | "binary" | "too-large";

export interface TextPreview {
  status: PreviewStatus;
  /** File contents for `text`, null otherwise. */
  content: string | null;
  size: number;
  mtimeMs: number | null;
}

/**
 * Read a file for preview as UTF-8 text. Binary files (NUL byte in the first
 * 8 KiB) are reported as `binary`, files over `maxBytes` as `too-large` —
 * neither is decoded. Missing files reject with `code: "ENOENT"`.
 */
export async function readTextPreview(
  absPath: string,
  maxBytes: number = FILE_PREVIEW_MAX_BYTES,
): Promise<TextPreview> {
  assertBunRuntime("fs");
  const file = Bun.file(absPath);
  const stat = await file.stat();
  if (!stat.isFile()) {
    const err = new Error("Path is a directory, not a file") as Error & { code?: string };
    err.code = "EISDIR";
    throw err;
  }
  const size = stat.size;
  const mtimeMs = stat.mtimeMs ?? null;
  if (size > maxBytes) return { status: "too-large", content: null, size, mtimeMs };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.subarray(0, 8192).indexOf(0) !== -1) {
    return { status: "binary", content: null, size, mtimeMs };
  }
  return { status: "text", content: new TextDecoder().decode(bytes), size, mtimeMs };
}
