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
 * - FAKE_PI_PROMPT_ERROR: makes `prompt` fail with this error text
 *   (does not burst a turn)
 * - FAKE_PI_STEER_ERROR: makes `steer` / `follow_up` fail with this error
 *
 * `clone` / `switch_session` / `new_session` move the reported session
 * file/id so the control-plane clone dance is observable (a naive clone test
 * against a stub that ignores the command would be false-green).
 * `export_html` writes a tiny HTML file — to `outputPath` when given, else to
 * the process cwd, matching real pi's default.
 *
 * Special command `{"type":"never_reply"}` is swallowed for timeout tests.
 */

interface Msg {
  role: string;
  [k: string]: unknown;
}

const baseSessionId = "fake-pi-session";
const baseSessionFile = process.env.FAKE_PI_SESSION_FILE ?? "/tmp/fake-pi-session.jsonl";
const EOL = process.env.FAKE_PI_CRLF === "1" ? "\r\n" : "\n";

let sessionId = baseSessionId;
let sessionFile = baseSessionFile;

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

function responsePayload(
  id: unknown,
  command: string,
  success = true,
  data?: unknown,
  error?: string,
): Record<string, unknown> {
  return {
    id,
    type: "response",
    command,
    success,
    ...(data !== undefined ? { data } : {}),
    ...(error ? { error } : {}),
  };
}

/** One write for several lines — the client reads response+events in one chunk. */
function sendAll(objs: unknown[]): void {
  process.stdout.write(objs.map((o) => JSON.stringify(o) + EOL).join(""));
}

/**
 * Emit the RPC response and one streaming turn. The response and the head of
 * the turn go out in a **single write** (so a fast turn settles in the same
 * stdout chunk the client parses synchronously — the listen-before-send
 * fan-out test depends on that). With FAKE_PI_SLOW_TURN_MS the tail is held
 * back so tests can observe an open turn.
 */
function burstWithResponse(id: unknown, command: string, text: string): void {
  const reply = `echo: ${text}`;
  const mid = Math.ceil(reply.length / 2);
  const head: unknown[] = [
    { type: "agent_start" },
    {
      type: "message_start",
      message: { role: "assistant", content: [], timestamp: Date.now() },
    },
    {
      type: "message_update",
      usage: {},
      assistantMessageEvent: { type: "text_start", contentIndex: 0 },
    },
    ...([reply.slice(0, mid), reply.slice(mid)].map((part) => ({
      type: "message_update",
      usage: {},
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: part },
    }))),
    {
      type: "message_update",
      usage: {},
      assistantMessageEvent: { type: "text_end", contentIndex: 0, content: reply },
    },
  ];
  const amsg: Msg = {
    role: "assistant",
    content: [{ type: "text", text: reply }],
    timestamp: Date.now(),
    stopReason: "stop",
  };
  const tail: unknown[] = [
    { type: "message_end", message: amsg },
    { type: "turn_end", message: amsg, toolResults: [] },
    { type: "agent_end", messages: [amsg], willRetry: false },
    { type: "agent_settled" },
  ];
  const holdMs = Number(process.env.FAKE_PI_SLOW_TURN_MS ?? "0");
  if (Number.isFinite(holdMs) && holdMs > 0) {
    sendAll([responsePayload(id, command), ...head]);
    void Bun.sleep(holdMs).then(() => {
      messages.push(amsg);
      sendAll(tail);
    });
    return;
  }
  messages.push(amsg);
  sendAll([responsePayload(id, command), ...head, ...tail]);
}

async function handle(cmd: Record<string, unknown>): Promise<void> {
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
      const promptError = process.env.FAKE_PI_PROMPT_ERROR;
      if (promptError) {
        respond(id, String(type), false, undefined, promptError);
        break;
      }
      const text = String(cmd.message ?? "");
      messages.push({ role: "user", content: text, timestamp: Date.now() });
      // Response + turn head go out in one write (see burstWithResponse).
      burstWithResponse(id, String(type), text);
      break;
    }
    case "steer":
    case "follow_up": {
      const steerError = process.env.FAKE_PI_STEER_ERROR;
      if (steerError) {
        respond(id, String(type), false, undefined, steerError);
        break;
      }
      const text = String(cmd.message ?? "");
      messages.push({ role: "user", content: text, timestamp: Date.now() });
      burstWithResponse(id, String(type), text);
      break;
    }
    case "clone":
      sessionFile = `${baseSessionFile}.clone-${Date.now()}`;
      sessionId = `${baseSessionId}-clone`;
      respond(id, String(type), true, { sessionFile, sessionId });
      break;
    case "switch_session":
      sessionFile = String(cmd.sessionPath ?? sessionFile);
      sessionId = `${baseSessionId}-switched`;
      respond(id, String(type), true, { sessionFile, sessionId });
      break;
    case "new_session":
      sessionFile = `${baseSessionFile}.new-${Date.now()}`;
      sessionId = `${baseSessionId}-new`;
      respond(id, String(type), true, { sessionFile, sessionId });
      break;

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
    case "export_html": {
      // Real pi defaults to `${cwd}/pi-session-…_….html` when outputPath is
      // omitted — the stub must do the same or the staging regression is
      // invisible.
      const outputPath =
        typeof cmd.outputPath === "string" && cmd.outputPath
          ? cmd.outputPath
          : `${process.cwd()}/pi-session-fake-export.html`;
      await Bun.write(
        outputPath,
        "<!doctype html><html><body>fake export</body></html>",
      );
      respond(id, String(type), true, { path: outputPath });
      break;
    }
    case "never_reply":
      break; // swallowed on purpose (client timeout tests)
    default:
      respond(id, String(type ?? "unknown"), true, {});
  }
}

let buf = "";
// Commands run through a promise queue: `export_html` writes the file before
// responding, and serializing keeps response order stable for pipelined input.
let queue: Promise<void> = Promise.resolve();

process.stdin.on("data", (chunk: Buffer) => {
  buf += chunk.toString("utf8");
  for (;;) {
    const idx = buf.indexOf("\n");
    if (idx === -1) break;
    let line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (!line.trim()) continue;
    queue = queue
      .then(() => handle(JSON.parse(line) as Record<string, unknown>))
      .catch(() => {
        /* ignore malformed input */
      });
  }
});
