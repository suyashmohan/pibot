"use client";

import { ChevronRight, File, FileArchive, FileCode2, FileImage, FileText, Folder } from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import {
  formatBytes,
  rawFileUrl,
  type BrowseEntry,
  type FileKind,
  type FileView,
} from "@/lib/file-browser";

const KIND_COLORS: Record<FileKind, string> = {
  dir: "text-fg-muted",
  image: "text-success/80",
  markdown: "text-accent-2/80",
  code: "text-info/80",
  text: "text-fg-muted",
  binary: "text-warning/80",
  unknown: "text-fg-subtle",
};

function KindIcon({ kind, size = 14 }: { kind: FileKind; size?: number }) {
  const className = cn("shrink-0", KIND_COLORS[kind]);
  if (kind === "dir") return <Folder size={size} className={className} />;
  if (kind === "image") return <FileImage size={size} className={className} />;
  if (kind === "code") return <FileCode2 size={size} className={className} />;
  if (kind === "binary") return <FileArchive size={size} className={className} />;
  if (kind === "unknown") return <File size={size} className={className} />;
  return <FileText size={size} className={className} />;
}

/**
 * Presentational listing for one directory. `view` picks the compact list or
 * the thumbnail gallery; folders navigate, files open the preview. No data
 * fetching here — `FileBrowser` owns that.
 */
export function FileEntries({
  sessionId,
  entries,
  view,
  selectedPath,
  wide,
  onOpenDir,
  onOpenFile,
}: {
  sessionId: string;
  entries: BrowseEntry[];
  view: FileView;
  selectedPath?: string | null;
  /** Full-screen takeover gets a denser gallery grid. */
  wide?: boolean;
  onOpenDir: (entry: BrowseEntry) => void;
  onOpenFile: (entry: BrowseEntry) => void;
}) {
  const open = (entry: BrowseEntry) => {
    if (entry.type === "dir") onOpenDir(entry);
    else onOpenFile(entry);
  };

  if (view === "gallery") {
    return (
      <div
        className={cn(
          "grid grid-cols-2 gap-2 p-2 sm:grid-cols-3",
          wide ? "lg:grid-cols-5 xl:grid-cols-6" : "lg:grid-cols-4",
        )}
      >
        {entries.map((entry) => (
          <button
            key={entry.path}
            type="button"
            data-path={entry.path}
            data-kind={entry.kind}
            onClick={() => open(entry)}
            title={entry.path}
            className={cn(
              "group flex flex-col overflow-hidden rounded-xl border text-left transition",
              selectedPath === entry.path
                ? "border-line-focus bg-panel"
                : "border-line/80 bg-panel/40 hover:border-line-strong hover:bg-panel",
            )}
          >
            <span className="flex h-24 items-center justify-center overflow-hidden bg-app/70">
              {entry.kind === "image" && entry.mime ? (
                <img
                  src={rawFileUrl(sessionId, entry.path)}
                  alt={entry.name}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              ) : (
                <KindIcon kind={entry.kind} size={26} />
              )}
            </span>
            <span className="min-w-0 px-2 py-1.5">
              <span className="block truncate text-[11.5px] text-fg-secondary">{entry.name}</span>
              <span className="font-mono text-[10px] text-fg-faint">
                {entry.type === "dir" ? "folder" : formatBytes(entry.size)}
              </span>
            </span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="p-1.5">
      {entries.map((entry) => (
        <button
          key={entry.path}
          type="button"
          data-path={entry.path}
          data-kind={entry.kind}
          onClick={() => open(entry)}
          title={entry.path}
          className={cn(
            "group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition",
            selectedPath === entry.path ? "bg-raised/80" : "hover:bg-raised/60",
          )}
        >
          <KindIcon kind={entry.kind} />
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{entry.name}</span>
          {entry.type === "file" && (
            <>
              <span className="hidden shrink-0 font-mono text-[10px] text-fg-faint sm:inline">
                {entry.mtimeMs ? timeAgo(entry.mtimeMs) : ""}
              </span>
              <span className="w-14 shrink-0 text-right font-mono text-[10.5px] text-fg-faint">
                {formatBytes(entry.size)}
              </span>
            </>
          )}
          {entry.type === "dir" && (
            <ChevronRight size={12} className="shrink-0 text-fg-faint group-hover:text-fg-muted" />
          )}
        </button>
      ))}
    </div>
  );
}
