import { desc, eq } from "drizzle-orm";
import path from "node:path";
import { getDb } from "@/lib/db";
import { sessions as sessionsTable, settings as settingsTable } from "@/lib/db/schema";
import { dirExists } from "@/lib/files";
import { fail, ok, readJson, toErrorMessage } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PINNED_KEY = "pinned_projects";

export interface ProjectInfo {
  path: string;
  name: string;
  pinned: boolean;
  missing: boolean;
  sessionCount: number;
  updatedAt: number;
}

async function getPinned(): Promise<string[]> {
  try {
    const row = (await getDb())
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, PINNED_KEY))
      .get();
    if (!row) return [];
    const arr = JSON.parse(row.value) as unknown;
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function setPinned(paths: string[]) {
  const value = JSON.stringify([...new Set(paths)]);
  (await getDb())
    .insert(settingsTable)
    .values({ key: PINNED_KEY, value })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value } })
    .run();
}

async function listing(): Promise<ProjectInfo[]> {
  const db = await getDb();
  const rows = db.select().from(sessionsTable).orderBy(desc(sessionsTable.updatedAt)).all();
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

/** List projects: pinned folders merged with folders discovered from sessions. */
export async function GET() {
  try {
    return ok({ projects: await listing() });
  } catch (err) {
    return fail(toErrorMessage(err), 500);
  }
}

/** Pin (and validate) a project folder so it shows even with no sessions. */
export async function POST(req: Request) {
  try {
    const body = await readJson<{ path?: string }>(req);
    const raw = body.path?.trim() ?? "";
    if (!raw) return fail("Folder path is required", 400);
    if (!path.isAbsolute(raw)) return fail("Folder path must be absolute", 400);
    // `turbopackIgnore` opts out of the build-time filesystem tracer: this is
    // a user-chosen folder, not something to bundle (see AGENTS.md).
    const resolved = path.resolve(/* turbopackIgnore: true */ raw);
    if (!(await dirExists(resolved))) {
      return fail(`Folder does not exist (or is not a directory): ${resolved}`, 400);
    }
    const pinned = await getPinned();
    if (!pinned.includes(resolved)) await setPinned([...pinned, resolved]);
    const list = await listing();
    return ok({ project: list.find((p) => p.path === resolved) ?? null }, { status: 201 });
  } catch (err) {
    return fail(toErrorMessage(err), 500);
  }
}

/** Unpin a project folder (its sessions, if any, stay as a discovered group). */
export async function DELETE(req: Request) {
  try {
    const body = await readJson<{ path?: string }>(req);
    const raw = body.path?.trim() ?? "";
    if (!raw) return fail("Folder path is required", 400);
    await setPinned(
      (await getPinned()).filter((p) => p !== path.resolve(/* turbopackIgnore: true */ raw)),
    );
    return ok({ projects: await listing() });
  } catch (err) {
    return fail(toErrorMessage(err), 500);
  }
}
