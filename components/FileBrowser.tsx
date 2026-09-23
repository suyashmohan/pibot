"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronUp,
  FolderTree,
  Grid2x2,
  List,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  X,
} from "lucide-react";
import { useDirectoryListing, useFilePreview } from "@/hooks/useFileBrowser";
import { loadFileViewPreference, saveFileViewPreference } from "@/lib/layout";
import { baseName, cn } from "@/lib/utils";
import { breadcrumbs, parentPath, type BrowseEntry, type FileView } from "@/lib/file-browser";
import { FileEntries } from "./FileEntries";
import { FilePreview } from "./FilePreview";

export type FilePanelMode = "docked" | "full";

function IconButton({
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

/**
 * Right-hand file browser for the active session's project folder.
 *
 * One directory level at a time (breadcrumbs + parent button), a list or
 * gallery view (remembered in localStorage), and a preview surface for
 * images, code and markdown. Docked next to the chat from `md` up; on phones
 * and in "full" mode it takes over the viewport. The panel itself is never
 * persisted: it always starts collapsed.
 */
export function FileBrowser({
  sessionId,
  cwd,
  mode,
  onClose,
  onCollapse,
  onExpand,
}: {
  sessionId: string;
  cwd: string;
  mode: FilePanelMode;
  onClose: () => void;
  onCollapse: () => void;
  onExpand: () => void;
}) {
  const [dir, setDir] = useState("");
  const [selected, setSelected] = useState<BrowseEntry | null>(null);
  const [lightbox, setLightbox] = useState(false);
  // null = not hydrated yet: SSR and the first client render show the list.
  const [view, setView] = useState<FileView | null>(null);

  useEffect(() => {
    setView(loadFileViewPreference());
  }, []);
  const effectiveView: FileView = view ?? "list";
  const pickView = (v: FileView) => {
    setView(v);
    saveFileViewPreference(v);
  };

  const listing = useDirectoryListing(sessionId, dir);
  const previewState = useFilePreview(
    sessionId,
    selected && selected.kind !== "image" ? selected.path : null,
  );

  const fileEntries = useMemo(
    () => listing.entries.filter((e) => e.type === "file"),
    [listing.entries],
  );
  const index = selected ? fileEntries.findIndex((e) => e.path === selected.path) : -1;

  const go = useCallback(
    (delta: number) => {
      const next = fileEntries[index + delta];
      if (!next) return;
      setSelected(next);
      setLightbox(false);
    },
    [fileEntries, index],
  );

  const openDir = (entry: BrowseEntry) => {
    setDir(entry.path);
    setSelected(null);
    setLightbox(false);
  };

  // Escape unwinds one layer at a time: lightbox → preview → full → closed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing) return;
      if (e.key === "Escape") {
        if (lightbox) setLightbox(false);
        else if (selected) setSelected(null);
        else if (mode === "full") onCollapse();
        else onClose();
        return;
      }
      if (selected && e.key === "ArrowRight") go(1);
      if (selected && e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, selected, mode, onCollapse, onClose, go]);

  const crumbs = breadcrumbs(dir);

  return (
    <aside
      aria-label="File browser"
      className={cn(
        "flex flex-col bg-app",
        mode === "full"
          ? "fixed inset-0 z-50"
          : // Phones: full-screen takeover under the drawer/scrim. Desktop: docked rail.
            "fixed inset-0 z-20 md:static md:z-auto md:w-[300px] md:shrink-0 md:border-l md:border-line/80 lg:w-[340px]",
      )}
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-line/80 bg-app px-2 py-1.5">
        <IconButton
          title="Parent folder"
          onClick={() => {
            setDir(parentPath(dir));
            setSelected(null);
          }}
          disabled={dir === ""}
          className="shrink-0"
        >
          <ChevronUp size={14} />
        </IconButton>
        <FolderTree size={13} className="shrink-0 text-fg-subtle" />
        <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden text-[11.5px]">
          <button
            type="button"
            onClick={() => {
              setDir("");
              setSelected(null);
            }}
            title={cwd}
            className={cn(
              "shrink-0 rounded px-1 py-0.5 transition hover:bg-raised",
              dir === "" ? "text-fg" : "text-fg-muted",
            )}
          >
            {baseName(cwd)}
          </button>
          {crumbs.map((c, i) => (
            <span key={c.path} className="flex min-w-0 items-center gap-0.5">
              <span className="shrink-0 text-fg-faint">/</span>
              <button
                type="button"
                onClick={() => {
                  setDir(c.path);
                  setSelected(null);
                }}
                className={cn(
                  "truncate rounded px-1 py-0.5 transition hover:bg-raised",
                  i === crumbs.length - 1 ? "text-fg" : "text-fg-muted",
                )}
              >
                {c.name}
              </button>
            </span>
          ))}
        </nav>

        {!selected && (
          <>
            <IconButton
              title="List view"
              onClick={() => pickView("list")}
              active={effectiveView === "list"}
              className="shrink-0"
            >
              <List size={13} />
            </IconButton>
            <IconButton
              title="Gallery view"
              onClick={() => pickView("gallery")}
              active={effectiveView === "gallery"}
              className="shrink-0"
            >
              <Grid2x2 size={13} />
            </IconButton>
            <IconButton title="Refresh folder" onClick={listing.reload} className="shrink-0">
              <RefreshCw size={13} className={cn(listing.loading && "animate-spin")} />
            </IconButton>
          </>
        )}

        {mode === "full" ? (
          <IconButton title="Collapse to side panel" onClick={onCollapse} className="shrink-0">
            <Minimize2 size={13} />
          </IconButton>
        ) : (
          <IconButton
            title="Expand to full size"
            onClick={onExpand}
            className="hidden shrink-0 md:flex"
          >
            <Maximize2 size={13} />
          </IconButton>
        )}
        <IconButton title="Close file browser" onClick={onClose} className="shrink-0">
          <X size={14} />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {selected ? (
          <FilePreview
            sessionId={sessionId}
            entry={selected}
            preview={previewState.data}
            loading={previewState.loading}
            error={previewState.error}
            lightboxOpen={lightbox}
            onToggleLightbox={setLightbox}
            onBack={() => {
              setSelected(null);
              setLightbox(false);
            }}
            onPrev={() => go(-1)}
            onNext={() => go(1)}
            hasPrev={index > 0}
            hasNext={index >= 0 && index < fileEntries.length - 1}
          />
        ) : listing.loading && listing.entries.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[12px] text-fg-subtle">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : listing.error ? (
          <div className="px-4 py-12 text-center">
            <p className="text-[12px] text-danger-soft">{listing.error}</p>
            <button
              type="button"
              onClick={listing.reload}
              className="mt-3 rounded-lg border border-line-strong px-3 py-1.5 text-[11.5px] text-fg-secondary transition hover:bg-raised"
            >
              Retry
            </button>
          </div>
        ) : listing.entries.length === 0 ? (
          <p className="px-4 py-12 text-center text-[12px] text-fg-faint">This folder is empty.</p>
        ) : (
          <>
            <FileEntries
              sessionId={sessionId}
              entries={listing.entries}
              view={effectiveView}
              wide={mode === "full"}
              onOpenDir={openDir}
              onOpenFile={(entry) => {
                setSelected(entry);
                setLightbox(false);
              }}
            />
            {listing.truncated && (
              <p className="px-3 pb-3 pt-1 text-center text-[10.5px] text-warning/80">
                Showing the first {listing.entries.length} entries.
              </p>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
