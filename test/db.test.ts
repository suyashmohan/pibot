import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { messages, sessions, settings } from "@/lib/db/schema";
import { cleanupDbs, freshDb, uniqueId } from "./helpers/test-env";

beforeEach(async () => {
  await freshDb();
});

afterAll(async () => {
  await cleanupDbs();
});

describe("sqlite schema (temp DB per test)", () => {
  test("creates tables and round-trips a session", async () => {
    const db = await getDb();
    const id = uniqueId("s");
    const now = Date.now();
    db.insert(sessions)
      .values({ id, name: "t", cwd: "/tmp", createdAt: now, updatedAt: now })
      .run();
    const row = db.select().from(sessions).where(eq(sessions.id, id)).get();
    expect(row?.name).toBe("t");
    expect(row?.cwd).toBe("/tmp");
  });

  test("deleting a session cascades to its messages", async () => {
    const db = await getDb();
    const id = uniqueId("s");
    const now = Date.now();
    db.insert(sessions).values({ id, name: "t", cwd: "/tmp", createdAt: now, updatedAt: now }).run();
    db.insert(messages)
      .values({ sessionId: id, role: "user", contentJson: '"hi"', rawJson: "{}", timestamp: now })
      .run();
    db.delete(sessions).where(eq(sessions.id, id)).run();
    expect(db.select().from(messages).where(eq(messages.sessionId, id)).all()).toEqual([]);
  });

  test("settings upsert overwrites (projects pin path)", async () => {
    const db = await getDb();
    const put = (v: string) =>
      db
        .insert(settings)
        .values({ key: "pinned_projects", value: v })
        .onConflictDoUpdate({ target: settings.key, set: { value: v } })
        .run();
    put('["/a"]');
    put('["/a","/b"]');
    const row = db.select().from(settings).where(eq(settings.key, "pinned_projects")).get();
    expect(row?.value).toBe('["/a","/b"]');
  });
});
