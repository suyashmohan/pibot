import { assertBunRuntime } from "./runtime";

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
