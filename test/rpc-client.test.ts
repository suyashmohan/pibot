import { afterEach, describe, expect, test } from "bun:test";
import { PiRpcClient } from "@/lib/pi/rpc-client";
import type { PiEvent } from "@/lib/pi/types";
import { useFakePi } from "./helpers/test-env";

let restore: (() => void) | null = null;
let clients: PiRpcClient[] = [];

function spawn(cwd = "/tmp"): PiRpcClient {
  const c = PiRpcClient.spawn({ cwd });
  clients.push(c);
  return c;
}

afterEach(() => {
  for (const c of clients.splice(0)) c.dispose();
  restore?.();
  restore = null;
});

function withFakePi(extra: Record<string, string> = {}) {
  restore?.();
  restore = useFakePi(extra);
}

describe("PiRpcClient against fake-pi stub", () => {
  test("round-trips commands with id correlation", async () => {
    withFakePi();
    const c = spawn();
    const [a, b] = await Promise.all([
      c.send({ type: "get_state" }),
      c.send({ type: "get_available_models" }),
    ]);
    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    expect((a.data as { sessionId?: string }).sessionId).toBe("fake-pi-session");
    expect((b.data as { models?: unknown[] }).models).toHaveLength(1);
  });

  test("streams prompt events in protocol order", async () => {
    withFakePi();
    const c = spawn();
    const seen: string[] = [];
    const deltas: string[] = [];
    const settled = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no agent_settled")), 15_000);
      c.onEvent((ev: PiEvent) => {
        seen.push(String(ev.type));
        const d = (ev.assistantMessageEvent as { delta?: string } | undefined)?.delta;
        if (typeof d === "string") deltas.push(d);
        if (ev.type === "agent_settled") {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const res = await c.send({ type: "prompt", message: "hi" });
    expect(res.success).toBe(true);
    await settled;
    expect(seen[0]).toBe("agent_start");
    expect(seen).toContain("message_update");
    expect(seen[seen.length - 1]).toBe("agent_settled");
    expect(deltas.join("")).toBe("echo: hi");
  });

  test("accepts CRLF-terminated frames", async () => {
    withFakePi({ FAKE_PI_CRLF: "1" });
    const c = spawn();
    const res = await c.send({ type: "get_state" });
    expect(res.success).toBe(true);
    const got = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no event")), 15_000);
      c.onEvent((ev) => {
        if (ev.type === "agent_settled") {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    await c.send({ type: "prompt", message: "crlf" });
    await got;
  });

  test("times out on unanswered commands but stays alive", async () => {
    withFakePi();
    const c = spawn();
    await expect(c.send({ type: "never_reply" }, { timeoutMs: 100 })).rejects.toThrow("timed out");
    expect(c.alive).toBe(true);
    const res = await c.send({ type: "get_state" });
    expect(res.success).toBe(true);
  });

  test("send after dispose rejects", async () => {
    withFakePi();
    const c = spawn();
    expect(c.alive).toBe(true);
    c.dispose();
    expect(c.alive).toBe(false);
    await expect(c.send({ type: "get_state" })).rejects.toThrow("not running");
  });
});
