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
} from "lucide-react";
import { cn, timeAgo, truncate } from "@/lib/utils";
import type { ProjectListItem, SessionListItem } from "@/lib/client-api";

const COLLAPSED_KEY = "pibot.project.collapsed";

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function Sidebar({
  sessions,
  projects,
  activeId,
  onSelect,
  onNew,
  onNewInProject,
  onDelete,
  onPinProject,
  onUnpinProject,
  collapsed,
}: {
  sessions: SessionListItem[];
  projects: ProjectListItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onNewInProject: (cwd: string) => void;
  onDelete: (id: string) => void;
  onPinProject: (path: string) => Promise<string | null>;
  onUnpinProject: (path: string) => void;
  collapsed: boolean;
}) {
  const [q, setQ] = useState("");
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(loadCollapsed);
  const [adding, setAdding] = useState(false);
  const [addValue, setAddValue] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addingBusy, setAddingBusy] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsedPaths]));
    } catch {
      /* ignore */
    }
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

  if (collapsed) return null;
  const searching = q.trim().length > 0;

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-r border-zinc-800/80 bg-zinc-950">
      <div className="p-3">
        <button
          onClick={onNew}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-100 px-3 py-2.5 text-[13.5px] font-medium text-zinc-950 transition hover:bg-white"
        >
          <MessageSquarePlus size={16} />
          New session
        </button>
        <div className="mt-2.5 flex items-center gap-2 rounded-xl bg-zinc-900/70 px-3 py-2">
          <Search size={13} className="shrink-0 text-zinc-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search projects & sessions…"
            className="w-full bg-transparent text-[12.5px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {groups.length === 0 && (
          <div className="px-3 py-8 text-center text-[12.5px] text-zinc-600">
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
                  hasActive ? "border-zinc-700/70 bg-zinc-900/70" : "border-transparent hover:bg-zinc-900/50",
                )}
                onClick={() => toggle(project.path)}
              >
                <ChevronDown
                  size={14}
                  className={cn(
                    "mt-0.5 shrink-0 text-zinc-500 transition-transform",
                    isCollapsed && "-rotate-90",
                  )}
                />
                <FolderGit2
                  size={14}
                  className={cn("mt-0.5 shrink-0", project.missing ? "text-amber-400" : "text-zinc-400")}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-zinc-200">{project.name}</span>
                    <span className="shrink-0 rounded-full bg-zinc-800 px-1.5 py-px font-mono text-[10px] text-zinc-400">
                      {project.sessionCount}
                    </span>
                    {project.missing && (
                      <span className="shrink-0 rounded-full bg-amber-500/10 px-1.5 py-px text-[10px] text-amber-300">
                        missing
                      </span>
                    )}
                  </div>
                  <div className="truncate font-mono text-[10.5px] text-zinc-600">{project.path}</div>
                </div>
                <div
                  className="flex shrink-0 items-center opacity-0 transition group-hover:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => onNewInProject(project.path)}
                    className="rounded-md p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
                    title={`New session in ${project.name}`}
                  >
                    <Plus size={13} />
                  </button>
                  {project.pinned && (
                    <button
                      onClick={() => onUnpinProject(project.path)}
                      className="rounded-md p-1 text-zinc-600 transition hover:bg-zinc-800 hover:text-zinc-300"
                      title="Unpin project"
                    >
                      <PinOff size={13} />
                    </button>
                  )}
                </div>
              </div>

              {/* Sessions (level 2) */}
              {!isCollapsed && (
                <div className="ml-[17px] border-l border-zinc-800/80 pl-1.5">
                  {items.length === 0 ? (
                    <button
                      onClick={() => onNewInProject(project.path)}
                      className="mt-0.5 flex w-full items-center gap-1.5 rounded-lg px-2.5 py-2 text-left text-[12px] text-zinc-600 transition hover:bg-zinc-900/60 hover:text-zinc-300"
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
                            active ? "border-zinc-700 bg-zinc-900" : "border-transparent hover:bg-zinc-900/60",
                          )}
                          onClick={() => onSelect(s.id)}
                        >
                          <div className="flex items-start gap-1.5">
                            <div className="min-w-0 flex-1">
                              <div className={cn("truncate text-[12.5px] font-medium", active ? "text-zinc-100" : "text-zinc-300")}>
                                {s.name}
                              </div>
                              {s.preview && (
                                <div className="mt-0.5 truncate text-[11px] text-zinc-600">
                                  {truncate(s.preview, 56)}
                                </div>
                              )}
                              <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-zinc-600">
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
                              className="rounded-md p-1 text-zinc-600 opacity-0 transition hover:bg-zinc-800 hover:text-red-400 group-hover/s:opacity-100"
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
            <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/60 p-2.5">
              <input
                autoFocus
                value={addValue}
                onChange={(e) => {
                  setAddValue(e.target.value);
                  setAddError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitAdd();
                  if (e.key === "Escape") {
                    setAdding(false);
                    setAddError(null);
                  }
                }}
                placeholder="/absolute/path/to/project"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 font-mono text-[12px] text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
              />
              {addError && <p className="mt-1.5 text-[11.5px] text-red-300">{addError}</p>}
              <div className="mt-2 flex gap-1.5">
                <button
                  onClick={() => void submitAdd()}
                  disabled={addingBusy}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-zinc-100 px-2 py-1.5 text-[12px] font-medium text-zinc-950 hover:bg-white disabled:opacity-60"
                >
                  {addingBusy && <Loader2 size={12} className="animate-spin" />}
                  Add project
                </button>
                <button
                  onClick={() => {
                    setAdding(false);
                    setAddError(null);
                  }}
                  className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-[12px] text-zinc-400 hover:bg-zinc-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-800 px-3 py-2 text-[12px] text-zinc-500 transition hover:border-zinc-700 hover:text-zinc-300"
            >
              <FolderPlus size={13} />
              Add project folder
            </button>
          )}
        </div>
      </div>

      <div className="border-t border-zinc-800/70 px-4 py-2.5 text-[10.5px] text-zinc-600">
        Local-first · sqlite · <span className="font-mono">pi --mode rpc</span>
      </div>
    </aside>
  );
}
