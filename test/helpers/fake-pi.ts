#!/usr/bin/env bun
/**
 * Minimal fake `pi --mode rpc` agent for tests.
 *
 * Ignores argv, speaks the JSONL protocol on stdin/stdout, keeps messages
 * in memory. Selected via the `PI_BINARY` env var — no test ever touches a
 * real LLM or the network.
 *
 * Env knobs:
 * - FAKE_PI_SESSION_FILE: reported sessionFile (default /tmp/fake-pi-session.jsonl)
 * - FAKE_PI_CRLF=1: terminate output lines with \r\n (framing tests)
 * - FAKE_PI_SEED_MESSAGES: JSON array prepended to the message list
 * - FAKE_PI_SLOW_TURN_MS: holds the turn open this long (ms) between the
 *   streaming events and message_end/settled, so tests observe streaming
 *
 * Special command `{"type":"never_reply"}` is swallowed for timeout tests.
 */

interface Msg {
  role: string;
  [k: string]: unknown;
}

const sessionId = "fake-pi-session";
const sessionFile = process.env.FAKE_PI_SESSION_FILE ?? "/tmp/fake-pi-session.jsonl";
const EOL = process.env.FAKE_PI_CRLF === "1" ? "\r\n" : "\n";

let thinkingLevel = "medium";
let sessionName = "fake";
const messages: Msg[] = [];
try {
  const seed = JSON.parse(process.env.FAKE_PI_SEED_MESSAGES ?? "null") as unknown;
  if (Array.isArray(seed)) messages.push(...(seed as Msg[]));
} catch {
  /* no seed */
}

function send(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj) + EOL);
}

function respond(
  id: unknown,
  command: string,
  success = true,
  data?: unknown,
  error?: string,
): void {
  send({
    id,
    type: "response",
    command,
    success,
    ...(data !== undefined ? { data } : {}),
    ...(error ? { error } : {}),
  });
}

function handle(cmd: Record<string, unknown>): void {
  const { id, type } = cmd;
  switch (type) {
    case "get_state":
      respond(id, String(type), true, {
        model: { id: "fake-model", provider: "fake", name: "Fake Model" },
        thinkingLevel,
        isStreaming: false,
        isCompacting: false,
        steeringMode: "one-at-a-time",
        followUpMode: "one-at-a-time",
        sessionFile,
        sessionId,
        sessionName,
        autoCompactionEnabled: true,
        messageCount: messages.length,
        pendingMessageCount: 0,
      });
      break;
    case "get_messages":
      respond(id, String(type), true, { messages });
      break;
    case "prompt": {
      const text = String(cmd.message ?? "");
      messages.push({ role: "user", content: text, timestamp: Date.now() });
      respond(id, String(type), true);
      // Slow-turn hold is honored inside the burst (see burstAsync).
      burst(text);
      break;
    }

function burst(text: string): void {
  void burstAsync(text);
}

async function burstAsync(text: string): Promise<void> {
  const reply = `echo: ${text}`;
  send({ type: "agent_start" });
      send({
        type: "message_start",
        message: { role: "assistant", content: [], timestamp: Date.now() },
      });
      send({
        type: "message_update",
        usage: {},
        assistantMessageEvent: { type: "text_start", contentIndex: 0 },
      });
      const mid = Math.ceil(reply.length / 2);
      for (const part of [reply.slice(0, mid), reply.slice(mid)]) {
        send({
          type: "message_update",
          usage: {},
          assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: part },
        });
      }
      send({
        type: "message_update",
        usage: {},
        assistantMessageEvent: { type: "text_end", contentIndex: 0, content: reply },
      });
      // Slow-turn mode holds the turn open so tests observe streaming state.
      const holdMs = Number(process.env.FAKE_PI_SLOW_TURN_MS ?? "0");
      if (Number.isFinite(holdMs) && holdMs > 0) await Bun.sleep(holdMs);
      const amsg: Msg = {
        role: "assistant",
        content: [{ type: "text", text: reply }],
        timestamp: Date.now(),
        stopReason: "stop",
      };
      messages.push(amsg);
      send({ type: "message_end", message: amsg });
      send({ type: "turn_end", message: amsg, toolResults: [] });
      send({ type: "agent_end", messages: [amsg], willRetry: false });
      send({ type: "agent_settled" });
}
    case "get_available_models":
      respond(id, String(type), true, {
        models: [{ id: "fake-model", provider: "fake", name: "Fake Model" }],
      });
      break;
    case "get_available_thinking_levels":
      respond(id, String(type), true, { levels: ["off", "low", "high"] });
      break;
    case "set_thinking_level":
      thinkingLevel = String(cmd.level ?? thinkingLevel);
      respond(id, String(type), true);
      break;
    case "set_session_name":
      sessionName = String(cmd.name ?? sessionName);
      respond(id, String(type), true);
      break;
    case "get_session_stats":
      respond(id, String(type), true, {
        sessionFile,
        sessionId,
        userMessages: 1,
        assistantMessages: 1,
        totalMessages: 2,
        tokens: { total: 10 },
        cost: 0,
      });
      break;
    case "never_reply":
      break; // swallowed on purpose (client timeout tests)
    default:
      respond(id, String(type ?? "unknown"), true, {});
  }
}

let buf = "";
process.stdin.on("data", (chunk: Buffer) => {
  buf += chunk.toString("utf8");
  for (;;) {
    const idx = buf.indexOf("\n");
    if (idx === -1) break;
    let line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (!line.trim()) continue;
    try {
      handle(JSON.parse(line) as Record<string, unknown>);
    } catch {
      /* ignore malformed input */
    }
  }
});
