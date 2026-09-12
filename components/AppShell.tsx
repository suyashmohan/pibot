"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Menu, TriangleAlert } from "lucide-react";
import { api, type SessionListItem } from "@/lib/client-api";
import { useProjects } from "@/hooks/useProjects";
import { ChatView } from "./ChatView";
import { NewSessionModal } from "./NewSessionModal";
import { Sidebar } from "./Sidebar";

export function AppShell() {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newModal, setNewModal] = useState<{ cwd: string } | null>(null);
  const { projects, refresh: refreshProjects, pin, unpin } = useProjects();
  const [defaultCwd, setDefaultCwd] = useState("");
  const [piInfo, setPiInfo] = useState<{ piVersion: string | null; piAvailable: boolean } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

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
    <div className="flex h-screen overflow-hidden bg-zinc-950 text-zinc-100">
      <Sidebar
        sessions={sessions}
        projects={projects}
        activeId={activeId}
        collapsed={!sidebarOpen}
        onSelect={setActiveId}
        onNew={() => setNewModal({ cwd: defaultCwd })}
        onNewInProject={(cwd) => setNewModal({ cwd })}
        onDelete={(id) => void remove(id)}
        onPinProject={pin}
        onUnpinProject={(p) => void unpin(p)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Slim top strip */}
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800/60 bg-zinc-950 px-3 py-1.5">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
            title="Toggle sidebar"
          >
            <Menu size={15} />
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
