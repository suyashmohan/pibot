"use client";

import { Activity, FolderGit2, Loader2, RefreshCw, ServerCog, X } from "lucide-react";
import { baseName, cn, timeAgo } from "@/lib/utils";
import type { ProcessLimits, RunningProcessInfo } from "@/lib/control/types";

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
    <div className="rounded-xl border border-line bg-app/60 p-3">
      <div className="flex items-center gap-2">
        {p.kind === "server" ? (
          <ServerCog size={13} className="shrink-0 text-fg-subtle" />
        ) : (
          <FolderGit2 size={13} className="shrink-0 text-fg-subtle" />
        )}
        <span className="truncate text-[13px] font-medium text-fg">{p.name}</span>
        {p.kind === "server" && (
          <span className="rounded-full bg-raised px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide text-fg-subtle">
            server
          </span>
        )}
        {p.busy ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-warning/10 px-1.5 py-0.5 text-[9.5px] text-warning-soft">
            <Loader2 size={9} className="animate-spin" /> working
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-raised/80 px-1.5 py-0.5 text-[9.5px] text-fg-subtle">
            idle
          </span>
        )}
        <span className="ml-auto shrink-0 font-mono text-[10.5px] text-fg-subtle">
          pid {p.pid ?? "—"}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-fg-subtle">
        <span className="shrink-0 font-mono text-fg-muted">{baseName(p.cwd)}</span>
        <span className="text-fg-faint">·</span>
        <span className="truncate font-mono">{p.cwd}</span>
      </div>

      <div className="mt-2.5 flex items-center gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => onStop(p.sessionId, false)}
          className="rounded-lg border border-line-strong px-2.5 py-1 text-[11.5px] text-fg-secondary transition hover:bg-raised hover:text-fg disabled:opacity-50"
          title="Stop gracefully (SIGTERM) — the next prompt respawns it"
        >
          Stop
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onStop(p.sessionId, true)}
          className="rounded-lg border border-danger/30 px-2.5 py-1 text-[11.5px] text-danger-soft transition hover:bg-danger/10 disabled:opacity-50"
          title="Force kill (SIGKILL) — in-flight output is lost"
        >
          Kill
        </button>
        <span className="ml-auto text-[10.5px] text-fg-faint">
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
      className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="fade-up flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
          <Activity size={14} className="text-fg-muted" />
          <h3 className="text-[14px] font-semibold text-fg">Running pi processes</h3>
          <span className="rounded-full bg-raised px-2 py-0.5 font-mono text-[10.5px] text-fg-muted">
            {processes.length}
            {limits.maxProcesses > 0 ? ` / ${limits.maxProcesses}` : ""}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            title="Refresh"
            className="ml-auto rounded-lg p-1.5 text-fg-subtle transition hover:bg-raised hover:text-fg"
          >
            <RefreshCw size={13} className={cn(loading && "animate-spin")} />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="rounded-lg p-1.5 text-fg-subtle transition hover:bg-raised hover:text-fg"
          >
            <X size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {processes.length === 0 ? (
            <p className="px-2 py-10 text-center text-[12.5px] text-fg-subtle">
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

        <div className="border-t border-line px-5 py-2.5 text-[10.5px] text-fg-subtle">
          Idle processes are reaped after {idlePolicy(limits.idleTimeoutMs)} · stopped sessions respawn
          on the next prompt.
        </div>
      </div>
    </div>
  );
}
