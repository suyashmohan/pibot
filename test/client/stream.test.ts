/**
 * Client SDK SSE transport: every named event is registered, each event is
 * projected into a snapshot SessionEvent, and unsubscribe closes the stream.
 *
 * A FakeEventSource that records `addEventListener` is mandatory — an
 * `onmessage`-only implementation must fail this file.
 */
import { describe, expect, test } from "bun:test";
import { PI_SSE_EVENT_TYPES } from "@/lib/client/sse-names";
import { subscribeSession } from "@/lib/client/stream";
import type { SessionEvent } from "@/lib/control/types";

class FakeEventSource {
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readonly registered: string[] = [];
  readyState = 0;
  onmessage: ((ev: unknown) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string): void {
    this.registered.push(name);
  }
  removeEventListener(name: string): void {
    const i = this.registered.indexOf(name);
    if (i >= 0) this.registered.splice(i, 1);
  }
  close(): void {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }
  /** Test helper: deliver one named event. */
  emit(name: string, data: unknown): void {
    const handler = this.onmessage as ((ev: { data: string }) => void) | null;
    if (handler) handler({ data: JSON.stringify(data) });
  }
}

function makeES(): typeof EventSource {
  return FakeEventSource as unknown as typeof EventSource;
}

describe("subscribeSession", () => {
  test("registers every PI_SSE_EVENT_TYPES name", () => {
    FakeEventSource.instances = [];
    const off = subscribeSession("s1", () => {}, { EventSource: makeES() });
    const es = FakeEventSource.instances[0];
    expect(es).toBeDefined();
    expect(es.registered).toEqual([...PI_SSE_EVENT_TYPES]);
    expect(es.url).toBe("/api/sessions/s1/stream");
    off();
  });

  test("text deltas arrive as full draft snapshots", () => {
    FakeEventSource.instances = [];
    const seen: SessionEvent[] = [];
    const off = subscribeSession("s1", (ev) => seen.push(ev), { EventSource: makeES() });
    const es = FakeEventSource.instances[0]!;

    es.emit("agent_start", { type: "agent_start" });
    es.emit("message_update", {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Hel" },
    });
    es.emit("message_update", {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "lo" },
    });

    expect(seen.map((e) => e.type)).toEqual([
      "turn.started",
      "draft.updated",
      "draft.updated",
    ]);
    const drafts = seen.filter(
      (e): e is Extract<SessionEvent, { type: "draft.updated" }> => e.type === "draft.updated",
    );
    expect(drafts[0]!.draft.text).toBe("Hel");
    expect(drafts[1]!.draft.text).toBe("Hello");
    off();
  });

  test("bash deltas are accumulated snapshots, not concatenated by the client", () => {
    FakeEventSource.instances = [];
    const seen: SessionEvent[] = [];
    const off = subscribeSession("s1", (ev) => seen.push(ev), { EventSource: makeES() });
    const es = FakeEventSource.instances[0]!;
    es.emit("bash_execution_update", { type: "bash_execution_update", id: "b", delta: "a" });
    es.emit("bash_execution_update", { type: "bash_execution_update", id: "b", delta: "b" });
    const texts = seen.map((e) => (e.type === "bash.updated" ? e.text : ""));
    expect(texts).toEqual(["a", "ab"]);
    off();
  });

  test("unsubscribe removes listeners and closes the stream", () => {
    FakeEventSource.instances = [];
    const off = subscribeSession("s1", () => {}, { EventSource: makeES() });
    const es = FakeEventSource.instances[0]!;
    off();
    expect(es.registered).toEqual([]);
    expect(es.closed).toBe(true);
  });

  test("onClose fires only when the browser gives up (CLOSED)", () => {
    FakeEventSource.instances = [];
    let closed = 0;
    const off = subscribeSession("s1", () => {}, {
      EventSource: makeES(),
      onClose: () => {
        closed++;
      },
    });
    const es = FakeEventSource.instances[0]!;
    es.readyState = 0;
    es.onerror?.();
    expect(closed).toBe(0);
    es.readyState = FakeEventSource.CLOSED;
    es.onerror?.();
    expect(closed).toBe(1);
    off();
  });
});
