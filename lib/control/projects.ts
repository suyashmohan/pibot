/**
 * Project folders: pinned + discovered, plus the full-filesystem folder
 * picker (root-equivalent by design — same power as `GET /api/projects/folders`).
 */

import { desc, eq } from "drizzle-orm";
import path from "node:path";
import { sessions as sessionsTable, settings as settingsTable } from "@/lib/db/schema";
import { dirExists, listSubdirectories, resolveBrowseDir } from "@/lib/files";
import { defaultCwd } from "@/lib/pi/env";
import { ControlError } from "./errors";
import type { ControlDeps } from "./plane";
import type { CallContext, FolderListing, ProjectInfo } from "./types";
import { UI_CTX } from "./types";

const PINNED_KEY = "pinned_projects";

export interface ProjectService {
  list(): Promise<{ projects: ProjectInfo[] }>;
  pin(path: string, ctx?: CallContext): Promise<{ project: ProjectInfo | null }>;
  unpin(path: string, ctx?: CallContext): Promise<{ projects: ProjectInfo[] }>;
  /** Full-filesystem listing. Same power as GET /api/projects/folders. Root-equivalent. */
  listFolders(path: string): Promise<FolderListing>;
}

export function createProjectService(deps: ControlDeps): ProjectService {
  async function getPinned(): Promise<string[]> {
    try {
      const row = (await deps.db())
        .select()
        .from(settingsTable)
        .where(eq(settingsTable.key, PINNED_KEY))
        .get();
      if (!row) return [];
      const arr = JSON.parse(row.value) as unknown;
      return Array.isArray(arr)
        ? arr.filter((x): x is string => typeof x === "string")
        : [];
    } catch {
      return [];
    }
  }

  async function setPinned(paths: string[]): Promise<void> {
    const value = JSON.stringify([...new Set(paths)]);
    (await deps.db())
      .insert(settingsTable)
      .values({ key: PINNED_KEY, value })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value } })
      .run();
  }

  async function listing(): Promise<ProjectInfo[]> {
    const db = await deps.db();
    const rows = db
      .select()
      .from(sessionsTable)
      .orderBy(desc(sessionsTable.updatedAt))
      .all();
    const agg = new Map<string, { sessionCount: number; updatedAt: number }>();
    for (const r of rows) {
      const cur = agg.get(r.cwd) ?? { sessionCount: 0, updatedAt: 0 };
      cur.sessionCount += 1;
      cur.updatedAt = Math.max(cur.updatedAt, r.updatedAt);
      agg.set(r.cwd, cur);
    }
    const pinned = await getPinned();
    const paths = new Set<string>([...agg.keys(), ...pinned]);
    const out: ProjectInfo[] = await Promise.all(
      [...paths].map(async (p) => {
        const a = agg.get(p);
        return {
          path: p,
          name: path.basename(p) || p,
          pinned: pinned.includes(p),
          missing: !(await dirExists(p)),
          sessionCount: a?.sessionCount ?? 0,
          updatedAt: a?.updatedAt ?? 0,
        };
      }),
    );
    // Most recently active first; empty projects alphabetically at the end.
    out.sort((x, y) => y.updatedAt - x.updatedAt || x.path.localeCompare(y.path));
    return out;
  }

  return {
    async list() {
      return { projects: await listing() };
    },

    async pin(rawPath, _ctx = UI_CTX) {
      const raw = rawPath?.trim() ?? "";
      if (!raw) {
        throw new ControlError("bad_request", "Folder path is required", { status: 400 });
      }
      if (!path.isAbsolute(raw)) {
        throw new ControlError("bad_request", "Folder path must be absolute", {
          status: 400,
        });
      }
      // `turbopackIgnore` opts out of the build-time filesystem tracer: this is
      // a user-chosen folder, not something to bundle (see AGENTS.md).
      const resolved = path.resolve(/* turbopackIgnore: true */ raw);
      if (!(await dirExists(resolved))) {
        throw new ControlError(
          "bad_request",
          `Folder does not exist (or is not a directory): ${resolved}`,
          { status: 400 },
        );
      }
      const pinned = await getPinned();
      if (!pinned.includes(resolved)) await setPinned([...pinned, resolved]);
      const list = await listing();
      return { project: list.find((p) => p.path === resolved) ?? null };
    },

    async unpin(rawPath, _ctx = UI_CTX) {
      const raw = rawPath?.trim() ?? "";
      if (!raw) {
        throw new ControlError("bad_request", "Folder path is required", { status: 400 });
      }
      await setPinned(
        (await getPinned()).filter(
          (p) => p !== path.resolve(/* turbopackIgnore: true */ raw),
        ),
      );
      return { projects: await listing() };
    },

    async listFolders(asked) {
      const fallback =
        process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || defaultCwd();
      const dir = await resolveBrowseDir(asked, fallback);
      const parent = path.dirname(dir);
      const entries = await listSubdirectories(dir);
      return { path: dir, parent: parent === dir ? null : parent, entries };
    },
  };
}
