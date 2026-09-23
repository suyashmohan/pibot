/**
 * Projector spec — mirrors the PiEvent → SessionEvent mapping table in
 * docs/control-plane.md. Every emitted event is a snapshot; `applySessionEvent`
 * replaces fields so folding the same events twice is idempotent.
 */
import { describe, expect, test } from "bun:test";
import {
  applySessionEvent,
  createProjector,
  emptySessionView,
  pushPiEvent,
  type WireEvent,
} from "@/lib/control/projector";
import type { SessionEvent, SessionView } from "@/lib/control/types";

function push(p: ReturnType<typeof createProjector>, ev: WireEvent): SessionEvent[] {
  return pushPiEvent(p, ev);
}

function fold(events: SessionEvent[]): SessionView {
  return events.reduce((v, e) => applySessionEvent(v, e), emptySessionView());
}

describe("projector: turn lifecycle", () => {
  test("ready → session.ready", () => {
    const p = createProjector();
    const evs = push(p, { type: "ready", sessionId: "s1", ts: 123 });
    expect(evs).toEqual([{ type: "session.ready", sessionId: "s1", ts: 123 }]);
    expect(p.view.streaming).toBe(false);
  });

  test("agent_start → turn.started, streaming true", () => {
    const p = createProjector();
    expect(push(p, { type: "agent_start" })).toEqual([{ type: "turn.started" }]);
    expect(p.view.streaming).toBe(true);
  });

  test("agent_end / turn_end / message_end → turn.ended", () => {
    const p = createProjector();
    for (const t of ["agent_end", "turn_end", "message_end"]) {
      expect(push(p, { type: t })).toEqual([{ type: "turn.ended" }]);
    }
  });

  test("agent_settled → turn.settled, draft cleared", () => {
    const p = createProjector();
    push(p, { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hi" } });
    expect(p.view.draft.text).toBe("hi");
    expect(push(p, { type: "agent_settled" })).toEqual([{ type: "turn.settled" }]);
    expect(p.view.streaming).toBe(false);
    expect(p.view.draft.text).toBe("");
  });

  test("agent_settled carries the manager-measured turn duration", () => {
    const p = createProjector();
    expect(push(p, { type: "agent_settled", durationMs: 1234 })).toEqual([
      { type: "turn.settled", durationMs: 1234 },
    ]);
  });

  test("client_exit → process.exited and streaming stops", () => {
    const p = createProjector();
    push(p, { type: "agent_start" });
    const evs = push(p, { type: "client_exit", reason: "stopped" });
    expect(evs).toEqual([{ type: "process.exited", reason: "stopped" }]);
    expect(p.view.streaming).toBe(false);
  });

  test("unknown events are ignored", () => {
    const p = createProjector();
    expect(push(p, { type: "summarization_retry_scheduled" })).toEqual([]);
    expect(push(p, { type: "turn_start" })).toEqual([]);
    expect(push(p, { type: "message", foo: 1 })).toEqual([]);
  });
});

describe("projector: streaming draft", () => {
  test("message_start for an assistant clears the draft", () => {
    const p = createProjector();
    push(p, { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "x" } });
    const evs = push(p, {
      type: "message_start",
      message: { role: "assistant", content: [], timestamp: 1 },
    });
    expect(evs).toEqual([{ type: "draft.cleared" }]);
    expect(p.view.draft.text).toBe("");
  });

  test("message_start for a user message is a no-op", () => {
    const p = createProjector();
    expect(
      push(p, { type: "message_start", message: { role: "user", content: "hi", timestamp: 1 } }),
    ).toEqual([]);
  });

  test("text_delta / thinking_delta accumulate and emit full snapshots", () => {
    const p = createProjector();
    const a = push(p, {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Hel" },
    });
    const b = push(p, {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "lo" },
    });
    const c = push(p, {
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "hmm" },
    });

    expect(a).toEqual([
      { type: "draft.updated", draft: { text: "Hel", thinking: "", toolCalls: [], usage: null } },
    ]);
    expect((b[0] as { draft: { text: string } }).draft.text).toBe("Hello");
    expect((c[0] as { draft: { text: string; thinking: string } }).draft).toMatchObject({
      text: "Hello",
      thinking: "hmm",
    });
    expect(p.view.draft.text).toBe("Hello");
    expect(p.view.draft.thinking).toBe("hmm");
  });

  test("toolcall_start / delta / end build one row; toolcall_end replaces it", () => {
    const p = createProjector();
    push(p, {
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_start", id: "tc1", toolName: "read" },
    });
    push(p, {
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_delta", id: "tc1", delta: '{"pa' },
    });
    push(p, {
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_delta", id: "tc1", delta: 'th":"a"}' },
    });
    expect(p.view.draft.toolCalls).toEqual([
      { id: "tc1", name: "read", argsText: '{"path":"a"}' },
    ]);

    const evs = push(p, {
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_end",
        id: "tc1",
        toolCall: { id: "tc1", name: "read", arguments: { path: "a" } },
      },
    });
    expect((evs[0] as { draft: { toolCalls: unknown[] } }).draft.toolCalls).toEqual([
      { id: "tc1", name: "read", argsText: '{"path":"a"}' },
    ]);
    expect(p.view.draft.toolCalls).toHaveLength(1);
  });

  test("usage on text_start emits a draft event; text_end without usage emits nothing", () => {
    const p = createProjector();
    const withUsage = push(p, {
      type: "message_update",
      usage: { input: 5 },
      assistantMessageEvent: { type: "text_start", contentIndex: 0 },
    });
    expect(withUsage).toHaveLength(1);
    expect((withUsage[0] as { draft: { usage: unknown } }).draft.usage).toEqual({ input: 5 });

    const noUsage = push(p, {
      type: "message_update",
      assistantMessageEvent: { type: "text_end", contentIndex: 0, content: "done" },
    });
    expect(noUsage).toEqual([]);
    expect(p.view.draft.text).toBe(""); // text_end does not append
    expect(p.view.draft.usage).toEqual({ input: 5 });
  });

  test("usage is applied alongside a delta", () => {
    const p = createProjector();
    push(p, {
      type: "message_update",
      usage: { total: 9 },
      assistantMessageEvent: { type: "text_delta", delta: "a" },
    });
    expect(p.view.draft.usage).toEqual({ total: 9 });
  });
});

describe("projector: tool execution", () => {
  test("start/update/end mirror into toolLive", () => {
    const p = createProjector();
    expect(push(p, { type: "tool_execution_start", toolCallId: "t1", toolName: "bash" })).toEqual([
      { type: "tool.started", toolCallId: "t1", name: "bash" },
    ]);
    const upd = push(p, {
      type: "tool_execution_update",
      toolCallId: "t1",
      toolName: "bash",
      partialResult: { content: [{ text: "hel" }, { text: "lo" }] },
    });
    expect(upd).toEqual([
      { type: "tool.updated", toolCallId: "t1", name: "bash", text: "hello" },
    ]);
    // Pi sends a snapshot, not a delta: replacing must not concatenate.
    const upd2 = push(p, {
      type: "tool_execution_update",
      toolCallId: "t1",
      toolName: "bash",
      partialResult: { content: [{ text: "next" }] },
    });
    expect((upd2[0] as { text: string }).text).toBe("next");
    expect(p.view.toolLive.t1).toEqual({ name: "bash", text: "next" });

    expect(push(p, { type: "tool_execution_end", toolCallId: "t1" })).toEqual([
      { type: "tool.ended", toolCallId: "t1" },
    ]);
    expect(p.view.toolLive.t1).toBeUndefined();
  });
});

describe("projector: bash accumulation (snapshot, no double-concat)", () => {
  test("two deltas accumulate in the view and in the emitted snapshot", () => {
    const p = createProjector();
    const a = push(p, { type: "bash_execution_update", id: "bash-1", delta: "a" });
    const b = push(p, { type: "bash_execution_update", id: "bash-1", delta: "b" });

    expect(a).toEqual([{ type: "bash.updated", id: "bash-1", text: "a" }]);
    expect(b).toEqual([{ type: "bash.updated", id: "bash-1", text: "ab" }]);
    expect(p.view.bashLive["bash-1"]).toBe("ab");

    // Folding the snapshot events replaces (idempotent), never concatenates.
    const folded = fold([...a, ...b]);
    expect(folded.bashLive["bash-1"]).toBe("ab");
  });
});

describe("projector: queue, compaction, retry", () => {
  test("queue_update replaces the queue", () => {
    const p = createProjector();
    expect(
      push(p, { type: "queue_update", steering: ["a"], followUp: ["b"] }),
    ).toEqual([{ type: "queue.updated", steering: ["a"], followUp: ["b"] }]);
    push(p, { type: "queue_update", steering: ["c"], followUp: [] });
    expect(p.view.queue).toEqual({ steering: ["c"], followUp: [] });
  });

  test("compaction emits typed events only — never a notify toast", () => {
    const p = createProjector();
    expect(push(p, { type: "compaction_start" })).toEqual([{ type: "compaction.started" }]);
    expect(p.view.compacting).toBe(true);
    expect(push(p, { type: "compaction_end" })).toEqual([{ type: "compaction.ended" }]);
    expect(p.view.compacting).toBe(false);
  });

  test("auto_retry events carry attempt / error", () => {
    const p = createProjector();
    expect(push(p, { type: "auto_retry_start", attempt: 2 })).toEqual([
      { type: "retry.started", attempt: "2" },
    ]);
    expect(push(p, { type: "auto_retry_end", success: false, finalError: "boom" })).toEqual([
      { type: "retry.ended", success: false, error: "boom" },
    ]);
    expect(push(p, { type: "auto_retry_end", success: true })).toEqual([
      { type: "retry.ended", success: true },
    ]);
  });
});

describe("projector: extension UI", () => {
  test("dialog methods append once", () => {
    const p = createProjector();
    const req = {
      type: "extension_ui_request",
      id: "d1",
      method: "select",
      title: "Pick",
      options: ["a", "b"],
    };
    const first = push(p, req);
    expect(first).toHaveLength(1);
    expect((first[0] as { dialog: { id: string } }).dialog.id).toBe("d1");
    expect(push(p, { ...req })).toEqual([{ type: "dialog.requested", dialog: req as never }]);
    expect(p.view.dialogs).toHaveLength(1);
  });

  test("notify → notify event with mapped kind; other methods ignored", () => {
    const p = createProjector();
    expect(
      push(p, {
        type: "extension_ui_request",
        id: "n1",
        method: "notify",
        message: "hi",
        notifyType: "warning",
      }),
    ).toEqual([{ type: "notify", kind: "warning", message: "hi" }]);

    expect(
      push(p, { type: "extension_ui_request", id: "s1", method: "setStatus", statusText: "x" }),
    ).toEqual([]);
  });

  test("extension_error → extension.error", () => {
    const p = createProjector();
    expect(push(p, { type: "extension_error", error: "kaput" })).toEqual([
      { type: "extension.error", error: "kaput" },
    ]);
  });
});

describe("applySessionEvent is a replace-fold", () => {
  test("folding the same draft events twice does not duplicate text", () => {
    const p = createProjector();
    const evs = [
      ...push(p, { type: "agent_start" }),
      ...push(p, {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "a" },
      }),
      ...push(p, {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "b" },
      }),
    ];
    const once = fold(evs);
    const twice = fold([...evs, ...evs]);
    expect(once.draft.text).toBe("ab");
    expect(twice.draft.text).toBe("ab");
  });

  test("returned view is the same object when nothing changes", () => {
    const view = emptySessionView();
    expect(applySessionEvent(view, { type: "turn.ended" })).toBe(view);
    expect(applySessionEvent(view, { type: "notify", kind: "info", message: "x" })).toBe(view);
    expect(applySessionEvent(view, { type: "session.ready", sessionId: "s", ts: 1 })).toBe(view);
  });
});
