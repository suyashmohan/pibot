"use client";

import { Activity, FolderGit2, Loader2, RefreshCw, ServerCog, X } from "lucide-react";
import { baseName, cn, timeAgo } from "@/lib/utils";
import type { ProcessLimits, RunningProcessInfo } from "@/lib/pi/types";

/** Sentinel busy key for the session-less server process. */
export const SERVER_PROCESS_KEY = "__server__";

function idlePolicy(ms: number): string {
  if (!(ms > 0)) return "never (reaping disabled)";
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}

function ProcessRow({
  p,
  busy,
  onStop,
}: {
  p: RunningProcessInfo;
  busy: boolean;
  onStop: (sessionId: string | null, force: boolean) => void;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="flex items-center gap-2">
        {p.kind === "server" ? (
          <ServerCog size={13} className="shrink-0 text-zinc-500" />
        ) : (
          <FolderGit2 size={13} className="shrink-0 text-zinc-500" />
        )}
        <span className="truncate text-[13px] font-medium text-zinc-200">{p.name}</span>
        {p.kind === "server" && (
          <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide text-zinc-500">
            server
          </span>
        )}
        {p.busy ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9.5px] text-amber-300">
            <Loader2 size={9} className="animate-spin" /> working
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-zinc-800/80 px-1.5 py-0.5 text-[9.5px] text-zinc-500">
            idle
          </span>
        )}
        <span className="ml-auto shrink-0 font-mono text-[10.5px] text-zinc-500">
          pid {p.pid ?? "—"}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-zinc-500">
        <span className="shrink-0 font-mono text-zinc-400">{baseName(p.cwd)}</span>
        <span className="text-zinc-600">·</span>
        <span className="truncate font-mono">{p.cwd}</span>
      </div>

      <div className="mt-2.5 flex items-center gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => onStop(p.sessionId, false)}
          className="rounded-lg border border-zinc-700 px-2.5 py-1 text-[11.5px] text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-50"
          title="Stop gracefully (SIGTERM) — the next prompt respawns it"
        >
          Stop
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onStop(p.sessionId, true)}
          className="rounded-lg border border-red-500/30 px-2.5 py-1 text-[11.5px] text-red-300 transition hover:bg-red-500/10 disabled:opacity-50"
          title="Force kill (SIGKILL) — in-flight output is lost"
        >
          Kill
        </button>
        <span className="ml-auto text-[10.5px] text-zinc-600">
          last active {timeAgo(p.lastActivity)}
        </span>
      </div>
    </div>
  );
}

/**
 * Running pi subprocesses for the whole app: which project/session each one
 * serves, whether it is working, and per-process Stop (SIGTERM) / Kill
 * (SIGKILL). Pure/presentational — AppShell owns polling and the API calls.
 */
export function ProcessPanel({
  processes,
  limits,
  loading,
  busyKey,
  onStop,
  onRefresh,
  onClose,
}: {
  processes: RunningProcessInfo[];
  limits: ProcessLimits;
  loading?: boolean;
  /** Key currently being stopped: a session id or SERVER_PROCESS_KEY. */
  busyKey?: string | null;
  onStop: (sessionId: string | null, force: boolean) => void;
  onRefresh: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="fade-up flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-zinc-800 px-5 py-3.5">
          <Activity size={14} className="text-zinc-400" />
          <h3 className="text-[14px] font-semibold text-zinc-100">Running pi processes</h3>
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 font-mono text-[10.5px] text-zinc-400">
            {processes.length}
            {limits.maxProcesses > 0 ? ` / ${limits.maxProcesses}` : ""}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            title="Refresh"
            className="ml-auto rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            <RefreshCw size={13} className={cn(loading && "animate-spin")} />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {processes.length === 0 ? (
            <p className="px-2 py-10 text-center text-[12.5px] text-zinc-500">
              No pi processes running. They spawn on demand and are reaped when idle.
            </p>
          ) : (
            <div className="space-y-2">
              {processes.map((p) => (
                <ProcessRow
                  key={p.sessionId ?? SERVER_PROCESS_KEY}
                  p={p}
                  busy={busyKey === (p.sessionId ?? SERVER_PROCESS_KEY)}
                  onStop={onStop}
                />
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-zinc-800 px-5 py-2.5 text-[10.5px] text-zinc-500">
          Idle processes are reaped after {idlePolicy(limits.idleTimeoutMs)} · stopped sessions respawn
          on the next prompt.
        </div>
      </div>
    </div>
  );
}
