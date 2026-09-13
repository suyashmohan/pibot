import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { sessions as sessionsTable } from "@/lib/db/schema";
import { listMentionEntries, resolveWithinRoot } from "@/lib/files";
import { fail, ok, toErrorMessage } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * One directory level for the composer's `@` file picker.
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
    const entries = await listMentionEntries(row.cwd, dir);
    return ok({ cwd: row.cwd, dir, entries });
  } catch (err) {
    return fail(toErrorMessage(err), 500);
  }
}
