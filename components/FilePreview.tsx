"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  ImageOff,
  Loader2,
  Maximize2,
  TextWrap,
  X,
} from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import {
  formatBytes,
  joinPath,
  parentPath,
  rawFileUrl,
  shouldHighlight,
  type BrowseEntry,
  type FilePreviewData,
} from "@/lib/file-browser";
import { escapeHtml, highlightToHtml } from "@/lib/highlight";
import { Markdown } from "./Markdown";

/** Highlighted source with a sticky line-number gutter (hidden when wrapping). */
function CodeView({
  code,
  language,
  wrap,
}: {
  code: string;
  language: string | null;
  wrap: boolean;
}) {
  const html = useMemo(
    () => (shouldHighlight(code.length) ? highlightToHtml(code, language) : escapeHtml(code)),
    [code, language],
  );
  const lineCount = useMemo(() => {
    const body = code.endsWith("\n") ? code.slice(0, -1) : code;
    return body.split("\n").length;
  }, [code]);
  const numbers = useMemo(
    () => Array.from({ length: lineCount }, (_, i) => i + 1).join("\n"),
    [lineCount],
  );

  return (
    <div className="flex min-h-full items-stretch">
      {!wrap && (
        <div
          aria-hidden
          className="sticky left-0 z-10 shrink-0 select-none border-r border-line/60 bg-app px-2 py-3 text-right font-mono text-[12px] leading-[18px] text-fg-faint"
        >
          <div className="whitespace-pre">{numbers}</div>
        </div>
      )}
      <pre
        className={cn(
          "code-pre min-w-0 flex-1 px-3 py-3 font-mono text-[12px] leading-[18px] text-fg-secondary",
          wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
        )}
      >
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}

function DownloadAction({
  href,
  label,
  className,
}: {
  href: string;
  label?: string;
  className?: string;
}) {
  return (
    <a
      href={href}
      download
      title="Download"
      className={cn(
        "flex items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1.5 text-[11.5px] text-fg-secondary transition hover:bg-raised",
        className,
      )}
    >
      <Download size={13} />
      {label ?? "Download"}
    </a>
  );
}

/**
 * One file in the preview surface: images (with an optional full-view
 * lightbox), syntax-highlighted text/code, and markdown with a
 * Rendered (GFM) / Source switch. Purely presentational — `FileBrowser` owns
 * selection, fetching and the lightbox flag.
 */
export function FilePreview({
  sessionId,
  entry,
  preview,
  loading,
  error,
  lightboxOpen,
  onToggleLightbox,
  onBack,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: {
  sessionId: string;
  entry: BrowseEntry;
  preview: FilePreviewData | null;
  loading?: boolean;
  error?: string | null;
  lightboxOpen: boolean;
  onToggleLightbox: (open: boolean) => void;
  onBack: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}) {
  const [mdMode, setMdMode] = useState<"rendered" | "source">("rendered");
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);

  const rawUrl = rawFileUrl(sessionId, entry.path);
  const downloadUrl = rawFileUrl(sessionId, entry.path, { download: true });
  const content = preview?.status === "text" ? (preview.content ?? "") : null;
  const size = preview?.size ?? entry.size;

  /** Relative image URLs inside markdown resolve against the file's folder. */
  const resolveImageUrl = (src: string) => {
    if (!src || /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(src)) return src;
    const rel = src.startsWith("/") ? src.slice(1) : src;
    return rawFileUrl(sessionId, joinPath(parentPath(entry.path), rel));
  };

  const copy = () => {
    if (!content) return;
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const isImage = entry.kind === "image";

  return (
    <div className="flex min-h-full flex-col">
      {/* Toolbar */}
      <div className="sticky top-0 z-20 flex shrink-0 items-center gap-1.5 border-b border-line/70 bg-app/95 px-2 py-1.5 backdrop-blur">
        <button
          type="button"
          onClick={onBack}
          title="Back to file list"
          className="rounded-lg p-1.5 text-fg-subtle transition hover:bg-raised hover:text-fg"
        >
          <ArrowLeft size={14} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium text-fg">{entry.name}</div>
          <div className="truncate font-mono text-[10px] text-fg-faint">
            {entry.path} · {formatBytes(size)}
            {preview?.mtimeMs ? ` · ${timeAgo(preview.mtimeMs)}` : ""}
          </div>
        </div>

        {(hasPrev || hasNext) && (
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={onPrev}
              disabled={!hasPrev}
              title="Previous file"
              className="rounded-lg px-1.5 py-1 text-[11px] text-fg-subtle transition hover:bg-raised hover:text-fg disabled:opacity-30"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={!hasNext}
              title="Next file"
              className="rounded-lg px-1.5 py-1 text-[11px] text-fg-subtle transition hover:bg-raised hover:text-fg disabled:opacity-30"
            >
              ›
            </button>
          </div>
        )}

        {entry.kind === "markdown" && (
          <div className="flex shrink-0 items-center rounded-lg border border-line bg-panel/70 p-0.5">
            {(["rendered", "source"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mdMode === m}
                onClick={() => setMdMode(m)}
                className={cn(
                  "rounded-md px-2 py-0.5 text-[10.5px] capitalize transition",
                  mdMode === m ? "bg-active text-fg" : "text-fg-subtle hover:text-fg-secondary",
                )}
              >
                {m === "rendered" ? "Rendered" : "Source"}
              </button>
            ))}
          </div>
        )}

        {content != null && (
          <button
            type="button"
            onClick={copy}
            title="Copy contents"
            className="shrink-0 rounded-lg p-1.5 text-fg-subtle transition hover:bg-raised hover:text-fg"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        )}
        {content != null && !isImage && (
          <button
            type="button"
            onClick={() => setWrap((v) => !v)}
            title="Toggle line wrap"
            className={cn(
              "shrink-0 rounded-lg p-1.5 transition hover:bg-raised hover:text-fg",
              wrap ? "bg-raised text-fg" : "text-fg-subtle",
            )}
          >
            <TextWrap size={13} />
          </button>
        )}
        <a
          href={downloadUrl}
          download
          title="Download"
          className="shrink-0 rounded-lg p-1.5 text-fg-subtle transition hover:bg-raised hover:text-fg"
        >
          <Download size={13} />
        </a>
        {isImage && (
          <button
            type="button"
            onClick={() => onToggleLightbox(!lightboxOpen)}
            title="Full view"
            className="shrink-0 rounded-lg p-1.5 text-fg-subtle transition hover:bg-raised hover:text-fg"
          >
            <Maximize2 size={13} />
          </button>
        )}
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[12px] text-fg-subtle">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : error ? (
          <p className="px-4 py-10 text-center text-[12px] text-danger-soft">{error}</p>
        ) : isImage ? (
          <button
            type="button"
            onClick={() => onToggleLightbox(true)}
            title="Full view"
            className="flex min-h-full w-full items-center justify-center bg-[repeating-conic-gradient(#18181b_0%_25%,#09090b_0%_50%)] bg-[length:20px_20px] p-3"
          >
            <img src={rawUrl} alt={entry.name} className="max-h-[70vh] max-w-full object-contain" />
          </button>
        ) : preview?.status === "binary" ? (
          <div className="px-4 py-12 text-center">
            <ImageOff size={22} className="mx-auto mb-3 text-fg-faint" />
            <p className="text-[12.5px] text-fg-muted">Binary file — preview is not available.</p>
            <p className="mt-1 text-[11px] text-fg-faint">{formatBytes(size)}</p>
            <DownloadAction href={downloadUrl} className="mx-auto mt-4 w-fit" />
          </div>
        ) : preview?.status === "too-large" ? (
          <div className="px-4 py-12 text-center">
            <ImageOff size={22} className="mx-auto mb-3 text-fg-faint" />
            <p className="text-[12.5px] text-fg-muted">
              File is too large to preview ({formatBytes(size)}).
            </p>
            <p className="mt-1 text-[11px] text-fg-faint">Download it instead.</p>
            <DownloadAction href={downloadUrl} className="mx-auto mt-4 w-fit" />
          </div>
        ) : entry.kind === "markdown" ? (
          mdMode === "rendered" ? (
            <div className="px-4 py-3">
              <Markdown text={content ?? ""} resolveImageUrl={resolveImageUrl} />
            </div>
          ) : (
            <CodeView code={content ?? ""} language="markdown" wrap={wrap} />
          )
        ) : (
          <CodeView code={content ?? ""} language={preview?.language ?? entry.language} wrap={wrap} />
        )}
      </div>

      {/* Full view: click anywhere (or the close button) to dismiss. */}
      {lightboxOpen && isImage && (
        <div
          data-testid="lightbox"
          onClick={() => onToggleLightbox(false)}
          className="fixed inset-0 z-[65] flex items-center justify-center bg-overlay/92 p-4"
        >
          <img
            src={rawUrl}
            alt={entry.name}
            className="max-h-full max-w-full object-contain shadow-2xl"
          />
          <button
            type="button"
            title="Close full view"
            onClick={() => onToggleLightbox(false)}
            className="absolute right-4 top-4 rounded-xl bg-panel/80 p-2 text-fg-secondary transition hover:bg-raised"
          >
            <X size={16} />
          </button>
          <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-panel/80 px-3 py-1 font-mono text-[11px] text-fg-muted">
            {entry.path}
          </span>
        </div>
      )}
    </div>
  );
}
