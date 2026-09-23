/**
 * Single Pi-event → SessionEvent projector.
 *
 * There is exactly one projector API with two call sites: `lib/control/subscribe.ts`
 * (in-process subscribers) and `lib/client/stream.ts` (HTTP EventSource). The
 * HTTP SSE adapter does **not** project — `/stream` still forwards raw
 * `PiEvent`s.
 *
 * `SessionEvent`s are **snapshots**: `draft.updated.draft` is the full
 * `StreamingDraft` and `bash.updated.text` is the accumulated string so far.
 * `applySessionEvent` therefore *replaces* fields and never concatenates —
 * folding the same events twice must be idempotent.
 */

import type {
  DialogRequest,
  SessionEvent,
  SessionView,
  StreamingDraft,
} from "./types";

/** Wire event: a `PiEvent` or the SSE adapter's synthetic `{ type: "ready" }`. */
export type WireEvent = { type: string; [k: string]: unknown };

export interface Projector {
  readonly view: SessionView;
}

export function emptyDraft(): StreamingDraft {
  return { text: "", thinking: "", toolCalls: [], usage: null };
}

export function emptySessionView(): SessionView {
  return {
    streaming: false,
    compacting: false,
    draft: emptyDraft(),
    toolLive: {},
    bashLive: {},
    queue: { steering: [], followUp: [] },
    dialogs: [],
  };
}

export function createProjector(): Projector {
  return { view: emptySessionView() };
}

function cloneDraft(d: StreamingDraft): StreamingDraft {
  return {
    text: d.text,
    thinking: d.thinking,
    toolCalls: d.toolCalls.map((t) => ({ ...t })),
    usage: d.usage ? { ...d.usage } : null,
  };
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : v == null ? fallback : String(v);
}

const DIALOG_METHODS = new Set(["select", "confirm", "input", "editor"]);

interface AssistantMessageEvent {
  type?: string;
  delta?: string;
  id?: string;
  toolName?: string;
  toolCall?: { id?: string; name?: string; arguments?: unknown };
}

/**
 * Fold one wire event into `p.view`; return the `SessionEvent`s to emit.
 * Inner delta accumulation (`+=`) happens **inside** this function on
 * `p.view`; the emitted events carry the resulting snapshot.
 */
export function pushPiEvent(p: Projector, ev: WireEvent): SessionEvent[] {
  const view = p.view;
  const type = String(ev.type ?? "");

  switch (type) {
    case "ready":
      return [{ type: "session.ready", sessionId: str(ev.sessionId), ts: Number(ev.ts ?? 0) }];

    case "agent_start":
      view.streaming = true;
      return [{ type: "turn.started" }];

    case "agent_settled":
      view.streaming = false;
      view.draft = emptyDraft();
      return [{ type: "turn.settled" }];

    case "agent_end":
    case "turn_end":
    case "message_end":
      return [{ type: "turn.ended" }];

    case "message_start": {
      const m = ev.message as { role?: string } | undefined;
      if (m && m.role === "assistant") {
        view.draft = emptyDraft();
        return [{ type: "draft.cleared" }];
      }
      return [];
    }

    case "message_update":
      return pushMessageUpdate(p, ev);

    case "tool_execution_start": {
      const id = str(ev.toolCallId);
      if (!id) return [];
      const name = str(ev.toolName, "tool");
      view.toolLive[id] = { name, text: "" };
      return [{ type: "tool.started", toolCallId: id, name }];
    }

    case "tool_execution_update": {
      const id = str(ev.toolCallId);
      if (!id) return [];
      const partial = ev.partialResult as
        | { content?: Array<{ text?: string }> }
        | undefined;
      const text = partial?.content?.map((c) => String(c.text ?? "")).join("") ?? "";
      const name = str(ev.toolName, view.toolLive[id]?.name ?? "tool");
      view.toolLive[id] = { name, text };
      return [{ type: "tool.updated", toolCallId: id, name, text }];
    }

    case "tool_execution_end": {
      const id = str(ev.toolCallId);
      if (!id) return [];
      delete view.toolLive[id];
      return [{ type: "tool.ended", toolCallId: id }];
    }

    case "bash_execution_update": {
      const id = str(ev.id, "bash");
      const text = (view.bashLive[id] ?? "") + str(ev.delta);
      view.bashLive[id] = text;
      return [{ type: "bash.updated", id, text }];
    }

    case "queue_update": {
      const steering = Array.isArray(ev.steering) ? (ev.steering as string[]) : [];
      const followUp = Array.isArray(ev.followUp) ? (ev.followUp as string[]) : [];
      view.queue = { steering: [...steering], followUp: [...followUp] };
      return [{ type: "queue.updated", steering: [...steering], followUp: [...followUp] }];
    }

    case "compaction_start":
      view.compacting = true;
      return [{ type: "compaction.started" }];

    case "compaction_end":
      view.compacting = false;
      return [{ type: "compaction.ended" }];

    case "auto_retry_start":
      return [{ type: "retry.started", attempt: str(ev.attempt, "?") }];

    case "auto_retry_end":
      if (ev.success === true) return [{ type: "retry.ended", success: true }];
      return [
        {
          type: "retry.ended",
          success: false,
          error: str(ev.finalError, "unknown error"),
        },
      ];

    case "extension_ui_request": {
      const method = str(ev.method);
      if (DIALOG_METHODS.has(method)) {
        const dialog = ev as unknown as DialogRequest;
        if (!view.dialogs.some((d) => d.id === dialog.id)) {
          view.dialogs.push(dialog);
        }
        return [{ type: "dialog.requested", dialog }];
      }
      if (method === "notify") {
        const kind =
          ev.notifyType === "error"
            ? "error"
            : ev.notifyType === "warning"
              ? "warning"
              : "info";
        return [{ type: "notify", kind, message: str(ev.message, "Notification") }];
      }
      return [];
    }

    case "extension_error":
      return [{ type: "extension.error", error: str(ev.error, "unknown") }];

    case "client_exit": {
      view.streaming = false;
      return [
        {
          type: "process.exited",
          ...(typeof ev.reason === "string" ? { reason: ev.reason } : {}),
          ...(ev.info !== undefined ? { info: ev.info } : {}),
        },
      ];
    }

    default:
      return [];
  }
}

function pushMessageUpdate(p: Projector, ev: WireEvent): SessionEvent[] {
  const view = p.view;
  const inner = ev.assistantMessageEvent as AssistantMessageEvent | undefined;
  const usage = ev.usage as Record<string, number> | undefined;
  const hasUsage = Boolean(usage) && typeof usage === "object";
  if (!inner) {
    if (hasUsage) {
      view.draft.usage = usage as Record<string, number>;
      return [{ type: "draft.updated", draft: cloneDraft(view.draft) }];
    }
    return [];
  }

  let touched = true;
  switch (inner.type) {
    case "text_delta":
      view.draft.text += str(inner.delta);
      break;
    case "thinking_delta":
      view.draft.thinking += str(inner.delta);
      break;
    case "toolcall_start":
      view.draft.toolCalls.push({
        id: str(inner.id, `tc-${view.draft.toolCalls.length}`),
        name: str(inner.toolName, "tool"),
        argsText: "",
      });
      break;
    case "toolcall_delta": {
      const last = view.draft.toolCalls[view.draft.toolCalls.length - 1];
      if (last) last.argsText += str(inner.delta);
      break;
    }
    case "toolcall_end": {
      const tc = inner.toolCall;
      if (tc) {
        const id = str(tc.id);
        const row = {
          id,
          name: str(tc.name, "tool"),
          argsText: JSON.stringify(tc.arguments ?? {}),
        };
        const idx = view.draft.toolCalls.findIndex((t) => t.id === id);
        if (idx >= 0) view.draft.toolCalls[idx] = row;
        else view.draft.toolCalls.push(row);
      }
      break;
    }
    default:
      // `text_start` / `text_end` / unknown inner types carry no delta but may
      // carry usage (today's hook applies it for every inner type).
      touched = false;
      break;
  }

  if (hasUsage) view.draft.usage = usage as Record<string, number>;
  if (!touched && !hasUsage) return [];
  return [{ type: "draft.updated", draft: cloneDraft(view.draft) }];
}

/**
 * Apply a snapshot `SessionEvent` to a view. **Replace** fields; never
 * concatenate `draft.text` or `bashLive[id]`. Returns the same object when the
 * event changes nothing, so React can skip re-renders.
 */
export function applySessionEvent(view: SessionView, ev: SessionEvent): SessionView {
  switch (ev.type) {
    case "session.ready":
    case "turn.ended":
    case "retry.started":
    case "retry.ended":
    case "extension.error":
      return view;

    case "turn.started":
      return view.streaming ? view : { ...view, streaming: true };

    case "turn.settled":
      return view.streaming || view.draft !== null
        ? { ...view, streaming: false, draft: emptyDraft() }
        : view;

    case "draft.cleared":
      return { ...view, draft: emptyDraft() };

    case "draft.updated":
      return { ...view, draft: cloneDraft(ev.draft) };

    case "tool.started":
      return {
        ...view,
        toolLive: { ...view.toolLive, [ev.toolCallId]: { name: ev.name, text: "" } },
      };

    case "tool.updated":
      return {
        ...view,
        toolLive: {
          ...view.toolLive,
          [ev.toolCallId]: { name: ev.name, text: ev.text },
        },
      };

    case "tool.ended": {
      if (!(ev.toolCallId in view.toolLive)) return view;
      const next = { ...view.toolLive };
      delete next[ev.toolCallId];
      return { ...view, toolLive: next };
    }

    case "bash.updated":
      return { ...view, bashLive: { ...view.bashLive, [ev.id]: ev.text } };

    case "queue.updated":
      return {
        ...view,
        queue: { steering: [...ev.steering], followUp: [...ev.followUp] },
      };

    case "compaction.started":
      return view.compacting ? view : { ...view, compacting: true };

    case "compaction.ended":
      return view.compacting ? { ...view, compacting: false } : view;

    case "dialog.requested":
      if (view.dialogs.some((d) => d.id === ev.dialog.id)) return view;
      return { ...view, dialogs: [...view.dialogs, ev.dialog] };

    case "process.exited":
      return view.streaming ? { ...view, streaming: false } : view;

    case "notify":
      return view;

    default:
      return view;
  }
}
