"use client";

import { useState } from "react";
import { AlertTriangle, Check, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExtensionUiRequest } from "@/lib/pi/types";
import type { Toast } from "@/hooks/usePiSession";

export function DialogModal({
  dialog,
  onAnswer,
}: {
  dialog: ExtensionUiRequest;
  onAnswer: (id: string, payload: { value?: string; confirmed?: boolean; cancelled?: boolean }) => void;
}) {
  const [value, setValue] = useState(
    dialog.method === "editor" ? (dialog.prefill ?? "") : "",
  );

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="fade-up w-full max-w-md overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="border-b border-zinc-800 px-5 py-4">
          <h3 className="text-[14px] font-semibold text-zinc-100">
            {dialog.title ?? "Agent request"}
          </h3>
          {dialog.message && <p className="mt-1 text-[12.5px] text-zinc-400">{dialog.message}</p>}
        </div>
        <div className="px-5 py-4">
          {dialog.method === "select" && (
            <div className="space-y-2">
              {(dialog.options ?? []).map((opt) => (
                <button
                  key={opt}
                  onClick={() => onAnswer(dialog.id, { value: opt })}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-800/60 px-4 py-2.5 text-left text-[13px] text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800"
                >
                  {opt}
                </button>
              ))}
            </div>
          )}
          {dialog.method === "confirm" && (
            <div className="flex gap-2">
              <button
                onClick={() => onAnswer(dialog.id, { confirmed: true })}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-zinc-100 px-4 py-2.5 text-[13px] font-medium text-zinc-950 hover:bg-white"
              >
                <Check size={14} /> Confirm
              </button>
              <button
                onClick={() => onAnswer(dialog.id, { confirmed: false })}
                className="flex-1 rounded-xl border border-zinc-700 px-4 py-2.5 text-[13px] text-zinc-300 hover:bg-zinc-800"
              >
                Cancel
              </button>
            </div>
          )}
          {(dialog.method === "input" || dialog.method === "editor") && (
            <div className="space-y-3">
              {dialog.method === "input" ? (
                <input
                  autoFocus
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onAnswer(dialog.id, { value });
                  }}
                  placeholder={dialog.placeholder ?? "Type a value…"}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3.5 py-2.5 text-[13px] text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
                />
              ) : (
                <textarea
                  autoFocus
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  rows={8}
                  className="w-full resize-y rounded-xl border border-zinc-700 bg-zinc-950 px-3.5 py-2.5 font-mono text-[12.5px] text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
                />
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => onAnswer(dialog.id, { value })}
                  className="flex-1 rounded-xl bg-zinc-100 px-4 py-2 text-[13px] font-medium text-zinc-950 hover:bg-white"
                >
                  Submit
                </button>
                <button
                  onClick={() => onAnswer(dialog.id, { cancelled: true })}
                  className="rounded-xl border border-zinc-700 px-4 py-2 text-[13px] text-zinc-300 hover:bg-zinc-800"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
          {(dialog.method === "select" || dialog.method === "confirm") && (
            <button
              onClick={() => onAnswer(dialog.id, { cancelled: true })}
              className="mt-3 w-full text-center text-[12px] text-zinc-500 hover:text-zinc-300"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[80] flex flex-col gap-2 sm:left-auto sm:right-5 sm:w-[340px]">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "fade-up pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[12.5px] shadow-xl backdrop-blur",
            t.kind === "error" && "border-red-500/30 bg-red-950/90 text-red-200",
            t.kind === "warning" && "border-amber-500/30 bg-amber-950/90 text-amber-200",
            t.kind === "info" && "border-zinc-700 bg-zinc-900/95 text-zinc-300",
          )}
        >
          {t.kind === "error" ? (
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          ) : (
            <Info size={14} className="mt-0.5 shrink-0" />
          )}
          <span className="flex-1">{t.message}</span>
          <button onClick={() => onDismiss(t.id)} className="opacity-60 hover:opacity-100">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
