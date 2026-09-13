/**
 * `@` file-mention helpers (pure and client-safe).
 *
 * Conventions match pi's own TUI completion: the `@` is kept in the message
 * (`@src/main.ts `), directories complete to `@src/` and move the picker one
 * level deeper, files complete with a trailing space. Filesystem access lives
 * in `lib/files.ts` (`listMentionEntries`) — never import this module into a
 * server-only path that needs `node:path`.
 */

export interface MentionToken {
  /** Index of the `@` in the message text. */
  start: number;
  /** Text typed after the `@` (may contain `/` to browse folders). */
  query: string;
}

export interface MentionEntry {
  name: string;
  type: "dir" | "file";
  /** Path relative to the session working directory. */
  path: string;
}

/** A mention token may only follow one of these (or the start of the line). */
const DELIMITERS = new Set([" ", "\t", "\n", "\r", '"', "'", "=", "(", "["]);

/**
 * The `@` token the cursor is currently inside, or null. A token ends at
 * whitespace, so once the user types a space the mention is done.
 */
export function mentionToken(text: string, cursor = text.length): MentionToken | null {
  const end = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, end);
  let start = 0;
  for (let i = before.length - 1; i >= 0; i--) {
    if (DELIMITERS.has(before[i]!)) {
      start = i + 1;
      break;
    }
  }
  if (before[start] !== "@") return null;
  const query = before.slice(start + 1);
  if (/[\s@]/.test(query)) return null;
  return { start, query };
}

/** Splits `src/lib/co` into the folder being browsed (`src/lib/`) and the filter (`co`). */
export function splitMentionPath(query: string): { dir: string; filter: string } {
  const i = query.lastIndexOf("/");
  if (i === -1) return { dir: "", filter: query };
  return { dir: query.slice(0, i + 1), filter: query.slice(i + 1) };
}

/** `src/lib/` -> `src/lib`; leading/trailing slashes dropped. */
export function normalizeMentionDir(dir: string): string {
  return dir.trim().replace(/^\/+/, "").replace(/\/+$/, "");
}

/** Parent folder of a relative dir; `""` means the project root. */
export function parentMentionDir(dir: string): string {
  const clean = normalizeMentionDir(dir);
  const i = clean.lastIndexOf("/");
  return i === -1 ? "" : clean.slice(0, i);
}

function applyMention(
  text: string,
  token: MentionToken,
  cursor: number,
  inserted: string,
): { text: string; cursor: number } {
  const before = text.slice(0, token.start);
  const after = text.slice(Math.min(cursor, text.length));
  return { text: before + inserted + after, cursor: (before + inserted).length };
}

/** Replace the `@...` token with the picked file path + trailing space. */
export function applyFileMention(
  text: string,
  token: MentionToken,
  cursor: number,
  relPath: string,
): { text: string; cursor: number } {
  return applyMention(text, token, cursor, `@${relPath} `);
}

/** Replace the token with a folder path (trailing `/`); root stays a bare `@`. */
export function applyDirMention(
  text: string,
  token: MentionToken,
  cursor: number,
  relDir: string,
): { text: string; cursor: number } {
  const clean = normalizeMentionDir(relDir);
  return applyMention(text, token, cursor, clean ? `@${clean}/` : "@");
}

/** Case-insensitive filter; prefix matches rank above substring matches. */
export function filterMentionEntries(entries: readonly MentionEntry[], filter: string): MentionEntry[] {
  const f = filter.trim().toLowerCase();
  if (!f) return [...entries];
  return entries
    .map((entry, order) => {
      const name = entry.name.toLowerCase();
      const rank = name.startsWith(f) ? 0 : name.includes(f) ? 1 : -1;
      return { entry, rank, order };
    })
    .filter((x) => x.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map((x) => x.entry);
}

/** Folders first, then files; case-insensitive alphabetical within a group. */
export function sortMentionEntries(entries: readonly MentionEntry[]): MentionEntry[] {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return (
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
      a.name.localeCompare(b.name)
    );
  });
}
