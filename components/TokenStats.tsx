"use client";

import { useEffect, useRef, useState } from "react";
import { cn, formatCost, formatTokens, tokenBreakdown, type TokenUsageLike } from "@/lib/utils";

function Row({
  label,
  value,
  hint,
  indent,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  indent?: boolean;
  strong?: boolean;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 px-1 py-[3px]", indent && "pl-3.5")}>
      <span className={cn("text-fg-subtle", strong && "text-fg-secondary")}>{label}</span>
      <span className={cn("font-mono tabular-nums text-fg-secondary", strong && "text-fg")}>
        {value}
        {hint && <span className="ml-1.5 text-fg-subtle">{hint}</span>}
      </span>
    </div>
  );
}

/** Popover body: input / cache hit / cache miss / output (+ total & cost). */
export function TokenBreakdownPanel({
  tokens,
  cost,
  className,
}: {
  tokens?: TokenUsageLike | null;
  cost?: number | null;
  className?: string;
}) {
  const b = tokenBreakdown(tokens);
  if (!b) {
    return (
      <div className={cn("w-56 px-1 py-0.5 text-[11px] text-fg-subtle", className)}>
        No token usage yet
      </div>
    );
  }

  const showCache = b.cached > 0 || b.cacheWrite > 0;
  const hitRate = b.hitRate != null ? `${(b.hitRate * 100).toFixed(1)}% hit` : undefined;

  return (
    <div className={cn("w-56 text-[11px]", className)}>
      <div className="px-1 pb-1 text-[9.5px] font-medium uppercase tracking-wider text-fg-faint">
        Token usage
      </div>
      <Row label="Input" value={formatTokens(b.input)} />
      {showCache && <Row label="Cache hit" value={formatTokens(b.cached)} hint={hitRate} indent />}
      {showCache && (
        <Row
          label="Cache miss"
          value={formatTokens(b.uncached)}
          hint={b.cacheWrite > 0 ? `${formatTokens(b.cacheWrite)} written to cache` : undefined}
          indent
        />
      )}
      <Row label="Output" value={formatTokens(b.output)} />
      <div className="my-1.5 h-px bg-raised" />
      <Row label="Total" value={formatTokens(b.total)} strong />
      {cost != null && <Row label="Cost" value={formatCost(cost)} />}
    </div>
  );
}

/**
 * Header chip showing total tokens. Hovering (or focusing — the chip is
 * keyboard reachable) reveals the input / cache hit / cache miss / output
 * breakdown. Tap-opened popovers are dismissed by a pointerdown outside,
 * because iOS Safari never focuses a tapped button (so `onBlur` alone left
 * the panel stranded open on phones).
 */
export function TokenStats({
  tokens,
  cost,
  align = "right",
}: {
  tokens?: TokenUsageLike | null;
  cost?: number | null;
  /** Which edge of the chip the popover pins to. Use `left` near the screen's left edge. */
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="Token usage details"
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        className={cn(
          "rounded-md bg-panel px-2 py-1 font-mono text-[10.5px] text-fg-muted transition",
          "hover:bg-raised hover:text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-line-focus",
          open && "bg-raised text-fg",
        )}
      >
        {formatTokens(tokens?.total)} tok
      </button>
      {open && (
        // Padding on the wrapper bridges the gap to the chip so the pointer
        // can travel into the panel without a mouseleave flicker.
        <div className={cn("absolute top-full z-50 pt-1.5", align === "left" ? "left-0" : "right-0")}>
          <div className="rounded-xl border border-line-strong/70 bg-panel p-2 shadow-2xl">
            <TokenBreakdownPanel tokens={tokens} cost={cost} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The full stat strip — tokens (with hover/tap breakdown), cost and context
 * percent. Rendered twice by the chat header: an inline row from `lg` up and a
 * full-width mobile/tablet strip below it.
 */
export function SessionStatChips({
  tokens,
  cost,
  ctx,
  align = "right",
  className,
}: {
  tokens?: TokenUsageLike | null;
  cost?: number | null;
  ctx?: { percent?: number | null; tokens?: number | null; contextWindow?: number | null } | null;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <TokenStats tokens={tokens} cost={cost} align={align} />
      <span
        className="rounded-md bg-panel px-2 py-1 font-mono text-[10.5px] text-fg-muted"
        title="Cost"
      >
        {formatCost(cost)}
      </span>
      {ctx?.percent != null && (
        <span
          className={cn(
            "rounded-md px-2 py-1 font-mono text-[10.5px]",
            (ctx.percent ?? 0) > 80 ? "bg-warning/10 text-warning-soft" : "bg-panel text-fg-muted",
          )}
          title={`Context: ${formatTokens(ctx.tokens)} / ${formatTokens(ctx.contextWindow)}`}
        >
          {Math.round(ctx.percent)}% ctx
        </span>
      )}
    </div>
  );
}
