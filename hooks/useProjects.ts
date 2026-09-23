"use client";

import { useCallback, useEffect, useState } from "react";
import { pibot } from "@/lib/client";

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
      setProjects(await pibot.projects.list());
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
      try {
        await pibot.projects.pin(folderPath);
      } catch (err) {
        return err instanceof Error ? err.message : "Failed to add project";
      }
      await refresh();
      return null;
    },
    [refresh],
  );

  const unpin = useCallback(
    async (folderPath: string) => {
      try {
        await pibot.projects.unpin(folderPath);
      } catch {
        /* ignore */
      }
      await refresh();
    },
    [refresh],
  );

  return { projects, refresh, pin, unpin };
}
