"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import type { BrowseEntry, FilePreviewData } from "@/lib/file-browser";

export interface DirectoryListing {
  entries: BrowseEntry[];
  truncated: boolean;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** One directory level of the session working directory (refetches on `dir`). */
export function useDirectoryListing(sessionId: string, dir: string): DirectoryListing {
  const [state, setState] = useState<{
    entries: BrowseEntry[];
    truncated: boolean;
    loading: boolean;
    error: string | null;
  }>({ entries: [], truncated: false, loading: true, error: null });
  const [token, setToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    void (async () => {
      const r = await api<{ entries: BrowseEntry[]; truncated: boolean }>(
        `/api/sessions/${sessionId}/files/browse?dir=${encodeURIComponent(dir)}`,
      );
      if (cancelled) return;
      if (!r.ok) {
        setState({ entries: [], truncated: false, loading: false, error: r.error ?? "Failed to load folder" });
        return;
      }
      setState({
        entries: r.data?.entries ?? [],
        truncated: Boolean(r.data?.truncated),
        loading: false,
        error: null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, dir, token]);

  const reload = useCallback(() => setToken((t) => t + 1), []);
  return { ...state, reload };
}

export interface PreviewState {
  data: FilePreviewData | null;
  loading: boolean;
  error: string | null;
}

/** Text preview for one path (null clears it — images skip this endpoint). */
export function useFilePreview(sessionId: string, path: string | null): PreviewState {
  const [state, setState] = useState<PreviewState>({ data: null, loading: false, error: null });

  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ data: null, loading: true, error: null });
    void (async () => {
      const r = await api<FilePreviewData>(
        `/api/sessions/${sessionId}/files/content?path=${encodeURIComponent(path)}`,
      );
      if (cancelled) return;
      if (!r.ok || !r.data) {
        setState({ data: null, loading: false, error: r.error ?? "Failed to load file" });
        return;
      }
      setState({ data: r.data, loading: false, error: null });
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, path]);

  return state;
}
