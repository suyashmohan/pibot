"use client";

import { useEffect, useRef, useState } from "react";
import {
  Braces,
  ChevronDown,
  Copy,
  Download,
  Eraser,
  FolderGit2,
  GitFork,
  Loader2,
  Pencil,
  Shrink,
  Sparkles,
  TerminalSquare,
} from "lucide-react";
import { api } from "@/lib/client-api";
import { usePiSession } from "@/hooks/usePiSession";
import { cn, formatCost, formatTokens, truncate } from "@/lib/utils";
import { Composer, type OutgoingImage } from "./Composer";
import { MessageItem } from "./MessageItem";
import { ModelPicker } from "./ModelPicker";
import { DialogModal, Toasts } from "./Overlays";
import type { PiModel } from "@/lib/pi/types";

function useAutoScroll(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [dep]);
  return {
    ref,
    onScroll: () => {
      const el = ref.current;
      if (!el) return;
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    },
    jumpToBottom: () => {
      const el = ref.current;
      if (el) {
        stick.current = true;
        el.scrollTop = el.scrollHeight;
      }
    },
  };
}

export function ChatView({
  sessionId,
  onRenamed,
  onSessionCloned,
}: {
  sessionId: string;
  onRenamed: () => void;
  onSessionCloned: (id: string) => void;
}) {
  const s = usePiSession(sessionId);
  const scroll = useAutoScroll([s.messages.length, s.streaming]);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [showCmds, setShowCmds] = useState(false);
  const [showBash, setShowBash] = useState(false);
  const [bashCmd, setBashCmd] = useState("");
  const [bashOut, setBashOut] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    scroll.jumpToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const send = async (text: string, images: OutgoingImage[], mode: "direct" | "steer" | "follow_up") => {
    const payload =
      mode === "direct"
        ? { message: text, images: images.length ? images.map((i) => ({ type: "image" as const, data: i.data, mimeType: i.mimeType })) : undefined }
        : { message: text, images: images.length ? images.map((i) => ({ type: "image" as const, data: i.data, mimeType: i.mimeType })) : undefined, mode };
    const r = await api(`/api/sessions/${sessionId}/prompt`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      // Agent busy without queue mode -> retry automatically as steer.
      if (mode === "direct") {
        const retry = await api(`/api/sessions/${sessionId}/prompt`, {
          method: "POST",
          body: JSON.stringify({ ...payload, streamingBehavior: "steer" }),
        });
        if (!retry.ok) s.pushToast("error", retry.error ?? "Failed to send");
      } else {
        s.pushToast("error", r.error ?? "Failed to send");
      }
    }
    // Belt-and-suspenders: show the accepted user message promptly even if
    // the SSE stream hiccups (stream events will reconcile right after).
    setTimeout(() => void s.refreshMessages(), 800);
    scroll.jumpToBottom();
  };

  const control = async (action: string, extra?: Record<string, unknown>) => {
    setBusy(action);
    try {
      const r = await api(`/api/sessions/${sessionId}/control`, {
        method: "POST",
        body: JSON.stringify({ action, ...extra }),
      });
      if (!r.ok) s.pushToast("error", r.error ?? `${action} failed`);
      else if (action === "compact") s.pushToast("info", "Compaction requested.");
      if (action === "clear_queue") void s.refreshMessages();
      return r;
    } finally {
      setBusy(null);
    }
  };

  const pickModel = async (m: PiModel) => {
    const r = await api(`/api/sessions/${sessionId}/model`, {
      method: "POST",
      body: JSON.stringify({ provider: m.provider, modelId: m.id }),
    });
    if (!r.ok) s.pushToast("error", r.error ?? "Model switch failed");
    else {
      s.pushToast("info", `Model → ${String(m.provider ?? "")}/${m.id}`);
      void s.refreshStats();
    }
  };

  const pickThinking = async (level: string) => {
    const r = await api(`/api/sessions/${sessionId}/model`, {
      method: "POST",
      body: JSON.stringify({ level }),
    });
    if (!r.ok) s.pushToast("error", r.error ?? "Thinking switch failed");
    else void s.refreshStats();
  };

  const saveName = async () => {
    if (!nameDraft.trim()) {
      setEditingName(false);
      return;
    }
    const r = await api(`/api/sessions/${sessionId}`, {
      method: "PATCH",
      body: JSON.stringify({ name: nameDraft.trim() }),
    });
    if (!r.ok) s.pushToast("error", r.error ?? "Rename failed");
    else {
      s.setMeta((m) => (m ? { ...m, name: nameDraft.trim() } : m));
      onRenamed();
    }
    setEditingName(false);
  };

  const runBash = async () => {
    if (!bashCmd.trim()) return;
    setBashOut("Running…");
    const r = await api<{ result?: { output?: string; exitCode?: number } }>(
      `/api/sessions/${sessionId}/bash`,
      { method: "POST", body: JSON.stringify({ command: bashCmd }) },
    );
    if (!r.ok) setBashOut(`Error: ${r.error}`);
    else setBashOut(r.data?.result?.output ?? `(exit ${r.data?.result?.exitCode ?? "?"})`);
  };

  const lifecycle = async (op: string, extra?: Record<string, unknown>) => {
    setBusy(op);
    try {
      const r = await api<{ clonedSession?: { id: string } }>(`/api/sessions/${sessionId}/lifecycle`, {
        method: "POST",
        body: JSON.stringify({ op, ...extra }),
      });
      if (!r.ok) {
        s.pushToast("error", r.error ?? `${op} failed`);
        return;
      }
      if (op === "clone" && r.data?.clonedSession?.id) {
        onSessionCloned(r.data.clonedSession.id);
      } else {
        void s.reload();
        void s.refreshMessages();
      }
    } finally {
      setBusy(null);
    }
  };

  const stats = s.stats;
  const tokens = stats?.tokens as { total?: number; input?: number; output?: number } | undefined;
  const cost = typeof stats?.cost === "number" ? stats.cost : (stats?.cost as { total?: number } | undefined)?.total;
  const ctx = stats?.contextUsage as { percent?: number | null; tokens?: number | null; contextWindow?: number | null } | null | undefined;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-zinc-950">
      {/* Header */}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800/80 bg-zinc-950/90 px-4 py-2.5 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2">
          {editingName ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={void saveName}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveName();
                if (e.key === "Escape") setEditingName(false);
              }}
              className="w-52 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-[13px] focus:border-zinc-500 focus:outline-none"
            />
          ) : (
            <button
              onClick={() => {
                setNameDraft(s.meta?.name ?? "");
                setEditingName(true);
              }}
              className="group flex min-w-0 items-center gap-1.5"
              title="Rename session"
            >
              <h1 className="truncate text-[14px] font-semibold text-zinc-100">
                {s.meta?.name ?? "…"}
              </h1>
              <Pencil size={12} className="shrink-0 text-zinc-600 opacity-0 transition group-hover:opacity-100" />
            </button>
          )}
        </div>

        <ModelPicker
          models={s.models}
          current={s.state?.model as PiModel | null | undefined}
          thinkingLevels={s.thinkingLevels}
          currentThinking={s.state?.thinkingLevel ?? s.meta?.thinkingLevel}
          onPick={(m) => void pickModel(m)}
          onThinking={(lv) => void pickThinking(lv)}
        />

        <div className="ml-auto flex items-center gap-1.5">
          {/* Stat chips */}
          <div className="mr-1 hidden items-center gap-1.5 lg:flex">
            <span className="rounded-md bg-zinc-900 px-2 py-1 font-mono text-[10.5px] text-zinc-400" title="Total tokens">
              {formatTokens(tokens?.total)} tok
            </span>
            <span className="rounded-md bg-zinc-900 px-2 py-1 font-mono text-[10.5px] text-zinc-400" title="Cost">
              {formatCost(cost)}
            </span>
            {ctx?.percent != null && (
              <span
                className={cn(
                  "rounded-md px-2 py-1 font-mono text-[10.5px]",
                  (ctx.percent ?? 0) > 80 ? "bg-amber-500/10 text-amber-300" : "bg-zinc-900 text-zinc-400",
                )}
                title={`Context: ${formatTokens(ctx.tokens)} / ${formatTokens(ctx.contextWindow)}`}
              >
                {Math.round(ctx.percent)}% ctx
              </span>
            )}
          </div>

          <HeaderBtn title="Available slash commands" onClick={() => setShowCmds((v) => !v)} active={showCmds}>
            <Braces size={14} />
          </HeaderBtn>
          <HeaderBtn title="Run a bash command (output goes to agent context)" onClick={() => setShowBash((v) => !v)} active={showBash}>
            <TerminalSquare size={14} />
          </HeaderBtn>
          <HeaderBtn
            title="Compact context"
            onClick={() => void control("compact")}
            loading={busy === "compact" || s.compacting}
          >
            <Shrink size={14} />
          </HeaderBtn>
          <HeaderBtn
            title="Copy last assistant message"
            onClick={() => {
              const last = [...s.baseMessages].reverse().find((m) => m.role === "assistant");
              const t = last
                ? ((last as { content?: Array<{ type?: string; text?: string }> }).content ?? [])
                    .filter((b) => b.type === "text")
                    .map((b) => b.text ?? "")
                    .join("")
                : "";
              if (t) void navigator.clipboard.writeText(t);
            }}
          >
            <Copy size={14} />
          </HeaderBtn>
          <HeaderBtn
            title="Export session to HTML"
            onClick={async () => {
              const r = await control("export_html");
              const p = (r.data as { response?: { data?: { path?: string } } } | undefined)?.response?.data?.path;
              if (r.ok) s.pushToast("info", p ? `Exported to ${p}` : "Exported.");
            }}
          >
            <Download size={14} />
          </HeaderBtn>
          <HeaderBtn title="Clear queued messages" onClick={() => void control("clear_queue")}>
            <Eraser size={14} />
          </HeaderBtn>
          <HeaderBtn title="Session options (commands, fork, clone)" onClick={() => setShowCmds((v) => !v)} active={showCmds}>
            <GitFork size={14} />
          </HeaderBtn>
        </div>

        {(showCmds || showBash) && (
          <div className="basis-full">
            {showCmds && (
              <div className="mb-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Slash commands ({s.commands.length})
                  </span>
                  <div className="flex gap-1.5">
                    <MiniBtn onClick={() => void lifecycle("new_session")} loading={busy === "new_session"}>
                      New pi session
                    </MiniBtn>
                    <MiniBtn onClick={() => void lifecycle("clone")} loading={busy === "clone"}>
                      Clone branch
                    </MiniBtn>
                  </div>
                </div>
                {s.commands.length === 0 ? (
                  <p className="text-[12px] text-zinc-500">No extension commands, prompts or skills found.</p>
                ) : (
                  <div className="grid max-h-40 gap-1 overflow-y-auto sm:grid-cols-2">
                    {s.commands.map((c) => (
                      <button
                        key={`${c.source}:${c.name}`}
                        onClick={() => {
                          void send(`/${c.name} `, [], "direct");
                          setShowCmds(false);
                        }}
                        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-zinc-800"
                        title={c.description ?? c.name}
                      >
                        <code className="shrink-0 font-mono text-[11.5px] text-indigo-300">/{truncate(c.name, 28)}</code>
                        <span className="truncate text-[11.5px] text-zinc-500">{c.description ?? c.source}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {showBash && (
              <div className="mb-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                <div className="flex gap-2">
                  <input
                    value={bashCmd}
                    onChange={(e) => setBashCmd(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void runBash();
                    }}
                    placeholder="ls -la   (output is added to agent context on next prompt)"
                    className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 font-mono text-[12px] text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
                  />
                  <MiniBtn onClick={() => void runBash()}>Run</MiniBtn>
                </div>
                {bashOut != null && (
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-950 p-2.5 font-mono text-[11.5px] text-zinc-400">
                    {bashOut}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}

        {s.meta && (
          <div className="flex basis-full items-center gap-1.5 text-[11px] text-zinc-600">
            <span
              title={s.connected ? "Live updates connected" : "Connecting live updates…"}
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                s.connected ? "bg-emerald-400" : "streaming-dot bg-amber-400",
              )}
            />
            <FolderGit2 size={11} />
            <span className="truncate font-mono">{s.meta.cwd}</span>
            {s.liveError && <span className="ml-2 text-amber-400/90">· {s.liveError}</span>}
          </div>
        )}
      </header>

      {/* Messages */}
      <div ref={scroll.ref} onScroll={scroll.onScroll} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
          {s.loading && s.messages.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-zinc-500">
              <Loader2 size={15} className="animate-spin" /> Loading session…
            </div>
          ) : s.messages.length === 0 && !s.streaming ? (
            <EmptyState
              cwd={s.meta?.cwd}
              modelLabel={
                s.state?.model
                  ? `${(s.state.model as PiModel).provider ?? ""}/${(s.state.model as PiModel).id}`
                  : undefined
              }
              onExample={(t) => void send(t, [], "direct")}
            />
          ) : (
            s.messages.map((m, i) => (
              <MessageItem
                key={`${i}-${(m as { timestamp?: number }).timestamp ?? 0}`}
                message={m}
                toolResults={s.toolResults}
                toolLive={s.toolLive}
                streaming={s.streaming && i === s.messages.length - 1}
              />
            ))
          )}
          {(s.streaming || s.compacting) && (
            <div className="flex items-center gap-2 text-[12px] text-zinc-500">
              <Loader2 size={13} className="animate-spin" />
              {s.compacting ? "Compacting context…" : "Agent is working…"}
              {(s.queue.steering.length > 0 || s.queue.followUp.length > 0) && (
                <span className="text-zinc-600">
                  ({s.queue.steering.length + s.queue.followUp.length} queued)
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="shrink-0 px-4 pb-4 pt-1">
        <div className="mx-auto max-w-3xl">
          <Composer
            streaming={s.streaming}
            compacting={s.compacting}
            queueCounts={{ steering: s.queue.steering.length, followUp: s.queue.followUp.length }}
            onSend={(t, imgs, mode) => void send(t, imgs, mode)}
            onAbort={() => void control("abort")}
          />
          <p className="mt-1.5 text-center text-[10.5px] text-zinc-700">
            Pi runs tools in <span className="font-mono">{truncate(s.meta?.cwd ?? "", 48)}</span> · Enter to send · Shift+Enter for newline
          </p>
        </div>
      </div>

      {s.dialogs[0] && <DialogModal dialog={s.dialogs[0]} onAnswer={(id, p) => void s.answerDialog(id, p)} />}
      <Toasts toasts={s.toasts} onDismiss={s.dismissToast} />
    </div>
  );
}

function HeaderBtn({
  children,
  title,
  onClick,
  active,
  loading,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  active?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "rounded-lg p-2 transition",
        active ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:bg-zinc-800/70 hover:text-zinc-300",
      )}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : children}
    </button>
  );
}

function MiniBtn({
  children,
  onClick,
  loading,
}: {
  children: React.ReactNode;
  onClick: () => void;
  loading?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/60 px-2.5 py-1 text-[11.5px] text-zinc-300 transition hover:bg-zinc-700 disabled:opacity-50"
    >
      {loading && <Loader2 size={11} className="animate-spin" />}
      {children}
    </button>
  );
}

function EmptyState({
  cwd,
  modelLabel,
  onExample,
}: {
  cwd?: string;
  modelLabel?: string;
  onExample: (t: string) => void;
}) {
  const examples = [
    "Explain this project structure and where to start",
    "Run the tests and fix any failures",
    "Review my uncommitted changes",
  ];
  return (
    <div className="py-10 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900">
        <Sparkles size={20} className="text-zinc-300" />
      </div>
      <h2 className="text-[16px] font-semibold text-zinc-100">What should we build?</h2>
      <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-zinc-500">
        Pi has file tools in <span className="font-mono text-zinc-400">{truncate(cwd ?? "", 56)}</span>
        {modelLabel && (
          <>
            {" "}· running <span className="font-mono text-zinc-400">{modelLabel}</span>
          </>
        )}
        . Ask anything to get started.
      </p>
      <div className="mx-auto mt-5 grid max-w-lg gap-2">
        {examples.map((e) => (
          <button
            key={e}
            onClick={() => onExample(e)}
            className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-2.5 text-left text-[12.5px] text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-900"
          >
            {e}
          </button>
        ))}
      </div>
      <p className="mt-4 flex items-center justify-center gap-1 text-[11px] text-zinc-600">
        Tip: type <code className="rounded bg-zinc-800 px-1 font-mono">/&lt;tab&gt;</code> via the
        <ChevronDown size={10} className="inline" /> button above for skills & prompts
      </p>
    </div>
  );
}
