import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "@/lib/db";
import { messages as messagesTable, sessions as sessionsTable } from "@/lib/db/schema";
import { dirExists } from "@/lib/files";
import { defaultCwd } from "@/lib/pi/env";
import { destroyClient, ensureClient } from "@/lib/pi/manager";
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

    // Spawn the pi process eagerly so failures (bad cwd/binary) surface now.
    try {
      const client = await ensureClient(id);
      if (body.thinkingLevel) {
        try {
          await client.send({ type: "set_thinking_level", level: body.thinkingLevel });
        } catch {
          /* non-fatal */
        }
      }
      const row = db.select().from(sessionsTable).where(eq(sessionsTable.id, id)).get();
      return ok({ session: row }, { status: 201 });
    } catch (err) {
      destroyClient(id);
      db.delete(sessionsTable).where(eq(sessionsTable.id, id)).run();
      return fail(`Failed to start pi agent: ${toErrorMessage(err)}`, 500);
    }
  } catch (err) {
    return fail(toErrorMessage(err), 500);
  }
}
