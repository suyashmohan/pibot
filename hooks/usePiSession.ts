"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import {
  streamingAssistantMessage,
  type AgentMessage,
  type AssistantContent,
  type ExtensionUiRequest,
  type PiModel,
  type SessionState,
  type SessionStats,
  type ToolCallContent,
} from "@/lib/pi/types";

interface SessionMeta {
  id: string;
  name: string;
  cwd: string;
  provider: string | null;
  modelId: string | null;
  thinkingLevel: string | null;
  piSessionId: string | null;
  piSessionFile: string | null;
  createdAt: number;
  updatedAt: number;
}

interface StreamingDraft {
  text: string;
  thinking: string;
  toolCalls: Array<{ id: string; name: string; argsText: string }>;
  usage: Record<string, number> | null;
}

const EMPTY_DRAFT: StreamingDraft = { text: "", thinking: "", toolCalls: [], usage: null };

export interface Toast {
  id: string;
  kind: "info" | "warning" | "error";
  message: string;
}

export function usePiSession(sessionId: string | null) {
  const [meta, setMeta] = useState<SessionMeta | null>(null);
  const [state, setState] = useState<SessionState | null>(null);
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [draft, setDraft] = useState<StreamingDraft>(EMPTY_DRAFT);
  const [streaming, setStreaming] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [queue, setQueue] = useState<{ steering: string[]; followUp: string[] }>({
    steering: [],
    followUp: [],
  });
  const [dialogs, setDialogs] = useState<ExtensionUiRequest[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [toolLive, setToolLive] = useState<Record<string, { name: string; text: string }>>({});
  const [bashLive, setBashLive] = useState<Record<string, string>>({});
  const [models, setModels] = useState<PiModel[]>([]);
  const [thinkingLevels, setThinkingLevels] = useState<string[]>([]);
  const [commands, setCommands] = useState<Array<{ name: string; description?: string; source: string }>>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushToast = useCallback((kind: Toast["kind"], message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((t) => [...t.slice(-4), { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  const refreshMessages = useCallback(async () => {
    if (!sessionId) return;
    try {
      const r = await api<{ messages: AgentMessage[]; live: boolean; liveError?: string }>(
        `/api/sessions/${sessionId}/messages`,
      );
      if (r.ok && r.data) {
        setMessages(r.data.messages);
        if (!r.data.live) setLiveError(r.data.liveError ?? "pi process unreachable — showing cache");
      }
    } catch {
      /* ignore transient */
    }
  }, [sessionId]);

  const refreshStats = useCallback(async () => {
    if (!sessionId) return;
    try {
      const r = await api<{ state: SessionState | null; stats: SessionStats | null }>(
        `/api/sessions/${sessionId}/stats`,
      );
      if (r.ok && r.data) {
        if (r.data.state) setState(r.data.state);
        if (r.data.stats) setStats(r.data.stats);
      }
    } catch {
      /* ignore */
    }
  }, [sessionId]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void refreshMessages();
      void refreshStats();
    }, 450);
  }, [refreshMessages, refreshStats]);

  const loadSession = useCallback(async () => {
    if (!sessionId) {
      setMeta(null);
      setMessages([]);
      setState(null);
      setStats(null);
      return;
    }
    setLoading(true);
    try {
      const r = await api<{
        session: SessionMeta;
        state: SessionState | null;
        stats: SessionStats | null;
        messages: AgentMessage[];
        liveError: string | null;
      }>(`/api/sessions/${sessionId}`);
      if (r.ok && r.data) {
        setMeta(r.data.session);
        setState(r.data.state);
        setStats(r.data.stats);
        setMessages(r.data.messages ?? []);
        setLiveError(r.data.liveError);
        setStreaming(Boolean(r.data.state?.isStreaming));
        setCompacting(Boolean(r.data.state?.isCompacting));
      } else {
        setLiveError(r.error ?? "Failed to load session");
      }
    } catch (e) {
      setLiveError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const loadModels = useCallback(async () => {
    if (!sessionId) return;
    try {
      const r = await api<{ models: PiModel[]; state: SessionState | null; thinkingLevels: string[] | null }>(
        `/api/sessions/${sessionId}/model`,
      );
      if (r.ok && r.data) {
        setModels((r.data.models ?? []) as PiModel[]);
        if (r.data.thinkingLevels) setThinkingLevels(r.data.thinkingLevels);
      }
    } catch {
      /* ignore */
    }
  }, [sessionId]);

  const loadCommands = useCallback(async () => {
    if (!sessionId) return;
    try {
      const r = await api<{ response: { data?: { commands?: Array<{ name: string; description?: string; source: string }> } } }>(
        `/api/sessions/${sessionId}/control`,
        { method: "POST", body: JSON.stringify({ action: "get_commands" }) },
      );
      const cmds = r.data?.response?.data?.commands;
      if (r.ok && Array.isArray(cmds)) setCommands(cmds);
    } catch {
      /* ignore */
    }
  }, [sessionId]);

  // Initial load.
  useEffect(() => {
    setDraft(EMPTY_DRAFT);
    setDialogs([]);
    setToolLive({});
    setBashLive({});
    void loadSession();
    void loadModels();
    void loadCommands();
  }, [sessionId, loadSession, loadModels, loadCommands]);

  // SSE subscription.
  useEffect(() => {
    if (!sessionId) return;
    const es = new EventSource(`/api/sessions/${sessionId}/stream`);
    esRef.current = es;

    const onMessage = (e: MessageEvent) => {
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(e.data) as Record<string, unknown>;
      } catch {
        return;
      }
      const type = String((ev.type as string) ?? "");
      switch (type) {
        case "ready":
          setConnected(true);
          setLiveError(null);
          break;
        case "agent_start":
          setStreaming(true);
          break;
        case "agent_settled":
          setStreaming(false);
          setDraft(EMPTY_DRAFT);
          void refreshMessages();
          void refreshStats();
          break;
        case "agent_end":
          scheduleRefresh();
          void refreshStats();
          break;
        case "turn_end":
        case "message_end":
          scheduleRefresh();
          break;
        case "message_start": {
          const m = ev.message as AgentMessage | undefined;
          if (m && (m as { role?: string }).role === "assistant") {
            setDraft(EMPTY_DRAFT);
          }
          break;
        }
        case "message_update": {
          const delta = ev.assistantMessageEvent as
            | { type: string; delta?: string; toolName?: string; id?: string; toolCall?: ToolCallContent }
            | undefined;
          if (!delta) break;
          setDraft((d) => {
            const next = { ...d, toolCalls: d.toolCalls.map((t) => ({ ...t })) };
            switch (delta.type) {
              case "text_delta":
                next.text += delta.delta ?? "";
                break;
              case "thinking_delta":
                next.thinking += delta.delta ?? "";
                break;
              case "toolcall_start":
                next.toolCalls.push({
                  id: String(delta.id ?? `tc-${next.toolCalls.length}`),
                  name: String(delta.toolName ?? "tool"),
                  argsText: "",
                });
                break;
              case "toolcall_delta": {
                const last = next.toolCalls[next.toolCalls.length - 1];
                if (last) last.argsText += delta.delta ?? "";
                break;
              }
              case "toolcall_end": {
                const tc = delta.toolCall;
                if (tc) {
                  const idx = next.toolCalls.findIndex((t) => t.id === tc.id);
                  const row = { id: tc.id, name: tc.name, argsText: JSON.stringify(tc.arguments ?? {}) };
                  if (idx >= 0) next.toolCalls[idx] = row;
                  else next.toolCalls.push(row);
                }
                break;
              }
            }
            const usage = ev.usage as Record<string, number> | undefined;
            if (usage && typeof usage === "object") next.usage = usage;
            return next;
          });
          break;
        }
        case "tool_execution_start": {
          const id = String(ev.toolCallId ?? "");
          if (id) setToolLive((m) => ({ ...m, [id]: { name: String(ev.toolName ?? "tool"), text: "" } }));
          break;
        }
        case "tool_execution_update": {
          const id = String(ev.toolCallId ?? "");
          const partial = ev.partialResult as { content?: Array<{ text?: string }> } | undefined;
          const text = partial?.content?.map((c) => String(c.text ?? "")).join("") ?? "";
          if (id) {
            setToolLive((m) => ({
              ...m,
              [id]: { name: String(ev.toolName ?? m[id]?.name ?? "tool"), text },
            }));
          }
          break;
        }
        case "tool_execution_end": {
          const id = String(ev.toolCallId ?? "");
          if (id) {
            setToolLive((m) => {
              const next = { ...m };
              delete next[id];
              return next;
            });
          }
          scheduleRefresh();
          break;
        }
        case "bash_execution_update": {
          const id = String((ev.id as string) ?? "bash");
          setBashLive((m) => ({ ...m, [id]: (m[id] ?? "") + String(ev.delta ?? "") }));
          break;
        }
        case "queue_update":
          setQueue({
            steering: Array.isArray(ev.steering) ? (ev.steering as string[]) : [],
            followUp: Array.isArray(ev.followUp) ? (ev.followUp as string[]) : [],
          });
          break;
        case "compaction_start":
          setCompacting(true);
          pushToast("info", "Compacting context…");
          break;
        case "compaction_end":
          setCompacting(false);
          void refreshMessages();
          void refreshStats();
          break;
        case "auto_retry_start":
          pushToast("warning", `Retrying after transient error (attempt ${String(ev.attempt ?? "?")})…`);
          break;
        case "auto_retry_end":
          if (ev.success !== true) pushToast("error", `Retry failed: ${String(ev.finalError ?? "unknown error")}`);
          break;
        case "extension_ui_request": {
          const req = ev as unknown as ExtensionUiRequest;
          if (req.method === "select" || req.method === "confirm" || req.method === "input" || req.method === "editor") {
            setDialogs((d) => (d.some((x) => x.id === req.id) ? d : [...d, req]));
          } else if (req.method === "notify") {
            pushToast(
              req.notifyType === "error" ? "error" : req.notifyType === "warning" ? "warning" : "info",
              String(req.message ?? "Notification"),
            );
          }
          break;
        }
        case "extension_error":
          pushToast("error", `Extension error: ${String(ev.error ?? "unknown")}`);
          break;
        case "client_exit":
          setStreaming(false);
          pushToast("error", "Pi process exited. Reload the session to respawn it.");
          break;
        default:
          break;
      }
    };

    // NOTE: the server emits *named* SSE events (`event: agent_start` …).
    // Per the SSE spec those are NOT delivered to `onmessage` — a listener
    // must be registered for each event name. Missing this breaks all live
    // updates (page refresh still works because it re-fetches via REST).
    const EVENT_TYPES = [
      "ready",
      "agent_start",
      "agent_end",
      "agent_settled",
      "turn_start",
      "turn_end",
      "message_start",
      "message_update",
      "message_end",
      "bash_execution_update",
      "tool_execution_start",
      "tool_execution_update",
      "tool_execution_end",
      "queue_update",
      "compaction_start",
      "compaction_end",
      "auto_retry_start",
      "auto_retry_end",
      "summarization_retry_scheduled",
      "summarization_retry_attempt_start",
      "summarization_retry_finished",
      "extension_ui_request",
      "extension_error",
      "client_exit",
      "message",
    ];
    const handler = onMessage as EventListener;
    for (const t of EVENT_TYPES) es.addEventListener(t, handler);
    es.onmessage = onMessage; // fallback for any unnamed events
    es.onerror = () => {
      // EventSource auto-reconnects on transient failures. Only mark the
      // stream down when the browser gives up retrying.
      if (es.readyState === EventSource.CLOSED) setConnected(false);
    };
    return () => {
      for (const t of EVENT_TYPES) es.removeEventListener(t, handler);
      es.close();
      esRef.current = null;
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
      setConnected(false);
    };
  }, [sessionId, pushToast, refreshMessages, refreshStats, scheduleRefresh]);

  // Poll stats while streaming.
  useEffect(() => {
    if (!sessionId || !streaming) return;
    const t = setInterval(() => void refreshStats(), 8000);
    return () => clearInterval(t);
  }, [sessionId, streaming, refreshStats]);

  const toolResults = useMemo(() => {
    const map = new Map<string, AgentMessage>();
    for (const m of messages) {
      if ((m as { role?: string }).role === "toolResult") {
        const id = String((m as { toolCallId?: unknown }).toolCallId ?? "");
        if (id) map.set(id, m);
      }
    }
    return map;
  }, [messages]);

  const streamingAssistant = useMemo((): AgentMessage | null => {
    if (!streaming) return null;
    if (!draft.text && !draft.thinking && draft.toolCalls.length === 0) return null;
    const content: AssistantContent[] = [];
    if (draft.thinking) content.push({ type: "thinking", thinking: draft.thinking });
    if (draft.text) content.push({ type: "text", text: draft.text });
    for (const tc of draft.toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = tc.argsText ? (JSON.parse(tc.argsText) as Record<string, unknown>) : {};
      } catch {
        args = { _partial: tc.argsText };
      }
      content.push({ type: "toolCall", id: tc.id, name: tc.name, arguments: args });
    }
    return streamingAssistantMessage(content);
  }, [streaming, draft]);

  const visibleMessages = useMemo(
    () => (streamingAssistant ? [...messages, streamingAssistant] : messages),
    [messages, streamingAssistant],
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const answerDialog = useCallback(
    async (dialogId: string, payload: { value?: string; confirmed?: boolean; cancelled?: boolean }) => {
      if (!sessionId) return;
      setDialogs((d) => d.filter((x) => x.id !== dialogId));
      await api(`/api/sessions/${sessionId}/extension-ui`, {
        method: "POST",
        body: JSON.stringify({ id: dialogId, ...payload }),
      });
    },
    [sessionId],
  );

  return {
    meta,
    setMeta,
    state,
    stats,
    messages: visibleMessages,
    baseMessages: messages,
    toolResults,
    toolLive,
    bashLive,
    streaming,
    compacting,
    loading,
    liveError,
    connected,
    queue,
    dialogs,
    toasts,
    models,
    thinkingLevels,
    commands,
    pushToast,
    dismissToast,
    answerDialog,
    refreshMessages,
    refreshStats,
    reload: loadSession,
  };
}
