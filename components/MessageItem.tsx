"use client";

import { AlertTriangle, User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentMessage, AssistantMessage, ToolCallContent } from "@/lib/control/types";
import { Markdown } from "./Markdown";
import { BashExecutionBlock, ThinkingBlock, ToolCallCard } from "./ToolCallCard";

function userText(m: AgentMessage): { text: string; hasImage: boolean } {
  const c = (m as { content?: unknown }).content;
  if (typeof c === "string") return { text: c, hasImage: false };
  if (Array.isArray(c)) {
    const parts: string[] = [];
    let hasImage = false;
    for (const b of c as Array<{ type?: string; text?: string }>) {
      if (typeof b === "string") parts.push(b);
      else if (b?.type === "text") parts.push(String(b.text ?? ""));
      else if (b?.type === "image") hasImage = true;
    }
    return { text: parts.join(""), hasImage };
  }
  return { text: "", hasImage: false };
}

export function MessageItem({
  message,
  toolResults,
  toolLive,
  streaming,
}: {
  message: AgentMessage;
  toolResults: Map<string, AgentMessage>;
  toolLive: Record<string, { name: string; text: string }>;
  streaming?: boolean;
}) {
  const role = (message as { role?: string }).role ?? "unknown";

  if (role === "user") {
    const { text, hasImage } = userText(message);
    // Skip internal bash-context echoes? No — bashExecution covers those.
    return (
      <div className="fade-up flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md border border-line-strong/40 bg-raised/70 px-4 py-2.5">
          <div className="mb-1 flex items-center justify-end gap-1.5 text-[11px] font-medium text-fg-subtle">
            <User size={11} />
            You
          </div>
          <div className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-fg">{text}</div>
          {hasImage && (
            <div className="mt-1.5 text-[11px] text-fg-subtle">+ attached image(s)</div>
          )}
        </div>
      </div>
    );
  }

  if (role === "assistant") {
    const m = message as AssistantMessage;
    const blocks = m.content ?? [];
    const texts = blocks.filter((b) => b.type === "text");
    const thinkings = blocks.filter((b) => b.type === "thinking");
    const calls = blocks.filter((b) => b.type === "toolCall") as ToolCallContent[];
    if (!blocks.length) return null;
    return (
      <div className="fade-up min-w-0">
        <div className="space-y-2.5">
          {thinkings.map((t, i) => (
            <ThinkingBlock
              key={`th-${i}`}
              text={t.type === "thinking" ? t.thinking : ""}
              streaming={streaming && i === thinkings.length - 1 && texts.length === 0}
            />
          ))}
          {texts.map((t, i) => (
            <div key={`tx-${i}`} className="min-w-0 text-fg">
              <Markdown text={t.type === "text" ? t.text : ""} />
              {streaming && i === texts.length - 1 && calls.length === 0 && (
                <span className="streaming-dot ml-1 inline-block h-3.5 w-1.5 translate-y-0.5 rounded-sm bg-fg-muted" />
              )}
            </div>
          ))}
          {calls.length > 0 && (
            <div className="space-y-2">
              {calls.map((c) => (
                <ToolCallCard
                  key={c.id}
                  call={c}
                  result={toolResults.get(c.id)}
                  liveText={toolLive[c.id]?.text}
                  defaultOpen={false}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (role === "toolResult") {
    // Standalone tool results are already shown inside their ToolCallCard.
    // Only render orphan results (no matching call found).
    const id = String((message as { toolCallId?: unknown }).toolCallId ?? "");
    if (id && toolResults.has(id)) return null;
    const m = message as { toolName?: string; content?: Array<{ text?: string }>; isError?: boolean };
    const text = (m.content ?? []).map((b) => String(b.text ?? "")).join("");
    if (!text.trim()) return null;
    return (
      <div
        className={cn(
          "overflow-hidden rounded-xl border text-[12px]",
          m.isError ? "border-danger/25 bg-danger/[0.04]" : "border-line/80 bg-panel/40",
        )}
      >
        <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-fg-subtle">
          {m.isError && <AlertTriangle size={11} className="text-danger" />}
          <span className="font-mono">{m.toolName ?? "tool"} result</span>
        </div>
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words border-t border-line/60 px-3 py-2 font-mono text-[11.5px] text-fg-muted">
          {text.slice(0, 4000)}
        </pre>
      </div>
    );
  }

  if (role === "bashExecution") {
    return (
      <div className="fade-up">
        <BashExecutionBlock message={message} />
      </div>
    );
  }

  return null;
}
