/**
 * The named SSE event types `/api/sessions/[id]/stream` emits.
 *
 * The server emits **named** events (`event: agent_start` …). Per the SSE spec
 * those are NOT delivered to `onmessage` — a listener must be registered per
 * name. This list is the single exported snapshot; `hooks/usePiSession.ts`
 * used to inline it, and `lib/client/stream.ts` registers every name on the
 * EventSource. Keep `message` last: it is the fallback for unnamed events.
 */
export const PI_SSE_EVENT_TYPES = [
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
] as const;
