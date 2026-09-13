import path from "node:path";
import { assertBunRuntime } from "./runtime";
import { sortMentionEntries, type MentionEntry } from "./file-mentions";

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
  const abs = path.resolve(absRoot, dir);
  if (abs !== absRoot && !abs.startsWith(absRoot + path.sep)) return null;
  return abs;
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
    const isFile = await Bun.file(path.join(abs, name)).exists();
    entries.push({ name, type: isFile ? "file" : "dir", path: clean ? `${clean}/${name}` : name });
  }
  return sortMentionEntries(entries).slice(0, MENTION_ENTRY_LIMIT);
}
