import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { sessions as sessionsTable } from "@/lib/db/schema";
import { listBrowseEntries, resolveWithinRoot } from "@/lib/files";
import { fail, ok, toErrorMessage } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * One directory level for the right-side file browser.
 * `?dir=` is relative to the session working directory; escapes are rejected.
 */
export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const row = (await getDb())
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, id))
      .get();
    if (!row) return fail("Session not found", 404);
    const dir = new URL(req.url).searchParams.get("dir") ?? "";
    if (!resolveWithinRoot(row.cwd, dir)) {
      return fail("Path is outside the session working directory", 400);
    }
    const { entries, truncated } = await listBrowseEntries(row.cwd, dir);
    return ok({ cwd: row.cwd, dir, entries, truncated });
  } catch (err) {
    return fail(toErrorMessage(err), 500);
  }
}
