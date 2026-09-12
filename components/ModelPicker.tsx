"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Check, ChevronDown, Cpu, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PiModel } from "@/lib/pi/types";

export function ModelPicker({
  models,
  current,
  thinkingLevels,
  currentThinking,
  onPick,
  onThinking,
}: {
  models: PiModel[];
  current: PiModel | null | undefined;
  thinkingLevels: string[];
  currentThinking?: string | null;
  onPick: (m: PiModel) => void;
  onThinking: (level: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const filtered = models.filter((m) => {
    if (!q.trim()) return true;
    const s = `${m.provider ?? ""} ${m.id} ${m.name ?? ""}`.toLowerCase();
    return q.toLowerCase().split(/\s+/).every((t) => s.includes(t));
  });

  const byProvider = new Map<string, PiModel[]>();
  for (const m of filtered.slice(0, 300)) {
    const p = String(m.provider ?? "other");
    if (!byProvider.has(p)) byProvider.set(p, []);
    byProvider.get(p)!.push(m);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex max-w-[320px] items-center gap-2 rounded-xl border border-zinc-700/60 bg-zinc-900/70 px-3 py-1.5 text-left transition hover:border-zinc-600 hover:bg-zinc-800/70"
      >
        <Bot size={14} className="shrink-0 text-zinc-400" />
        <span className="min-w-0">
          <span className="block truncate text-[12.5px] font-medium text-zinc-200">
            {current ? (current.name ?? current.id) : "Select model"}
          </span>
          <span className="block truncate font-mono text-[10.5px] text-zinc-500">
            {current ? `${current.provider ?? ""}/${current.id}` : "…"}
            {currentThinking ? ` · ${currentThinking}` : ""}
          </span>
        </span>
        <ChevronDown size={14} className="shrink-0 text-zinc-500" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-[380px] overflow-hidden rounded-2xl border border-zinc-700/70 bg-zinc-900 shadow-2xl">
          <div className="border-b border-zinc-800 p-2.5">
            <div className="flex items-center gap-2 rounded-lg bg-zinc-800/70 px-2.5 py-1.5">
              <Search size={13} className="text-zinc-500" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search models…"
                className="w-full bg-transparent text-[13px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
              />
            </div>
            {thinkingLevels.length > 0 && (
              <div className="mt-2 flex items-center gap-1.5 px-1">
                <Cpu size={12} className="text-zinc-500" />
                <span className="mr-1 text-[11px] text-zinc-500">Thinking</span>
                <div className="flex flex-wrap gap-1">
                  {thinkingLevels.map((lv) => (
                    <button
                      key={lv}
                      onClick={() => onThinking(lv)}
                      className={cn(
                        "rounded-md px-2 py-0.5 font-mono text-[11px] transition",
                        currentThinking === lv
                          ? "bg-zinc-100 text-zinc-900"
                          : "bg-zinc-800 text-zinc-400 hover:text-zinc-200",
                      )}
                    >
                      {lv}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="max-h-[340px] overflow-y-auto p-1.5">
            {Array.from(byProvider.entries()).map(([provider, list]) => (
              <div key={provider} className="mb-1">
                <div className="px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-500">
                  {provider}
                </div>
                {list.map((m) => {
                  const active = current?.id === m.id && current?.provider === m.provider;
                  return (
                    <button
                      key={`${m.provider}/${m.id}`}
                      onClick={() => {
                        onPick(m);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition",
                        active ? "bg-zinc-800" : "hover:bg-zinc-800/60",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] text-zinc-200">
                          {m.name ?? m.id}
                        </span>
                        <span className="block truncate font-mono text-[10.5px] text-zinc-500">
                          {m.id}
                          {m.contextWindow ? ` · ${(m.contextWindow / 1000).toFixed(0)}k ctx` : ""}
                        </span>
                      </span>
                      {active && <Check size={13} className="shrink-0 text-emerald-400" />}
                    </button>
                  );
                })}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-6 text-center text-[12.5px] text-zinc-500">
                No models match “{q}”.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
