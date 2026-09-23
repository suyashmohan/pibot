import { describe, expect, test } from "bun:test";
import { PI_SSE_EVENT_TYPES } from "@/lib/client/sse-names";

/**
 * The named SSE event list is the contract between the server stream route and
 * the browser EventSource. `EventSource.onmessage` never fires for named
 * events, so dropping/renaming one here silently breaks live updates.
 */
describe("PI_SSE_EVENT_TYPES", () => {
  test("is the exact 25-name snapshot the stream route emits", () => {
    expect(PI_SSE_EVENT_TYPES).toEqual([
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
    ]);
  });

  test("has no duplicates", () => {
    expect(new Set(PI_SSE_EVENT_TYPES).size).toBe(PI_SSE_EVENT_TYPES.length);
  });
});
