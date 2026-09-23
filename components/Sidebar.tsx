"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  FolderGit2,
  FolderPlus,
  Loader2,
  MessageSquarePlus,
  PinOff,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { cn, timeAgo, truncate } from "@/lib/utils";
import { loadCollapsedPaths, saveCollapsedPaths, sidebarTranslateClass } from "@/lib/layout";
import type { SessionProcessState } from "@/lib/control/types";
import type { ProjectInfo as ProjectListItem, SessionListItem } from "@/lib/control/types";
import { FolderPicker } from "./FolderPicker";

/**
 * Dot for a session's attached pi process. `working` pulses (same animation
 * as the streaming cursor); `idle` is a hollow ring, meaning "attached but
 * nothing running". No state ⇒ nothing rendered.
 */
function ProcessDot({ state }: { state?: SessionProcessState }) {
  if (!state) return null;
  const working = state === "working";
  return (
    <span
      role="img"
      aria-label={working ? "Agent working" : "Pi process attached (idle)"}
      title={
        working
          ? "Agent working in this session"
          : "pi process attached — idle, respawns instantly"
      }
      className={cn(
        "h-1.5 w-1.5 shrink-0 rounded-full",
        working ? "streaming-dot bg-success" : "border border-line-focus",
      )}
    />
  );
}

export function Sidebar({
  sessions,
  projects,
  activeId,
  open,
  processStates = {},
  onClose,
  onSelect,
  onNew,
  onNewInProject,
  onDelete,
  onPinProject,
  onUnpinProject,
}: {
  sessions: SessionListItem[];
  projects: ProjectListItem[];
  activeId: string | null;
  open: boolean | null;
  /** Per-session pi process state from the AppShell inventory poll. */
  processStates?: Record<string, SessionProcessState>;
  onClose: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onNewInProject: (cwd: string) => void;
  onDelete: (id: string) => void;
  onPinProject: (path: string) => Promise<string | null>;
  onUnpinProject: (path: string) => void;
}) {
  const [q, setQ] = useState("");
  // SSR-safe: start uncollapsed (matches SSR), hydrate prefs after mount.
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  useEffect(() => {
    setCollapsedPaths(loadCollapsedPaths());
  }, []);
  const [adding, setAdding] = useState(false);
  const [addValue, setAddValue] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addingBusy, setAddingBusy] = useState(false);

  useEffect(() => {
    saveCollapsedPaths(collapsedPaths);
  }, [collapsedPaths]);

  // Always keep the active session's project expanded.
  useEffect(() => {
    if (!activeId) return;
    const s = sessions.find((x) => x.id === activeId);
    if (s && collapsedPaths.has(s.cwd)) {
      setCollapsedPaths((prev) => {
        const next = new Set(prev);
        next.delete(s.cwd);
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const toggle = (cwd: string) =>
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(cwd)) next.delete(cwd);
      else next.add(cwd);
      return next;
    });

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const matchSession = (s: SessionListItem) =>
      !needle ||
      `${s.name} ${s.cwd} ${s.modelId ?? ""} ${s.preview ?? ""}`.toLowerCase().includes(needle);
    const byCwd = new Map<string, SessionListItem[]>();
    for (const s of sessions) {
      if (!matchSession(s)) continue;
      const list = byCwd.get(s.cwd) ?? [];
      list.push(s);
      byCwd.set(s.cwd, list);
    }
    const seen = new Set<string>();
    const out: Array<{ project: ProjectListItem; items: SessionListItem[] }> = [];
    for (const p of projects) {
      seen.add(p.path);
      const items = byCwd.get(p.path) ?? [];
      const projectHit =
        !!needle && `${p.name} ${p.path}`.toLowerCase().includes(needle);
      if (needle && items.length === 0 && !projectHit) continue;
      // A project-name hit shows all of its sessions, not just matching ones.
      out.push({
        project: p,
        items: projectHit
          ? sessions.filter((s) => s.cwd === p.path)
          : items,
      });
    }
    // Safety net: sessions whose folder isn't in the project list (race).
    for (const [cwd, items] of byCwd) {
      if (seen.has(cwd) || items.length === 0) continue;
      const parts = cwd.split("/").filter(Boolean);
      out.push({
        project: {
          path: cwd,
          name: parts[parts.length - 1] || cwd,
          pinned: false,
          missing: false,
          sessionCount: items.length,
          updatedAt: Math.max(...items.map((i) => i.updatedAt)),
        },
        items,
      });
    }
    return out;
  }, [projects, sessions, q]);

  const submitAdd = async () => {
    if (!addValue.trim() || addingBusy) return;
    setAddingBusy(true);
    setAddError(null);
    const err = await onPinProject(addValue.trim());
    setAddingBusy(false);
    if (err) {
      setAddError(err);
      return;
    }
    setAddValue("");
    setAdding(false);
  };

  const searching = q.trim().length > 0;

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex h-full w-[86vw] max-w-[320px] flex-col border-r border-line/80 bg-app transition-transform duration-200 ease-out md:static md:z-auto md:w-[280px] md:max-w-none md:shrink-0 lg:w-[300px]",
        sidebarTranslateClass(open),
      )}
      aria-hidden={open === false}
    >
      <div className="p-3">
        <div className="flex items-center gap-2">
          <button
            onClick={onNew}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-[13.5px] font-medium text-primary-fg transition hover:bg-primary-hover"
          >
            <MessageSquarePlus size={16} />
            New session
          </button>
          <button
            onClick={onClose}
            className="rounded-xl p-2.5 text-fg-subtle transition hover:bg-raised hover:text-fg md:hidden"
            title="Close sidebar"
            aria-label="Close sidebar"
          >
            <X size={16} />
          </button>
        </div>
        <div className="mt-2.5 flex items-center gap-2 rounded-xl bg-panel/70 px-3 py-2">
          <Search size={13} className="shrink-0 text-fg-subtle" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search projects & sessions…"
            className="w-full bg-transparent text-[12.5px] text-fg placeholder:text-fg-faint focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {groups.length === 0 && (
          <div className="px-3 py-8 text-center text-[12.5px] text-fg-faint">
            {sessions.length === 0 && projects.length === 0 && !adding
              ? "No projects yet. Add a folder below to get started."
              : "No matches."}
          </div>
        )}

        {groups.map(({ project, items }) => {
          const isCollapsed = !searching && collapsedPaths.has(project.path);
          const hasActive = items.some((s) => s.id === activeId);
          return (
            <div key={project.path} className="mb-1">
              {/* Project row (level 1) */}
              <div
                className={cn(
                  "group flex cursor-pointer items-start gap-1.5 rounded-xl border px-2 py-2 transition",
                  hasActive ? "border-line-strong/70 bg-panel/70" : "border-transparent hover:bg-panel/50",
                )}
                onClick={() => toggle(project.path)}
              >
                <ChevronDown
                  size={14}
                  className={cn(
                    "mt-0.5 shrink-0 text-fg-subtle transition-transform",
                    isCollapsed && "-rotate-90",
                  )}
                />
                <FolderGit2
                  size={14}
                  className={cn("mt-0.5 shrink-0", project.missing ? "text-warning" : "text-fg-muted")}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-fg">{project.name}</span>
                    <span className="shrink-0 rounded-full bg-raised px-1.5 py-px font-mono text-[10px] text-fg-muted">
                      {project.sessionCount}
                    </span>
                    {project.missing && (
                      <span className="shrink-0 rounded-full bg-warning/10 px-1.5 py-px text-[10px] text-warning-soft">
                        missing
                      </span>
                    )}
                  </div>
                  <div className="truncate font-mono text-[10.5px] text-fg-faint">{project.path}</div>
                </div>
                <div
                  className="flex shrink-0 items-center opacity-0 transition group-hover:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => onNewInProject(project.path)}
                    className="rounded-md p-1 text-fg-subtle transition hover:bg-raised hover:text-fg"
                    title={`New session in ${project.name}`}
                  >
                    <Plus size={13} />
                  </button>
                  {project.pinned && (
                    <button
                      onClick={() => onUnpinProject(project.path)}
                      className="rounded-md p-1 text-fg-faint transition hover:bg-raised hover:text-fg-secondary"
                      title="Unpin project"
                    >
                      <PinOff size={13} />
                    </button>
                  )}
                </div>
              </div>

              {/* Sessions (level 2) */}
              {!isCollapsed && (
                <div className="ml-[17px] mt-1.5 border-l border-line/80 pl-1.5">
                  {items.length === 0 ? (
                    <button
                      onClick={() => onNewInProject(project.path)}
                      className="mt-0.5 flex w-full items-center gap-1.5 rounded-lg px-2.5 py-2 text-left text-[12px] text-fg-faint transition hover:bg-panel/60 hover:text-fg-secondary"
                    >
                      <Plus size={12} />
                      New session here
                    </button>
                  ) : (
                    items.map((s) => {
                      const active = s.id === activeId;
                      return (
                        <div
                          key={s.id}
                          className={cn(
                            "group/s mb-0.5 cursor-pointer rounded-lg border px-2.5 py-2 transition",
                            active ? "border-line-strong bg-panel" : "border-transparent hover:bg-panel/60",
                          )}
                          onClick={() => onSelect(s.id)}
                        >
                          <div className="flex items-start gap-1.5">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <ProcessDot state={processStates[s.id]} />
                                <span
                                  className={cn(
                                    "truncate text-[12.5px] font-medium",
                                    active ? "text-fg" : "text-fg-secondary",
                                  )}
                                >
                                  {s.name}
                                </span>
                              </div>
                              {s.preview && (
                                <div className="mt-0.5 truncate text-[11px] text-fg-subtle">
                                  {truncate(s.preview, 56)}
                                </div>
                              )}
                              <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-fg-subtle">
                                <span>{timeAgo(s.updatedAt)}</span>
                                {s.messageCount > 0 && <span>· {s.messageCount} msgs</span>}
                                {s.modelId && (
                                  <span className="truncate font-mono">· {s.modelId.split("/").pop()}</span>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onDelete(s.id);
                              }}
                              className="rounded-md p-1 text-fg-faint opacity-0 transition hover:bg-raised hover:text-danger group-hover/s:opacity-100"
                              title="Delete session"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Add project */}
        <div className="mt-1 px-0.5">
          {adding ? (
            <div className="rounded-xl border border-line-strong/70 bg-panel/60 p-2.5">
              <FolderPicker
                value={addValue}
                onChange={(path) => {
                  setAddValue(path);
                  setAddError(null);
                }}
                onSubmit={() => void submitAdd()}
                onEscape={() => {
                  setAdding(false);
                  setAddError(null);
                }}
                placeholder="/absolute/path/to/project"
                autoFocus
              />
              {addError && <p className="mt-1.5 text-[11.5px] text-danger-soft">{addError}</p>}
              <div className="mt-2 flex gap-1.5">
                <button
                  onClick={() => void submitAdd()}
                  disabled={addingBusy}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-2 py-1.5 text-[12px] font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-60"
                >
                  {addingBusy && <Loader2 size={12} className="animate-spin" />}
                  Add project
                </button>
                <button
                  onClick={() => {
                    setAdding(false);
                    setAddError(null);
                  }}
                  className="rounded-lg border border-line-strong px-2.5 py-1.5 text-[12px] text-fg-muted hover:bg-raised"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line px-3 py-2 text-[12px] text-fg-subtle transition hover:border-line-strong hover:text-fg-secondary"
            >
              <FolderPlus size={13} />
              Add project folder
            </button>
          )}
        </div>
      </div>

      <div className="border-t border-line/70 px-4 py-2.5 text-[10.5px] text-fg-faint">
        Local-first · sqlite · <span className="font-mono">pi --mode rpc</span>
      </div>
    </aside>
  );
}
