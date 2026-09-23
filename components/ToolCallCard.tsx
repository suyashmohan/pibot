"use client";

import { useState } from "react";
import {
  Brain,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Loader2,
  Terminal,
  Wrench,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentMessage, ToolCallContent } from "@/lib/control/types";
import { Markdown } from "./Markdown";

function formatArgs(args: Record<string, unknown>): string {
  try {
    const s = JSON.stringify(args, null, 2);
    return s.length > 4000 ? s.slice(0, 4000) + "\n…(truncated)" : s;
  } catch {
    return String(args);
  }
}

function toolSummary(name: string, args: Record<string, unknown>): string {
  const a = args as Record<string, unknown>;
  if (name === "read" && typeof a.path === "string") return a.path;
  if ((name === "write" || name === "edit") && typeof a.path === "string") return a.path;
  if (name === "bash" && typeof a.command === "string") return String(a.command).slice(0, 90);
  const keys = Object.keys(a);
  if (!keys.length) return "";
  const first = a[keys[0]];
  if (typeof first === "string") return first.slice(0, 90);
  return "";
}

export function ToolCallCard({
  call,
  result,
  liveText,
  defaultOpen = false,
}: {
  call: ToolCallContent;
  result?: AgentMessage | null;
  liveText?: string | null;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isError =
    result != null && (result as { isError?: boolean }).isError === true;
  const running = !result && liveText !== undefined;
  const summary = toolSummary(call.name, call.arguments ?? {});

  const resultText = (() => {
    if (liveText) return liveText;
    if (!result) return "";
    const c = (result as { content?: Array<{ text?: string }> }).content ?? [];
    const t = c.map((b) => String(b.text ?? "")).join("");
    return t.length > 6000 ? t.slice(0, 6000) + "\n…(truncated)" : t;
  })();

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border text-left",
        isError ? "border-danger/30 bg-danger/[0.04]" : "border-line bg-panel/60",
      )}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-raised/40"
      >
        <span
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
            isError ? "bg-danger/15 text-danger" : "bg-raised text-fg-secondary",
          )}
        >
          {running ? (
            <Loader2 size={13} className="animate-spin" />
          ) : isError ? (
            <XCircle size={13} />
          ) : result ? (
            <CheckCircle2 size={13} className="text-success" />
          ) : (
            <Wrench size={13} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="font-mono text-[12.5px] font-medium text-fg">{call.name}</span>
          {summary && (
            <span className="ml-2 truncate font-mono text-[12px] text-fg-subtle">{summary}</span>
          )}
        </span>
        {running && <span className="text-[11px] text-fg-subtle">running…</span>}
        <ChevronDown
          size={14}
          className={cn("shrink-0 text-fg-subtle transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="border-t border-line/80 px-3 py-2.5">
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-fg-subtle">
            Arguments
          </div>
          <pre className="overflow-x-auto rounded-lg bg-app/80 p-2.5 font-mono text-[11.5px] leading-relaxed text-fg-secondary">
            {formatArgs(call.arguments ?? {})}
          </pre>
          {(resultText || running) && (
            <>
              <div className="mb-1.5 mt-3 text-[10.5px] font-semibold uppercase tracking-wider text-fg-subtle">
                {running && !result ? "Live output" : "Result"}
              </div>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-app/80 p-2.5 font-mono text-[11.5px] leading-relaxed text-fg-secondary">
                {resultText || <span className="text-fg-faint">…</span>}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ThinkingBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false);
  const preview = text.replace(/\s+/g, " ").slice(0, 110);
  return (
    <div className="rounded-xl border border-accent-2/20 bg-accent-2/[0.05]">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-accent-2/90 transition hover:bg-accent-2/10"
      >
        {streaming ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <Brain size={12} className="shrink-0" />
        )}
        <span className="font-medium">{streaming ? "Thinking…" : "Reasoning"}</span>
        {!open && <span className="truncate text-accent-2/50">{preview}</span>}
        <ChevronDown size={13} className={cn("ml-auto shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-accent-2/15 px-3 py-2 text-[12.5px] leading-relaxed text-fg-muted">
          <Markdown text={text} />
        </div>
      )}
    </div>
  );
}

export function BashExecutionBlock({ message }: { message: AgentMessage }) {
  const m = message as unknown as {
    command: string;
    output: string;
    exitCode: number;
    truncated?: boolean;
  };
  const [open, setOpen] = useState(true);
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-code">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-raised/30"
      >
        <Terminal size={13} className="shrink-0 text-fg-muted" />
        <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg-secondary">
          $ {m.command}
        </code>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 font-mono text-[10.5px]",
            m.exitCode === 0 ? "bg-success/10 text-success" : "bg-danger/10 text-danger",
          )}
        >
          {m.exitCode === 0 ? "exit 0" : `exit ${m.exitCode}`}
        </span>
        <ChevronDown size={13} className={cn("text-fg-subtle transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words border-t border-line/70 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-fg-muted">
          {m.output || <span className="text-fg-faint">(no output)</span>}
          {m.truncated && <span className="text-warning/80">{"\n…(truncated)"}</span>}
        </pre>
      )}
    </div>
  );
}

export function PendingBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line-strong/60 bg-raised/60 px-2.5 py-1 text-[11px] text-fg-muted">
      <CircleDashed size={11} className="streaming-dot" />
      working
    </span>
  );
}
