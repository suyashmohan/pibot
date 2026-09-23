"use client";

import { Braces, Copy, Download, Eraser, Shrink, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type MobileAction = "commands" | "compact" | "copy" | "export" | "clear";

/** Mirrors the desktop action row, icon for icon, so the mobile menu isn't text-only. */
export const MOBILE_ACTIONS: ReadonlyArray<{ action: MobileAction; label: string; icon: LucideIcon }> = [
  { action: "commands", label: "Slash commands", icon: Braces },
  { action: "compact", label: "Compact context", icon: Shrink },
  { action: "copy", label: "Copy last reply", icon: Copy },
  { action: "export", label: "Export session (HTML)", icon: Download },
  { action: "clear", label: "Clear queued messages", icon: Eraser },
];

export function MobileActionsMenu({
  onSelect,
  className,
}: {
  onSelect: (action: MobileAction) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-line-strong/70 bg-panel py-1 shadow-2xl",
        className,
      )}
    >
      {MOBILE_ACTIONS.map(({ action, label, icon: Icon }) => (
        <button
          key={action}
          type="button"
          onClick={() => onSelect(action)}
          className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] text-fg-secondary transition hover:bg-raised hover:text-fg"
        >
          <Icon size={14} className="shrink-0 text-fg-subtle" aria-hidden />
          {label}
        </button>
      ))}
    </div>
  );
}
