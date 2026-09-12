"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client-api";

export interface ProjectInfo {
  path: string;
  name: string;
  pinned: boolean;
  missing: boolean;
  sessionCount: number;
  updatedAt: number;
}

export function useProjects() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ projects: ProjectInfo[] }>("/api/projects");
      if (r.ok && r.data) setProjects(r.data.projects);
    } catch {
      /* ignore transient */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Pin a folder. Returns an error message, or null on success. */
  const pin = useCallback(
    async (folderPath: string): Promise<string | null> => {
      const r = await api("/api/projects", {
        method: "POST",
        body: JSON.stringify({ path: folderPath }),
      });
      if (!r.ok) return r.error ?? "Failed to add project";
      await refresh();
      return null;
    },
    [refresh],
  );

  const unpin = useCallback(
    async (folderPath: string) => {
      await api("/api/projects", {
        method: "DELETE",
        body: JSON.stringify({ path: folderPath }),
      });
      await refresh();
    },
    [refresh],
  );

  return { projects, refresh, pin, unpin };
}
