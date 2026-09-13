"use client";

import type { AgentMessage } from "@/lib/pi/types";
import { MessageItem } from "./MessageItem";

/**
 * Stable React key for a transcript row.
 *
 * The in-flight assistant draft is rebuilt on every streamed delta, so keying
 * it by `index-timestamp` (its timestamp is `Date.now()` per update) remounts
 * the row on every token: the `.fade-up` animation replays (blinking) and any
 * expanded thinking/tool state collapses. Drafts carry a synthetic `id` — key
 * on it so the moving row keeps its identity until the message settles.
 */
export function messageKey(m: AgentMessage, index: number): string {
  const id = (m as { id?: unknown }).id;
  if (typeof id === "string" && id) return `id:${id}`;
  const ts = (m as { timestamp?: number }).timestamp ?? 0;
  return `${index}-${ts}`;
}

export function MessageList({
  messages,
  toolResults,
  toolLive,
  streaming,
}: {
  messages: AgentMessage[];
  toolResults: Map<string, AgentMessage>;
  toolLive: Record<string, { name: string; text: string }>;
  streaming: boolean;
}) {
  return (
    <>
      {messages.map((m, i) => (
        <MessageItem
          key={messageKey(m, i)}
          message={m}
          toolResults={toolResults}
          toolLive={toolLive}
          streaming={streaming && i === messages.length - 1}
        />
      ))}
    </>
  );
}
