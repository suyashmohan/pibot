"use client";

import { useState } from "react";
import { AlertTriangle, Check, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExtensionUiRequest } from "@/lib/control/types";
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
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-overlay/70 p-4 backdrop-blur-sm">
      <div className="fade-up w-full max-w-md overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-2xl">
        <div className="border-b border-line px-5 py-4">
          <h3 className="text-[14px] font-semibold text-fg">
            {dialog.title ?? "Agent request"}
          </h3>
          {dialog.message && <p className="mt-1 text-[12.5px] text-fg-muted">{dialog.message}</p>}
        </div>
        <div className="px-5 py-4">
          {dialog.method === "select" && (
            <div className="space-y-2">
              {(dialog.options ?? []).map((opt) => (
                <button
                  key={opt}
                  onClick={() => onAnswer(dialog.id, { value: opt })}
                  className="w-full rounded-xl border border-line-strong bg-raised/60 px-4 py-2.5 text-left text-[13px] text-fg transition hover:border-line-focus hover:bg-raised"
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
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-[13px] font-medium text-primary-fg hover:bg-primary-hover"
              >
                <Check size={14} /> Confirm
              </button>
              <button
                onClick={() => onAnswer(dialog.id, { confirmed: false })}
                className="flex-1 rounded-xl border border-line-strong px-4 py-2.5 text-[13px] text-fg-secondary hover:bg-raised"
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
                  className="w-full rounded-xl border border-line-strong bg-app px-3.5 py-2.5 text-[13px] text-fg placeholder:text-fg-faint focus:border-line-focus focus:outline-none"
                />
              ) : (
                <textarea
                  autoFocus
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  rows={8}
                  className="w-full resize-y rounded-xl border border-line-strong bg-app px-3.5 py-2.5 font-mono text-[12.5px] text-fg placeholder:text-fg-faint focus:border-line-focus focus:outline-none"
                />
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => onAnswer(dialog.id, { value })}
                  className="flex-1 rounded-xl bg-primary px-4 py-2 text-[13px] font-medium text-primary-fg hover:bg-primary-hover"
                >
                  Submit
                </button>
                <button
                  onClick={() => onAnswer(dialog.id, { cancelled: true })}
                  className="rounded-xl border border-line-strong px-4 py-2 text-[13px] text-fg-secondary hover:bg-raised"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
          {(dialog.method === "select" || dialog.method === "confirm") && (
            <button
              onClick={() => onAnswer(dialog.id, { cancelled: true })}
              className="mt-3 w-full text-center text-[12px] text-fg-subtle hover:text-fg-secondary"
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
            t.kind === "error" && "border-danger/30 bg-danger-surface/90 text-danger-soft",
            t.kind === "warning" && "border-warning/30 bg-warning-surface/90 text-warning-soft",
            t.kind === "info" && "border-line-strong bg-panel/95 text-fg-secondary",
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
