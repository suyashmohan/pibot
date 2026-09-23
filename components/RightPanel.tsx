"use client";

import { cn } from "@/lib/utils";

/**
 * Shared chrome for the right-hand rails (Files, Git).
 *
 * The two panels occupy the same slot and must keep the exact same
 * footprint: docked next to the chat from `md` up (a narrow rail so the
 * conversation keeps its width), full-viewport takeover on phones and in
 * "full" mode. Only one rail is mounted at a time.
 */

export type RightPanelMode = "docked" | "full";

export function rightPanelClass(mode: RightPanelMode): string {
  return cn(
    "flex flex-col bg-app",
    mode === "full"
      ? "fixed inset-0 z-50"
      : // Phones: full-screen takeover under the drawer/scrim. Desktop: docked rail.
        "fixed inset-0 z-20 md:static md:z-auto md:w-[300px] md:shrink-0 md:border-l md:border-line/80 lg:w-[340px]",
  );
}

export function PanelIconButton({
  title,
  onClick,
  active,
  disabled,
  className,
  children,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-lg p-1.5 transition disabled:opacity-30",
        active ? "bg-raised text-fg" : "text-fg-subtle hover:bg-raised hover:text-fg",
        className,
      )}
    >
      {children}
    </button>
  );
}
