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
import type { AgentMessage, ToolCallContent } from "@/lib/pi/types";
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
        isError ? "border-red-500/30 bg-red-500/[0.04]" : "border-zinc-800 bg-zinc-900/60",
      )}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-zinc-800/40"
      >
        <span
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
            isError ? "bg-red-500/15 text-red-400" : "bg-zinc-800 text-zinc-300",
          )}
        >
          {running ? (
            <Loader2 size={13} className="animate-spin" />
          ) : isError ? (
            <XCircle size={13} />
          ) : result ? (
            <CheckCircle2 size={13} className="text-emerald-400" />
          ) : (
            <Wrench size={13} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="font-mono text-[12.5px] font-medium text-zinc-200">{call.name}</span>
          {summary && (
            <span className="ml-2 truncate font-mono text-[12px] text-zinc-500">{summary}</span>
          )}
        </span>
        {running && <span className="text-[11px] text-zinc-500">running…</span>}
        <ChevronDown
          size={14}
          className={cn("shrink-0 text-zinc-500 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="border-t border-zinc-800/80 px-3 py-2.5">
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-500">
            Arguments
          </div>
          <pre className="overflow-x-auto rounded-lg bg-zinc-950/80 p-2.5 font-mono text-[11.5px] leading-relaxed text-zinc-300">
            {formatArgs(call.arguments ?? {})}
          </pre>
          {(resultText || running) && (
            <>
              <div className="mb-1.5 mt-3 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-500">
                {running && !result ? "Live output" : "Result"}
              </div>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-zinc-950/80 p-2.5 font-mono text-[11.5px] leading-relaxed text-zinc-300">
                {resultText || <span className="text-zinc-600">…</span>}
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
    <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.05]">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-violet-300/90 transition hover:bg-violet-500/10"
      >
        {streaming ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <Brain size={12} className="shrink-0" />
        )}
        <span className="font-medium">{streaming ? "Thinking…" : "Reasoning"}</span>
        {!open && <span className="truncate text-violet-300/50">{preview}</span>}
        <ChevronDown size={13} className={cn("ml-auto shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-violet-500/15 px-3 py-2 text-[12.5px] leading-relaxed text-zinc-400">
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
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-[#0c0c0e]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-800/30"
      >
        <Terminal size={13} className="shrink-0 text-zinc-400" />
        <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-zinc-300">
          $ {m.command}
        </code>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 font-mono text-[10.5px]",
            m.exitCode === 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400",
          )}
        >
          {m.exitCode === 0 ? "exit 0" : `exit ${m.exitCode}`}
        </span>
        <ChevronDown size={13} className={cn("text-zinc-500 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words border-t border-zinc-800/70 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-zinc-400">
          {m.output || <span className="text-zinc-600">(no output)</span>}
          {m.truncated && <span className="text-amber-400/80">{"\n…(truncated)"}</span>}
        </pre>
      )}
    </div>
  );
}

export function PendingBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-1 text-[11px] text-zinc-400">
      <CircleDashed size={11} className="streaming-dot" />
      working
    </span>
  );
}
