/**
 * Git change-summary helpers (pure and client-safe).
 *
 * Parses `git status --porcelain -z` (v1) and `git diff --numstat -z HEAD`
 * into a flat list of changed files with added/removed line counts. No diff
 * text is produced or rendered — the panel is a source-control *file list*.
 *
 * All paths are repository-relative and use forward slashes, so the same
 * implementation works in the browser and on the server. Spawning git lives
 * in `lib/git.ts`.
 */

export type GitChangeKind =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "conflicted"
  | "unknown";

/** One `git status --porcelain` record. */
export interface GitStatusEntry {
  /** Two-character `XY` code (index status, worktree status). */
  code: string;
  /** New path, relative to the repository root. */
  path: string;
  /** Source path for renames/copies, else null. */
  origPath: string | null;
}

/** Added/removed line counts; both null for binaries. */
export interface GitNumstat {
  added: number | null;
  removed: number | null;
}

/** One changed file in the git view. */
export interface GitChangedFile {
  path: string;
  origPath: string | null;
  kind: GitChangeKind;
  /** Change is staged in the index. */
  staged: boolean;
  /** Working tree differs from the index (untracked/conflicted included). */
  unstaged: boolean;
  /** Lines added vs HEAD; null when unknown (binary, unreadable). */
  added: number | null;
  /** Lines removed vs HEAD; null when unknown. */
  removed: number | null;
}

/** Payload of `GET /api/sessions/[id]/git`. */
export interface GitStatusSnapshot {
  /** False when the session folder is not inside a git working tree. */
  isRepo: boolean;
  /** Repository root (absolute), or null when `isRepo` is false. */
  root: string | null;
  /** Current branch; null on a detached HEAD. */
  branch: string | null;
  files: GitChangedFile[];
  added: number;
  removed: number;
  /** True when the file list hit the server cap. */
  truncated: boolean;
  /** Failure from git itself (missing binary, unreadable dir); else null. */
  error: string | null;
}

/**
 * Parse `git status --porcelain -z` (v1). Records are NUL-terminated; rename
 * and copy records carry the source path in the following field.
 */
export function parsePorcelainZ(text: string): GitStatusEntry[] {
  if (!text) return [];
  const fields = text.split("\0");
  const entries: GitStatusEntry[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!;
    if (!field || field.length < 3) continue;
    const code = field.slice(0, 2);
    if (code === "!!") continue; // ignored entries never reach the UI
    const path = field.slice(3);
    if (!path) continue;
    const renamed = code.includes("R") || code.includes("C");
    let origPath: string | null = null;
    if (renamed) {
      origPath = fields[i + 1] ?? null;
      i++;
    }
    entries.push({ code, path, origPath });
  }
  return entries;
}

/**
 * Parse `git diff --numstat -z`. Normal records are `added\tremoved\tpath`;
 * renames split into `added\tremoved\t` + old path + new path, so they are
 * keyed by the new path (the one `git status` reports).
 */
export function parseNumstatZ(text: string): Map<string, GitNumstat> {
  const map = new Map<string, GitNumstat>();
  if (!text) return map;
  const fields = text.split("\0");
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!;
    if (!field) continue;
    const parts = field.split("\t");
    if (parts.length < 3) continue;
    const added = parts[0] === "-" ? null : Number(parts[0]);
    const removed = parts[1] === "-" ? null : Number(parts[1]);
    let path = parts.slice(2).join("\t");
    if (path === "") {
      // Rename record: the paths follow as two separate fields (old, new).
      path = fields[i + 2] ?? "";
      i += 2;
    }
    if (!path) continue;
    map.set(path, {
      added: Number.isFinite(added) ? added : null,
      removed: Number.isFinite(removed) ? removed : null,
    });
  }
  return map;
}

/** Classify a porcelain `XY` code (index + worktree). Conflicted wins. */
export function changeKindFromCode(code: string): GitChangeKind {
  if (code === "??") return "untracked";
  const x = code[0] ?? " ";
  const y = code[1] ?? " ";
  const unmerged =
    x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D");
  if (unmerged) return "conflicted";
  if (x === "R" || y === "R") return "renamed";
  if (x === "C" || y === "C") return "copied";
  if (x === "A" || y === "A") return "added";
  if (x === "D" || y === "D") return "deleted";
  if (x === "M" || y === "M" || x === "T" || y === "T") return "modified";
  return "unknown";
}

/** Single-letter badge for a change kind (VS Code conventions). */
export function statusLetter(kind: GitChangeKind): string {
  switch (kind) {
    case "modified":
      return "M";
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "untracked":
      return "U";
    case "conflicted":
      return "!";
    default:
      return "?";
  }
}

function isStaged(code: string, kind: GitChangeKind): boolean {
  if (kind === "untracked" || kind === "conflicted") return false;
  const x = code[0] ?? " ";
  return x !== " " && x !== "?" && x !== "!";
}

function isUnstaged(code: string, kind: GitChangeKind): boolean {
  if (kind === "untracked" || kind === "conflicted") return true;
  const y = code[1] ?? " ";
  return y !== " " && y !== "?" && y !== "!";
}

function sumNullable(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

/** Folders first is irrelevant here; paths sort case-insensitively. */
export function sortChangedFiles(files: readonly GitChangedFile[]): GitChangedFile[] {
  return [...files].sort(
    (a, b) =>
      a.path.localeCompare(b.path, undefined, { sensitivity: "base" }) ||
      a.path.localeCompare(b.path),
  );
}

/** Worktree status character of a porcelain `XY` code. */
function worktreeCode(code: string): string {
  return code[1] ?? " ";
}

/**
 * Fold two records for the same path. `nextCode` is the incoming entry's
 * porcelain code: when it carries a worktree status the worktree kind wins,
 * otherwise the existing row keeps its kind. `staged`/`unstaged` OR, and the
 * first non-null counts win (the numstat map is keyed by path, so both records
 * resolve the same numbers — summing would double-count).
 */
function mergeChangedFile(
  prev: GitChangedFile,
  next: GitChangedFile,
  nextCode: string,
): GitChangedFile {
  return {
    path: prev.path,
    origPath: prev.origPath ?? next.origPath,
    kind: worktreeCode(nextCode) !== " " ? next.kind : prev.kind,
    staged: prev.staged || next.staged,
    unstaged: prev.unstaged || next.unstaged,
    added: prev.added ?? next.added,
    removed: prev.removed ?? next.removed,
  };
}

/**
 * Merge status records with numstat counts. Untracked files carry no diff
 * stats — `applyUntrackedLines` fills those in from disk afterwards.
 *
 * One path can appear twice: `git rm --cached f` leaves the file on disk, so
 * porcelain emits `D  f` + `?? f`. The panel is a per-file list, and two rows
 * would collide as React keys (and double-count the totals), so records fold
 * by path with the worktree side winning the badge.
 */
export function buildChangedFiles(
  entries: readonly GitStatusEntry[],
  numstat: ReadonlyMap<string, GitNumstat>,
): GitChangedFile[] {
  const byPath = new Map<string, GitChangedFile>();
  for (const entry of entries) {
    const kind = changeKindFromCode(entry.code);
    const stats = numstat.get(entry.path);
    let added = stats?.added ?? null;
    let removed = stats?.removed ?? null;

    if (kind === "renamed" && entry.origPath) {
      // `git status` pairs a rename that `git diff`'s similarity threshold
      // missed, reporting two independent paths. Fold the old path's counts
      // into the entry so the +/- numbers cover the whole rename.
      const old = numstat.get(entry.origPath);
      if (!stats && old) {
        added = old.added;
        removed = old.removed;
      } else if (stats && old) {
        added = sumNullable(stats.added, old.added);
        removed = sumNullable(stats.removed, old.removed);
      }
    }

    const file: GitChangedFile = {
      path: entry.path,
      origPath: entry.origPath,
      kind,
      staged: isStaged(entry.code, kind),
      unstaged: isUnstaged(entry.code, kind),
      added,
      removed,
    };
    const prev = byPath.get(entry.path);
    byPath.set(entry.path, prev ? mergeChangedFile(prev, file, entry.code) : file);
  }
  return sortChangedFiles([...byPath.values()]);
}

/**
 * Fill in disk-read line counts for untracked files (`null` = binary /
 * too large / unreadable). What makes it into the list is decided by the
 * caller, so counts are only read for files that will actually be shown.
 * Mutates and returns the same array.
 */
export function applyUntrackedLines(
  files: GitChangedFile[],
  untrackedLines: ReadonlyMap<string, number | null>,
): GitChangedFile[] {
  for (const file of files) {
    if (file.kind !== "untracked" || !untrackedLines.has(file.path)) continue;
    const lines = untrackedLines.get(file.path) ?? null;
    file.added = lines;
    file.removed = lines === null ? null : 0;
  }
  return files;
}

/** Totals across the visible list; binary/unknown counts contribute 0. */
export function sumLineChanges(files: readonly GitChangedFile[]): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const file of files) {
    added += file.added ?? 0;
    removed += file.removed ?? 0;
  }
  return { added, removed };
}

/** Directory part of a repo-relative path ("" for root-level files). */
export function dirName(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "" : p.slice(0, i);
}
