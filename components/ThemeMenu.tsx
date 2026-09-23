"use client";

import { useState } from "react";
import { Check, Palette } from "lucide-react";
import { useTheme } from "./ThemeProvider";
import type { ThemeDefinition } from "@/lib/themes";
import { cn } from "@/lib/utils";

/** Three-dot preview built from the theme's own swatch colors. */
export function ThemeSwatch({ theme }: { theme: ThemeDefinition }) {
  return (
    <span
      className="flex shrink-0 items-center gap-0.5 rounded-md border border-line p-0.5"
      aria-hidden
    >
      {[theme.preview.app, theme.preview.panel, theme.preview.accent].map((color, i) => (
        <span
          key={i}
          className="h-3 w-3 rounded-[3px]"
          style={{ backgroundColor: color }}
        />
      ))}
    </span>
  );
}

/** Pure list — usable without a provider (falls back to built-ins). */
export function ThemeList({
  active,
  onSelect,
  className,
}: {
  active: string;
  onSelect: (id: string) => void;
  className?: string;
}) {
  const { themes } = useTheme();
  return (
    <div role="menu" aria-label="Theme" className={className}>
      {themes.map((t) => (
        <button
          key={t.id}
          type="button"
          role="menuitemradio"
          aria-checked={t.id === active}
          onClick={() => onSelect(t.id)}
          className={cn(
            "flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] transition hover:bg-raised",
            t.id === active ? "text-fg" : "text-fg-secondary",
          )}
        >
          <ThemeSwatch theme={t} />
          <span className="flex-1 truncate">{t.label}</span>
          {t.id === active && <Check size={14} className="shrink-0 text-accent" aria-hidden />}
        </button>
      ))}
    </div>
  );
}

export function ThemeMenu() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        title="Theme"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[11.5px] transition",
          open
            ? "bg-raised text-fg"
            : "text-fg-muted hover:bg-raised hover:text-fg",
        )}
      >
        <Palette size={13} />
        <span className="hidden sm:inline">Theme</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 top-full z-50 mt-1.5 w-44 overflow-hidden rounded-xl border border-line-strong/70 bg-panel py-1 shadow-2xl">
            <ThemeList
              active={theme}
              onSelect={(id) => {
                setTheme(id);
                setOpen(false);
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}
