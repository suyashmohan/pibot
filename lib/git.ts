import path from "node:path";
import { dirExists } from "./files";
import {
  applyUntrackedLines,
  buildChangedFiles,
  parseNumstatZ,
  parsePorcelainZ,
  sumLineChanges,
  type GitNumstat,
  type GitStatusSnapshot,
} from "./git-status";
import { assertBunRuntime } from "./runtime";

/**
 * Bun-native git helpers (no `node:fs`, no shell).
 *
 * Git is spawned directly — never through pi — so the git rail stays a pure
 * read path: opening it must not start (or talk to) a coding-agent process.
 * All arguments are passed as an array (no shell interpolation).
 */

/** Max changed files returned for one session (defends huge change sets). */
export const GIT_STATUS_FILE_LIMIT = 500;

/** Untracked files above this size report unknown line counts. */
const MAX_UNTRACKED_COUNT_BYTES = 5_000_000;

export interface GitRunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run `git <args>` in `cwd`. Spawn failures (missing binary or cwd) come back
 * as `ok: false` with the OS message instead of throwing, so the rail can
 * render an explanation.
 */
export async function runGit(args: string[], cwd: string): Promise<GitRunResult> {
  assertBunRuntime("git");
  try {
    const proc = Bun.spawn(["git", ...args], {
      cwd,
      // Bun.spawn does not inherit post-start env mutations — pass explicitly.
      env: { ...process.env },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { ok: code === 0, code, stdout, stderr };
  } catch (err) {
    return {
      ok: false,
      code: null,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Non-negative line count for an untracked file, or null when it is binary,
 * missing, too large or unreadable. A trailing newline does not add a line.
 */
async function countFileLines(absPath: string): Promise<number | null> {
  try {
    const file = Bun.file(absPath);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_UNTRACKED_COUNT_BYTES) return null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.subarray(0, 8192).indexOf(0) !== -1) return null;
    if (bytes.length === 0) return 0;
    let lines = 0;
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0x0a) lines++;
    }
    if (bytes[bytes.length - 1] !== 0x0a) lines++;
    return lines;
  } catch {
    return null;
  }
}

export interface GitStatusOptions {
  /** Cap on returned files (tests use a small value). */
  limit?: number;
  /** Injectable runner for tests. */
  run?: (args: string[], cwd: string) => Promise<GitRunResult>;
}

function notRepo(error: string | null): GitStatusSnapshot {
  return {
    isRepo: false,
    root: null,
    branch: null,
    files: [],
    added: 0,
    removed: 0,
    truncated: false,
    error,
  };
}

/**
 * Working-tree changes vs HEAD (staged + unstaged + untracked) for `cwd`,
 * with per-file +/- counts and no diff text. Never throws: a non-repo folder
 * is `isRepo: false` with `error: null`; an unusable folder or missing git
 * carries the failure in `error`.
 */
export async function readGitStatus(
  cwd: string,
  opts: GitStatusOptions = {},
): Promise<GitStatusSnapshot> {
  assertBunRuntime("git");
  const limit = opts.limit ?? GIT_STATUS_FILE_LIMIT;
  const run = opts.run ?? runGit;

  if (!(await dirExists(cwd))) return notRepo("Working directory not found");

  const inside = await run(["rev-parse", "--is-inside-work-tree"], cwd);
  if (!inside.ok || inside.stdout.trim() !== "true") {
    // Spawn failure (code null) is a real error; a normal non-zero exit just
    // means "not a git repository".
    return notRepo(inside.code === null ? inside.stderr.trim() || "git is not available" : null);
  }

  const rootRes = await run(["rev-parse", "--show-toplevel"], cwd);
  const root = rootRes.ok && rootRes.stdout.trim() ? rootRes.stdout.trim() : cwd;

  const branchRes = await run(["symbolic-ref", "--short", "HEAD"], cwd);
  const branch = branchRes.ok ? branchRes.stdout.trim() || null : null;

  const statusRes = await run(["status", "--porcelain", "-z", "--untracked-files=all"], cwd);
  if (!statusRes.ok) {
    return {
      isRepo: true,
      root,
      branch,
      files: [],
      added: 0,
      removed: 0,
      truncated: false,
      error: statusRes.stderr.trim() || "git status failed",
    };
  }

  const entries = parsePorcelainZ(statusRes.stdout);
  // `git diff HEAD` fails on a repo with no commits (unborn HEAD); everything
  // is untracked then, and untracked counts come from disk instead.
  const diffRes = await run(["diff", "--numstat", "-z", "HEAD"], cwd);
  const numstat: Map<string, GitNumstat> = diffRes.ok
    ? parseNumstatZ(diffRes.stdout)
    : new Map();

  // Truncate first, then read line counts for the untracked files that are
  // actually shown: a huge untracked tree must not cost thousands of reads.
  const files = buildChangedFiles(entries, numstat).slice(0, limit);
  const untrackedLines = new Map<string, number | null>();
  for (const file of files) {
    if (file.kind !== "untracked") continue;
    const abs = path.join(/* turbopackIgnore: true */ root, file.path);
    untrackedLines.set(file.path, await countFileLines(abs));
  }
  applyUntrackedLines(files, untrackedLines);

  const { added, removed } = sumLineChanges(files);
  return {
    isRepo: true,
    root,
    branch,
    files,
    added,
    removed,
    truncated: entries.length > limit,
    error: null,
  };
}
