"use client";

import { useEffect } from "react";
import { GitBranch, Loader2, Maximize2, Minimize2, RefreshCw, X } from "lucide-react";
import { useGitStatus } from "@/hooks/useGitStatus";
import {
  dirName,
  statusLetter,
  type GitChangeKind,
  type GitChangedFile,
  type GitStatusSnapshot,
} from "@/lib/git-status";
import { baseName, cn } from "@/lib/utils";
import { PanelIconButton, rightPanelClass, type RightPanelMode } from "./RightPanel";

/** Badge color per change kind (semantic token utilities only). */
const KIND_COLOR: Record<GitChangeKind, string> = {
  modified: "text-warning-soft",
  added: "text-success",
  deleted: "text-danger-soft",
  renamed: "text-accent",
  copied: "text-accent",
  untracked: "text-success",
  conflicted: "text-danger",
  unknown: "text-fg-subtle",
};

function ChangeRow({ file }: { file: GitChangedFile }) {
  const dir = dirName(file.path);
  return (
    <li
      data-path={file.path}
      data-kind={file.kind}
      className="flex items-center gap-2 px-3 py-1.5 transition hover:bg-raised/60"
    >
      <span
        className={cn(
          "w-3 shrink-0 text-center font-mono text-[11px] font-semibold",
          KIND_COLOR[file.kind],
        )}
        title={file.kind}
      >
        {statusLetter(file.kind)}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px]" title={file.path}>
        {dir && <span className="text-fg-faint">{dir}/</span>}
        <span className="text-fg">{baseName(file.path)}</span>
      </span>
      {file.origPath && (
        <span className="shrink-0 text-[10.5px] text-fg-faint" title={file.origPath}>
          {`← ${baseName(file.origPath)}`}
        </span>
      )}
      <span className="shrink-0 font-mono text-[10.5px]">
        {file.added === null ? (
          <span className="text-fg-faint" title="Binary or unreadable">
            —
          </span>
        ) : (
          <span className="text-success">{`+${file.added}`}</span>
        )}
      </span>
      <span className="shrink-0 font-mono text-[10.5px]">
        {file.removed === null ? (
          <span className="text-fg-faint" title="Binary or unreadable">
            —
          </span>
        ) : (
          <span className="text-danger-soft">{`−${file.removed}`}</span>
        )}
      </span>
    </li>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-12 text-center text-[12px]">{children}</div>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Centered>
      <p className="text-danger-soft">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-lg border border-line-strong px-3 py-1.5 text-[11.5px] text-fg-secondary transition hover:bg-raised"
      >
        Retry
      </button>
    </Centered>
  );
}

/**
 * Body of the git rail: the change list, or one of the explanatory states.
 * Presentational — `GitPanel` owns fetching so this renders under SSR.
 */
export function GitPanelBody({
  status,
  loading,
  error,
  cwd,
  onRetry,
}: {
  status: GitStatusSnapshot | null;
  loading: boolean;
  error: string | null;
  cwd: string;
  onRetry: () => void;
}) {
  if (error) return <ErrorState message={error} onRetry={onRetry} />;

  if (!status) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-[12px] text-fg-subtle">
        <Loader2 size={14} className={cn(loading && "animate-spin")} /> Loading…
      </div>
    );
  }

  if (!status.isRepo) {
    return (
      <Centered>
        <p className="text-fg-secondary">Not a git repository</p>
        <p className="mt-1.5 break-all font-mono text-[10.5px] text-fg-faint" title={cwd}>
          {cwd}
        </p>
        <p className="mt-1 text-[11.5px] text-fg-faint">
          This folder is not inside a git working tree.
        </p>
      </Centered>
    );
  }

  if (status.error) return <ErrorState message={status.error} onRetry={onRetry} />;

  if (status.files.length === 0) {
    return (
      <Centered>
        <p className="text-fg-secondary">No changes</p>
        <p className="mt-1.5 text-[11.5px] text-fg-faint">Working tree is clean.</p>
      </Centered>
    );
  }

  return (
    <>
      <ul className="py-1">
        {status.files.map((file) => (
          <ChangeRow key={file.path} file={file} />
        ))}
      </ul>
      <div className="border-t border-line/60 px-3 py-2 text-[10.5px] text-fg-subtle">
        <span>
          {`${status.files.length} ${status.files.length === 1 ? "file" : "files"} · `}
          <span className="font-mono text-success">{`+${status.added}`}</span>{" "}
          <span className="font-mono text-danger-soft">{`−${status.removed}`}</span>
        </span>
      </div>
      {status.truncated && (
        <p className="px-3 pb-3 text-center text-[10.5px] text-warning/80">
          Showing the first {status.files.length} changed files.
        </p>
      )}
    </>
  );
}

/**
 * Right-hand git rail for the active session: changed files with +/- line
 * counts (no diff text). Shares the file browser's slot and footprint — only
 * one of the two is ever mounted. Refreshes on its own (and via the header
 * button), so it can stay open while the agent edits.
 */
export function GitPanel({
  sessionId,
  cwd,
  mode,
  onClose,
  onCollapse,
  onExpand,
}: {
  sessionId: string;
  cwd: string;
  mode: RightPanelMode;
  onClose: () => void;
  onCollapse: () => void;
  onExpand: () => void;
}) {
  const { status, loading, refreshing, error, reload } = useGitStatus(sessionId);

  // Escape unwinds one layer at a time, mirroring the file browser:
  // full → docked → closed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing) return;
      if (mode === "full") onCollapse();
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onCollapse, onClose]);

  return (
    <aside aria-label="Git changes" className={rightPanelClass(mode)}>
      <div className="flex shrink-0 items-center gap-1 border-b border-line/80 bg-app px-2 py-1.5">
        <GitBranch size={13} className="shrink-0 text-fg-subtle" />
        <span
          className="min-w-0 flex-1 truncate text-[11.5px] text-fg-muted"
          title="Working tree changes vs HEAD"
        >
          {status?.branch ?? "Changes"}
        </span>
        {status?.isRepo && status.files.length > 0 && (
          <span className="shrink-0 rounded-full bg-raised px-1.5 py-0.5 font-mono text-[10px] text-fg-secondary">
            {status.files.length}
          </span>
        )}
        <PanelIconButton title="Refresh changes" onClick={reload} className="shrink-0">
          <RefreshCw size={13} className={cn((loading || refreshing) && "animate-spin")} />
        </PanelIconButton>
        {mode === "full" ? (
          <PanelIconButton title="Collapse to side panel" onClick={onCollapse} className="shrink-0">
            <Minimize2 size={13} />
          </PanelIconButton>
        ) : (
          <PanelIconButton
            title="Expand to full size"
            onClick={onExpand}
            className="hidden shrink-0 md:flex"
          >
            <Maximize2 size={13} />
          </PanelIconButton>
        )}
        <PanelIconButton title="Close git changes" onClick={onClose} className="shrink-0">
          <X size={14} />
        </PanelIconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <GitPanelBody status={status} loading={loading} error={error} cwd={cwd} onRetry={reload} />
      </div>
    </aside>
  );
}
