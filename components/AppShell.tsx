"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Menu, PanelLeft, TriangleAlert, Activity, FolderTree } from "lucide-react";
import { api, type SessionListItem } from "@/lib/client-api";
import type { ProcessLimits, RunningProcessInfo } from "@/lib/pi/types";
import { MOBILE_QUERY, nextSidebarUser } from "@/lib/layout";
import { sessionProcessStates, type SessionProcessState } from "@/lib/pi/process-state";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useProjects } from "@/hooks/useProjects";
import { cn } from "@/lib/utils";
import { ChatView } from "./ChatView";
import { FileBrowser, type FilePanelMode } from "./FileBrowser";
import { NewSessionModal } from "./NewSessionModal";
import { ProcessPanel, SERVER_PROCESS_KEY } from "./ProcessPanel";
import { Sidebar } from "./Sidebar";

export function AppShell() {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newModal, setNewModal] = useState<{ cwd: string } | null>(null);
  const { projects, refresh: refreshProjects, pin, unpin } = useProjects();
  const [defaultCwd, setDefaultCwd] = useState("");
  const [piInfo, setPiInfo] = useState<{ piVersion: string | null; piAvailable: boolean } | null>(null);
  // Tri-state: null = follow the CSS default (drawer hidden on mobile,
  // panel shown on desktop). Identical on server and first client render,
  // so no hydration mismatch; explicit only after user interaction.
  const [sidebarOpen, setSidebarOpen] = useState<boolean | null>(null);
  const isMobile = useMediaQuery(MOBILE_QUERY);

  // Right-side file browser: always starts collapsed (never restored from
  // storage), independent of the left sidebar's open/closed state.
  const [filesMode, setFilesMode] = useState<FilePanelMode | "closed">("closed");

  // Running pi processes: polled for the strip badge and the process panel.
  const [processes, setProcesses] = useState<RunningProcessInfo[]>([]);
  const [processLimits, setProcessLimits] = useState<ProcessLimits>({
    maxProcesses: 0,
    idleTimeoutMs: 0,
  });
  const [procPanelOpen, setProcPanelOpen] = useState(false);
  const [procLoading, setProcLoading] = useState(false);
  const [procBusyKey, setProcBusyKey] = useState<string | null>(null);

  const loadProcesses = useCallback(async (showSpinner = false) => {
    if (showSpinner) setProcLoading(true);
    try {
      const r = await api<{ processes: RunningProcessInfo[]; limits: ProcessLimits }>(
        "/api/processes",
      );
      if (r.ok && r.data) {
        setProcesses(r.data.processes ?? []);
        if (r.data.limits) setProcessLimits(r.data.limits);
      }
    } catch {
      /* ignore transient */
    } finally {
      if (showSpinner) setProcLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProcesses();
    const t = setInterval(() => void loadProcesses(), 5000);
    return () => clearInterval(t);
  }, [loadProcesses]);

  // Sidebar dots: which sessions have a pi process attached, and whether the
  // agent is working in it. Derived from the same poll as the process panel.
  const processStates = useMemo<Record<string, SessionProcessState>>(
    () => sessionProcessStates(processes),
    [processes],
  );

  const stopProcess = useCallback(
    async (sessionId: string | null, force: boolean) => {
      const what = sessionId === null ? "the server metadata process" : "this pi process";
      const question = force
        ? `Force kill ${what}? In-flight output is lost.`
        : `Stop ${what}? The next prompt respawns it.`;
      if (!confirm(question)) return;
      const key = sessionId ?? SERVER_PROCESS_KEY;
      setProcBusyKey(key);
      try {
        await api("/api/processes/stop", {
          method: "POST",
          body: JSON.stringify({ id: sessionId, force }),
        });
        await loadProcesses();
      } finally {
        setProcBusyKey(null);
      }
    },
    [loadProcesses],
  );

  // On mobile the sidebar is an overlay drawer — dismiss it on navigation.
  const closeDrawerOnMobile = useCallback(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ sessions: SessionListItem[] }>("/api/sessions");
      if (r.ok && r.data) {
        setSessions(r.data.sessions);
        if (!activeId && r.data.sessions.length > 0) {
          setActiveId(r.data.sessions[0].id);
        }
      }
    } catch {
      /* ignore */
    }
  }, [activeId]);

  useEffect(() => {
    void refresh();
    void api<{ defaultCwd: string; piVersion: string | null; piAvailable: boolean }>("/api/health").then(
      (r) => {
        if (r.ok && r.data) {
          setDefaultCwd(r.data.defaultCwd);
          setPiInfo({ piVersion: r.data.piVersion, piAvailable: r.data.piAvailable });
        }
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the sidebar preview fresh when switching sessions.
  useEffect(() => {
    if (!activeId) return;
    const t = setTimeout(() => void refresh(), 2500);
    return () => clearTimeout(t);
  }, [activeId, refresh]);

  // Cmd/Ctrl+Shift+E toggles the file browser (mirrors VS Code's explorer).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.key.toLowerCase() !== "e") return;
      e.preventDefault();
      setFilesMode((m) => (m === "closed" ? "docked" : "closed"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const activeCwd = sessions.find((s) => s.id === activeId)?.cwd ?? "";

  const remove = async (id: string) => {
    if (!confirm("Delete this session? (pi's own session file is kept on disk)")) return;
    await api(`/api/sessions/${id}`, { method: "DELETE" });
    setSessions((s) => s.filter((x) => x.id !== id));
    void refreshProjects();
    if (activeId === id) {
      const rest = sessions.filter((x) => x.id !== id);
      setActiveId(rest[0]?.id ?? null);
    }
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-zinc-950 text-zinc-100">
      {sidebarOpen === true && isMobile && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-[1px] md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}
      <Sidebar
        sessions={sessions}
        projects={projects}
        activeId={activeId}
        open={sidebarOpen}
        processStates={processStates}
        onClose={() => setSidebarOpen(false)}
        onSelect={(id) => {
          setActiveId(id);
          closeDrawerOnMobile();
        }}
        onNew={() => {
          setNewModal({ cwd: defaultCwd });
          closeDrawerOnMobile();
        }}
        onNewInProject={(cwd) => {
          setNewModal({ cwd });
          closeDrawerOnMobile();
        }}
        onDelete={(id) => void remove(id)}
        onPinProject={pin}
        onUnpinProject={(p) => void unpin(p)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Slim top strip */}
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800/60 bg-zinc-950 px-3 py-1.5">
          <button
            onClick={() => setSidebarOpen((prev) => nextSidebarUser(prev, isMobile))}
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
            title="Toggle sidebar"
          >
            {/* CSS-owned so SSR and the first client render agree. */}
            <Menu size={15} className="md:hidden" />
            <PanelLeft size={15} className="hidden md:block" />
          </button>
          <span className="flex items-center gap-1.5 text-[12px] font-semibold tracking-tight">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-zinc-100 text-zinc-950">
              <Bot size={13} />
            </span>
            PiBot
          </span>
          <span className="hidden text-[11px] text-zinc-600 sm:inline">
            Pi agent console · {piInfo?.piVersion ?? "pi --mode rpc"}
          </span>
          {piInfo && !piInfo.piAvailable && (
            <span className="flex items-center gap-1 rounded-md bg-red-500/10 px-2 py-0.5 text-[11px] text-red-300">
              <TriangleAlert size={11} /> pi binary not found — set PI_BINARY
            </span>
          )}
          <button
            type="button"
            onClick={() => setFilesMode((m) => (m === "closed" ? "docked" : "closed"))}
            disabled={!activeId}
            title="Toggle file browser"
            className={cn(
              "ml-auto flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[11.5px] transition disabled:opacity-40",
              filesMode === "closed"
                ? "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                : "bg-zinc-800 text-zinc-100",
            )}
          >
            <FolderTree size={13} />
            <span className="hidden sm:inline">Files</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setProcPanelOpen(true);
              void loadProcesses(true);
            }}
            title="Running pi processes"
            className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[11.5px] text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            <Activity size={13} />
            <span className="hidden sm:inline">Processes</span>
            {processes.length > 0 && (
              <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                {processes.length}
              </span>
            )}
          </button>
        </div>

        {activeId ? (
          <div className="min-h-0 flex-1">
            <ChatView
              key={activeId}
              sessionId={activeId}
              onRenamed={() => {
                void refresh();
                void refreshProjects();
              }}
              onSessionCloned={(id) => {
                void refresh().then(() => setActiveId(id));
                void refreshProjects();
              }}
            />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900">
                <Bot size={20} className="text-zinc-300" />
              </div>
              <h2 className="text-[15px] font-semibold">No session selected</h2>
              <p className="mt-1 text-[12.5px] text-zinc-500">Create one to start chatting with your Pi agent.</p>
              <button
                onClick={() => setNewModal({ cwd: defaultCwd })}
                className="mt-4 rounded-xl bg-zinc-100 px-4 py-2 text-[13px] font-medium text-zinc-950 hover:bg-white"
              >
                New session
              </button>
            </div>
          </div>
        )}
      </div>
      {filesMode !== "closed" && activeId && activeCwd && (
        <FileBrowser
          key={activeId}
          sessionId={activeId}
          cwd={activeCwd}
          mode={filesMode}
          onClose={() => setFilesMode("closed")}
          onCollapse={() => setFilesMode("docked")}
          onExpand={() => setFilesMode("full")}
        />
      )}

      {procPanelOpen && (
        <ProcessPanel
          processes={processes}
          limits={processLimits}
          loading={procLoading}
          busyKey={procBusyKey}
          onStop={(id, force) => void stopProcess(id, force)}
          onRefresh={() => void loadProcesses(true)}
          onClose={() => setProcPanelOpen(false)}
        />
      )}

      {newModal && (
        <NewSessionModal
          defaultCwd={defaultCwd}
          initialCwd={newModal.cwd}
          suggestions={projects.map((p) => p.path)}
          onClose={() => setNewModal(null)}
          onCreated={(id) => {
            setNewModal(null);
            void refresh().then(() => setActiveId(id));
            void refreshProjects();
          }}
        />
      )}
    </div>
  );
}
