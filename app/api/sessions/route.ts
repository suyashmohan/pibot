import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "@/lib/db";
import { messages as messagesTable, sessions as sessionsTable } from "@/lib/db/schema";
import { dirExists } from "@/lib/files";
import { defaultCwd } from "@/lib/pi/env";
import { fail, ok, readJson, toErrorMessage } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await getDb();
    const rows = db.select().from(sessionsTable).orderBy(desc(sessionsTable.updatedAt)).all();
    // Attach a preview from the cached messages.
    const data = rows.map((s) => {
      let preview: string | null = null;
      let messageCount = 0;
      try {
        const msgs = db
          .select()
          .from(messagesTable)
          .where(eq(messagesTable.sessionId, s.id))
          .all();
        messageCount = msgs.length;
        const last = msgs[msgs.length - 1];
        if (last) {
          try {
            const raw = JSON.parse(last.rawJson) as { role?: string; content?: unknown };
            const c = raw.content;
            preview =
              typeof c === "string"
                ? c.slice(0, 140)
                : JSON.stringify(c ?? "").slice(0, 140);
          } catch {
            preview = null;
          }
        }
      } catch {
        /* ignore */
      }
      return { ...s, preview, messageCount };
    });
    return ok({ sessions: data });
  } catch (err) {
    return fail(toErrorMessage(err), 500);
  }
}

interface CreateBody {
  name?: string;
  cwd?: string;
  provider?: string;
  model?: string;
  thinkingLevel?: string;
}

export async function POST(req: Request) {
  try {
    const body = await readJson<CreateBody>(req);
    const cwd = (body.cwd?.trim() || defaultCwd()).trim();
    if (!(await dirExists(cwd))) {
      return fail(`Working directory does not exist: ${cwd}`, 400);
    }
    const db = await getDb();
    const now = Date.now();
    const id = nanoid(12);
    const name = body.name?.trim() || "New session";
    db.insert(sessionsTable)
      .values({
        id,
        name,
        cwd,
        provider: body.provider?.trim() || null,
        modelId: body.model?.trim() || null,
        thinkingLevel: body.thinkingLevel?.trim() || null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // Lazy spawn: no pi process boots here. It starts on first real use
    // (open/prompt/stream), so creating many sessions never fans out
    // processes. thinkingLevel travels in the row and is passed as
    // --thinking at spawn; bad cwd/binary surface on first open instead.
    const row = db.select().from(sessionsTable).where(eq(sessionsTable.id, id)).get();
    return ok({ session: row }, { status: 201 });
  } catch (err) {
    return fail(toErrorMessage(err), 500);
  }
}
