import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function formatTokens(n?: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

export function formatCost(n?: number | null): string {
  if (n == null) return "—";
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

/**
 * Compact duration for turn timing: "0.4s", "12s", "2m 5s", "1h 30m".
 * Sub-10s keeps one decimal; rounding across a minute boundary prints
 * "1m 0s" instead of a confusing "60s".
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) return `${totalMin}m ${totalSec % 60}s`;
  return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
}

/** Raw token counters as reported by pi's `get_session_stats` (all optional). */
export interface TokenUsageLike {
  input?: number | null;
  output?: number | null;
  cacheRead?: number | null;
  cacheWrite?: number | null;
  total?: number | null;
}

export interface TokenBreakdown {
  /** Full prompt volume: fresh input + cache reads + cache writes. */
  input: number;
  /** Prompt tokens served from the provider cache (cache hit). */
  cached: number;
  /** Prompt tokens not served from cache (cache miss): fresh + cache writes. */
  uncached: number;
  /** Portion of `uncached` persisted into the provider cache. */
  cacheWrite: number;
  output: number;
  total: number;
  /** cached / input, or null when the session shows no cache activity. */
  hitRate: number | null;
}

/**
 * Split raw usage counters into the same cache hit/miss story pi's own
 * `/usage` view tells: `input` is the whole prompt, `cacheRead` the part
 * served from cache, and the rest (fresh input + cache writes) the miss.
 */
export function tokenBreakdown(tokens?: TokenUsageLike | null): TokenBreakdown | null {
  if (!tokens) return null;
  const n = (v?: number | null) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const fresh = n(tokens.input);
  const output = n(tokens.output);
  const cacheRead = n(tokens.cacheRead);
  const cacheWrite = n(tokens.cacheWrite);
  const input = fresh + cacheRead + cacheWrite;
  return {
    input,
    cached: cacheRead,
    uncached: fresh + cacheWrite,
    cacheWrite,
    output,
    total: n(tokens.total) || input + output,
    hitRate: input > 0 && (cacheRead > 0 || cacheWrite > 0) ? cacheRead / input : null,
  };
}

export function truncate(s: string, max = 80): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

/** Last segment of a path — used to label a project folder. Path math only,
 *  so it is safe in client components (no `node:path` import). */
export function baseName(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  if (!trimmed) return "/";
  const parts = trimmed.split("/");
  return parts[parts.length - 1] || "/";
}

export function uid(prefix = ""): string {
  return `${prefix}${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}
