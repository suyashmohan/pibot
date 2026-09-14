/** Shared pi RPC + agent message types (subset of pi's rpc-types). */

export type RpcCommand = Record<string, unknown> & { type: string; id?: string };

export interface RpcResponse {
  id?: string;
  type: "response";
  command: string;
  success: boolean;
  error?: string;
  data?: unknown;
}

export type PiEvent = Record<string, unknown> & { type: string; id?: string };

export interface TextContent {
  type: "text";
  text: string;
}

export interface ThinkingContent {
  type: "thinking";
  thinking: string;
}

export interface ToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type AssistantContent = TextContent | ThinkingContent | ToolCallContent;

export interface UserMessage {
  role: "user";
  content: string | Array<{ type: string; [k: string]: unknown }>;
  timestamp: number;
  attachments?: unknown[];
}

export interface AssistantMessage {
  role: "assistant";
  /**
   * Synthetic identity of the in-flight streamed draft (set by
   * `streamingAssistantMessage`). Real pi messages have no id; the draft has no
   * stable timestamp either — it's rebuilt for every streamed delta — so this
   * is what React keys on to avoid remounting the active row per token.
   */
  id?: string;
  content: AssistantContent[];
  api?: string;
  provider?: string;
  model?: string;
  usage?: Usage;
  stopReason?: string;
  timestamp: number;
}

export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: Array<{ type: string; text?: string; [k: string]: unknown }>;
  isError?: boolean;
  usage?: Usage;
  timestamp: number;
}

export interface BashExecutionMessage {
  role: "bashExecution";
  command: string;
  output: string;
  exitCode: number;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath?: string | null;
  timestamp: number;
}

export type AgentMessage =
  | UserMessage
  | AssistantMessage
  | ToolResultMessage
  | BashExecutionMessage
  | (Record<string, unknown> & { role: string });

/** Stable id for the assistant draft that is still streaming. */
export const STREAMING_MESSAGE_ID = "pibot:streaming-draft";

/**
 * Build the assistant message for a still-streaming turn.
 *
 * `timestamp` defaults to now, but the draft is re-created on every streamed
 * delta, so the timestamp is NOT its identity: `id` is. Keying transcript rows
 * on the timestamp would remount the active step on every token (blinking
 * `.fade-up` animations, collapsed thinking/tool cards).
 */
export function streamingAssistantMessage(
  content: AssistantContent[],
  timestamp = Date.now(),
): AssistantMessage {
  return {
    role: "assistant",
    id: STREAMING_MESSAGE_ID,
    content,
    timestamp,
    stopReason: "streaming",
  };
}

export interface CostBreakdown {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
}

/**
 * A live pi subprocess, as surfaced by the running-processes panel.
 * `sessionId` is null for the shared server-side metadata process, which
 * belongs to no web session.
 */
export interface RunningProcessInfo {
  sessionId: string | null;
  kind: "session" | "server";
  /** Web session name (or a fixed label for the metadata process). */
  name: string;
  /** Working directory the process was spawned in (= the project folder). */
  cwd: string;
  pid: number | null;
  /** Agent working (agent_start..agent_settled) or compacting. */
  busy: boolean;
  startedAt: number;
  /** Last RPC activity — what the idle reaper measures. */
  lastActivity: number;
}

/** Process-management limits the server enforces (shown in the panel). */
export interface ProcessLimits {
  /** Soft cap on concurrent processes; 0 = unlimited. */
  maxProcesses: number;
  /** Idle reap timeout; 0 = never reaped. */
  idleTimeoutMs: number;
}

export interface Usage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  total?: number;
  cost?: CostBreakdown | number;
}

export interface PiModel {
  id: string;
  name?: string;
  api?: string;
  provider?: string;
  baseUrl?: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: Record<string, number>;
  [k: string]: unknown;
}

export interface SessionState {
  model?: PiModel | null;
  thinkingLevel?: string;
  isStreaming?: boolean;
  isCompacting?: boolean;
  steeringMode?: string;
  followUpMode?: string;
  sessionFile?: string;
  sessionId?: string;
  sessionName?: string;
  autoCompactionEnabled?: boolean;
  messageCount?: number;
  pendingMessageCount?: number;
  [k: string]: unknown;
}

export interface SessionStats {
  sessionFile?: string;
  sessionId?: string;
  userMessages?: number;
  assistantMessages?: number;
  toolCalls?: number;
  toolResults?: number;
  totalMessages?: number;
  tokens?: Usage & { total?: number };
  cost?: number | CostBreakdown;
  contextUsage?: {
    tokens?: number | null;
    contextWindow?: number | null;
    percent?: number | null;
  } | null;
  [k: string]: unknown;
}

export interface ExtensionUiRequest extends Record<string, unknown> {
  type: "extension_ui_request";
  id: string;
  method:
    | "select"
    | "confirm"
    | "input"
    | "editor"
    | "notify"
    | "setStatus"
    | "setWidget"
    | "setTitle"
    | "set_editor_text";
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  notifyType?: string;
  statusKey?: string;
  statusText?: string;
  widgetKey?: string;
  widgetLines?: string[];
  widgetPlacement?: string;
  text?: string;
  timeout?: number;
}

export function assistantText(m: AgentMessage): string {
  if (!m || typeof m !== "object") return "";
  if (m.role === "user") {
    const c = (m as UserMessage).content;
    if (typeof c === "string") return c;
    if (Array.isArray(c))
      return c
        .map((b) =>
          typeof b === "string"
            ? b
            : b.type === "text"
              ? String((b as { text?: unknown }).text ?? "")
              : b.type === "image"
                ? "[image]"
                : "",
        )
        .join("");
    return "";
  }
  if (m.role === "assistant") {
    return ((m as AssistantMessage).content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => (b as TextContent).text)
      .join("");
  }
  if (m.role === "toolResult") {
    const c = (m as ToolResultMessage).content ?? [];
    return c.map((b) => String(b.text ?? "")).join("\n");
  }
  if (m.role === "bashExecution") {
    return (m as BashExecutionMessage).output ?? "";
  }
  return "";
}

export function messagePreview(m: AgentMessage, max = 120): string {
  const role = (m as { role?: string }).role ?? "?";
  if (role === "assistant") {
    const t = assistantText(m).trim();
    if (t) return t.slice(0, max);
    const calls = ((m as AssistantMessage).content ?? []).filter(
      (b) => b.type === "toolCall",
    ) as ToolCallContent[];
    if (calls.length)
      return `Used ${calls.map((c) => c.name).join(", ")}`;
    // Thinking-only messages are common while streaming; showing the reasoning
    // text beats a "…" placeholder (and beats the raw block JSON the sidebar
    // used to render).
    const thinking = ((m as AssistantMessage).content ?? [])
      .filter((b) => b.type === "thinking")
      .map((b) => (b as ThinkingContent).thinking)
      .join(" ")
      .trim();
    if (thinking) return thinking.slice(0, max);
    return "…";
  }
  const t = assistantText(m).trim().replace(/\s+/g, " ");
  return t ? t.slice(0, max) : "…";
}
