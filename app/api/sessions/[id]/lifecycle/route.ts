import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "@/lib/db";
import { sessions as sessionsTable } from "@/lib/db/schema";
import { destroyClient, ensureClient, syncMessagesFromPi } from "@/lib/pi/manager";
import { fail, ok, readJson, toErrorMessage } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Session lifecycle ops: new_session, switch_session, fork, clone. */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const body = await readJson<Record<string, unknown>>(req);
    const op = String(body.op ?? "");
    const client = await ensureClient(id);
    const db = await getDb();

    switch (op) {
      case "new_session": {
        const res = await client.send({
          type: "new_session",
          ...(typeof body.parentSession === "string" ? { parentSession: body.parentSession } : {}),
        });
        if (!res.success) return fail(String(res.error ?? "new_session failed"), 500);
        // Refresh pi ids + clear local message cache (fresh conversation).
        try {
          const st = await client.send({ type: "get_state" });
          if (st.success) {
            const d = (st.data ?? {}) as Record<string, unknown>;
            db.update(sessionsTable)
              .set({
                piSessionId: typeof d.sessionId === "string" ? d.sessionId : null,
                piSessionFile: typeof d.sessionFile === "string" ? d.sessionFile : null,
                updatedAt: Date.now(),
              })
              .where(eq(sessionsTable.id, id))
              .run();
          }
        } catch {
          /* ignore */
        }
        void syncMessagesFromPi(id).catch(() => {});
        return ok({ response: res });
      }
      case "switch_session": {
        if (typeof body.sessionPath !== "string" || !body.sessionPath) {
          return fail("sessionPath is required", 400);
        }
        const res = await client.send({ type: "switch_session", sessionPath: body.sessionPath });
        if (!res.success) return fail(String(res.error ?? "switch_session failed"), 500);
        void syncMessagesFromPi(id).catch(() => {});
        return ok({ response: res });
      }
      case "fork": {
        if (typeof body.entryId !== "string" || !body.entryId) {
          return fail("entryId is required", 400);
        }
        const res = await client.send({ type: "fork", entryId: body.entryId });
        if (!res.success) return fail(String(res.error ?? "fork failed"), 500);
        void syncMessagesFromPi(id).catch(() => {});
        return ok({ response: res });
      }
      case "clone": {
        // Clone duplicates the branch into a *new pi session file* inside the
        // same RPC process. We surface it as a new web session row so the
        // sidebar keeps a 1:1 mapping of web session -> visible conversation.
        const res = await client.send({ type: "clone" });
        if (!res.success) return fail(String(res.error ?? "clone failed"), 500);
        try {
          const st = await client.send({ type: "get_state" });
          const d = (st.success ? (st.data as Record<string, unknown>) : {}) as Record<string, unknown>;
          const piFile = typeof d.sessionFile === "string" ? d.sessionFile : null;
          const piSid = typeof d.sessionId === "string" ? d.sessionId : null;
          const src = db.select().from(sessionsTable).where(eq(sessionsTable.id, id)).get();
          if (src && piFile && piFile !== src.piSessionFile) {
            const newId = nanoid(12);
            const now = Date.now();
            db.insert(sessionsTable)
              .values({
                id: newId,
                name: `${src.name} (clone)`,
                cwd: src.cwd,
                provider: src.provider,
                modelId: src.modelId,
                thinkingLevel: src.thinkingLevel,
                piSessionId: piSid,
                piSessionFile: piFile,
                createdAt: now,
                updatedAt: now,
              })
              .run();
            // Point the old web session back at its original file.
            if (src.piSessionFile) {
              try {
                await client.send({ type: "switch_session", sessionPath: src.piSessionFile });
              } catch {
                /* ignore */
              }
            }
            destroyClient(newId);
            const created = db.select().from(sessionsTable).where(eq(sessionsTable.id, newId)).get();
            return ok({ response: res, clonedSession: created });
          }
        } catch {
          /* fall through */
        }
        void syncMessagesFromPi(id).catch(() => {});
        return ok({ response: res });
      }
      default:
        return fail(`Unknown op: ${op || "(missing)"}`, 400);
    }
  } catch (err) {
    return fail(toErrorMessage(err), 500);
  }
}
