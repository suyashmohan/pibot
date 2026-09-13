import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { sessions as sessionsTable } from "@/lib/db/schema";
import { destroyClient, getLiveClient, readCachedMessages, syncMessagesFromPi } from "@/lib/pi/manager";
import { fail, ok, readJson, toErrorMessage } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Session detail. Read-only: when no pi process is attached the session is
 * served from the cache (`state`/`stats` null, `live: false`) — opening an
 * old session must not spawn pi. The composer triggers `POST /start`.
 */
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const db = await getDb();
    const row = db.select().from(sessionsTable).where(eq(sessionsTable.id, id)).get();
    if (!row) return fail("Session not found", 404);

    let state: unknown = null;
    let stats: unknown = null;
    let msgList: unknown[] | null = null;
    let liveError: string | null = null;
    const client = getLiveClient(id);

    if (client) {
      try {
        const [stateRes, statsRes] = await Promise.all([
          client.send({ type: "get_state" }),
          client.send({ type: "get_session_stats" }),
        ]);
        if (stateRes.success) {
          state = stateRes.data;
          const d = (stateRes.data ?? {}) as Record<string, unknown>;
          db.update(sessionsTable)
            .set({
              piSessionId: typeof d.sessionId === "string" ? d.sessionId : row.piSessionId,
              piSessionFile: typeof d.sessionFile === "string" ? d.sessionFile : row.piSessionFile,
              thinkingLevel:
                typeof d.thinkingLevel === "string" ? d.thinkingLevel : row.thinkingLevel,
              updatedAt: Date.now(),
            })
            .where(eq(sessionsTable.id, id))
            .run();
        }
        if (statsRes.success) stats = statsRes.data;
        msgList = await syncMessagesFromPi(id);
      } catch (err) {
        liveError = toErrorMessage(err);
      }
    }
    if (msgList == null) msgList = await readCachedMessages(id);
    const live = client != null && liveError == null;

    const fresh = db.select().from(sessionsTable).where(eq(sessionsTable.id, id)).get();
    return ok({ session: fresh, state, stats, messages: msgList, liveError, live });
  } catch (err) {
    return fail(toErrorMessage(err), 500);
  }
}

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const body = await readJson<{ name?: string }>(req);
    const db = await getDb();
    const row = db.select().from(sessionsTable).where(eq(sessionsTable.id, id)).get();
    if (!row) return fail("Session not found", 404);
    const name = body.name?.trim();
    if (!name) return fail("Name is required", 400);
    // Renaming is pure metadata — mirror it into a running pi process when one
    // exists, but never spawn one just to sync a name.
    const client = getLiveClient(id);
    if (client) {
      try {
        await client.send({ type: "set_session_name", name });
      } catch {
        /* best effort — pi name sync is non-critical */
      }
    }
    db.update(sessionsTable).set({ name, updatedAt: Date.now() }).where(eq(sessionsTable.id, id)).run();
    const fresh = db.select().from(sessionsTable).where(eq(sessionsTable.id, id)).get();
    return ok({ session: fresh });
  } catch (err) {
    return fail(toErrorMessage(err), 500);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const db = await getDb();
    destroyClient(id);
    db.delete(sessionsTable).where(eq(sessionsTable.id, id)).run();
    return ok({ deleted: id });
  } catch (err) {
    return fail(toErrorMessage(err), 500);
  }
}
