"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Check, ChevronDown, Cpu, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PiModel } from "@/lib/control/types";

export function ModelPicker({
  models,
  current,
  thinkingLevels,
  currentThinking,
  onOpen,
  onPick,
  onThinking,
}: {
  models: PiModel[];
  current: PiModel | null | undefined;
  thinkingLevels: string[];
  currentThinking?: string | null;
  /** Called when the picker opens — models are fetched on demand, not on mount. */
  onOpen?: () => void;
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
        onClick={() => {
          if (!open) onOpen?.(); // model list is loaded on demand
          setOpen((o) => !o);
        }}
        className="flex w-full min-w-0 max-w-[200px] items-center gap-2 rounded-xl border border-line-strong/60 bg-panel/70 px-3 py-1.5 text-left transition hover:border-line-focus hover:bg-raised/70 sm:max-w-[320px]"
      >
        <Bot size={14} className="shrink-0 text-fg-muted" />
        <span className="min-w-0">
          <span className="block truncate text-[12.5px] font-medium text-fg">
            {current ? (current.name ?? current.id) : "Select model"}
          </span>
          <span className="block truncate font-mono text-[10.5px] text-fg-subtle">
            {current ? `${current.provider ?? ""}/${current.id}` : "…"}
            {currentThinking ? ` · ${currentThinking}` : ""}
          </span>
        </span>
        <ChevronDown size={14} className="shrink-0 text-fg-subtle" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-[calc(100vw-2rem)] max-w-[380px] overflow-hidden rounded-2xl border border-line-strong/70 bg-panel shadow-2xl">
          <div className="border-b border-line p-2.5">
            <div className="flex items-center gap-2 rounded-lg bg-raised/70 px-2.5 py-1.5">
              <Search size={13} className="text-fg-subtle" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search models…"
                className="w-full bg-transparent text-[13px] text-fg placeholder:text-fg-faint focus:outline-none"
              />
            </div>
            {thinkingLevels.length > 0 && (
              <div className="mt-2 flex items-center gap-1.5 px-1">
                <Cpu size={12} className="text-fg-subtle" />
                <span className="mr-1 text-[11px] text-fg-subtle">Thinking</span>
                <div className="flex flex-wrap gap-1">
                  {thinkingLevels.map((lv) => (
                    <button
                      key={lv}
                      onClick={() => onThinking(lv)}
                      className={cn(
                        "rounded-md px-2 py-0.5 font-mono text-[11px] transition",
                        currentThinking === lv
                          ? "bg-primary text-primary-fg"
                          : "bg-raised text-fg-muted hover:text-fg",
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
                <div className="px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-fg-subtle">
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
                        active ? "bg-raised" : "hover:bg-raised/60",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] text-fg">
                          {m.name ?? m.id}
                        </span>
                        <span className="block truncate font-mono text-[10.5px] text-fg-subtle">
                          {m.id}
                          {m.contextWindow ? ` · ${(m.contextWindow / 1000).toFixed(0)}k ctx` : ""}
                        </span>
                      </span>
                      {active && <Check size={13} className="shrink-0 text-success" />}
                    </button>
                  );
                })}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-6 text-center text-[12.5px] text-fg-subtle">
                No models match “{q}”.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
