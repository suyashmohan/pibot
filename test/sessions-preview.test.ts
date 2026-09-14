/**
 * Sidebar preview regression (reported from a screenshot of a live session).
 *
 * `GET /api/sessions` built the preview with a raw
 * `JSON.stringify(message.content).slice(0, 140)`, so every card showed block
 * JSON — `[["type":"thinking","thinking":"Confirm…` — instead of the text the
 * message actually contained. The pure `messagePreview` helper already did the
 * unwrapping (and was already tested); the route just never called it.
 *
 * These tests drive the real route handler against a temp DB.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { GET } from "@/app/api/sessions/route";
import { getDb } from "@/lib/db";
import { messages, sessions } from "@/lib/db/schema";
import { cleanupDbs, freshDb, uniqueId } from "./helpers/test-env";

beforeEach(async () => {
  await freshDb();
});

afterAll(async () => {
  await cleanupDbs();
});

/** Insert one session whose cache holds the given pi-shaped messages. */
async function seed(
  content: unknown[],
  opts: { role?: string; piRole?: string } = {},
): Promise<string> {
  const db = await getDb();
  const id = uniqueId("s");
  const now = Date.now();
  db.insert(sessions)
    .values({ id, name: "preview", cwd: "/tmp", createdAt: now, updatedAt: now })
    .run();
  db.insert(messages)
    .values({
      sessionId: id,
      role: opts.role ?? "assistant",
      contentJson: JSON.stringify(content),
      rawJson: JSON.stringify({
        role: opts.piRole ?? "assistant",
        content,
        timestamp: now,
      }),
      timestamp: now,
    })
    .run();
  return id;
}

async function previews(): Promise<Array<{ id: string; preview: string | null }>> {
  const res = await GET();
  const body = (await res.json()) as {
    data: { sessions: Array<{ id: string; preview: string | null }> };
  };
  return body.data.sessions;
}

describe("GET /api/sessions preview", () => {
  test("unwraps assistant text blocks instead of leaking block JSON", async () => {
    const id = await seed([
      { type: "thinking", thinking: "The user asked for a summary." },
      { type: "text", text: "Successfully wrote the file" },
    ]);
    const row = (await previews()).find((s) => s.id === id);
    expect(row?.preview).toBe("Successfully wrote the file");
    expect(row?.preview).not.toContain('"type"');
    expect(row?.preview).not.toContain("[[");
  });

  test("summarizes a tool-only assistant message", async () => {
    const id = await seed([{ type: "toolCall", id: "c1", name: "bash", arguments: {} }]);
    const row = (await previews()).find((s) => s.id === id);
    expect(row?.preview).toBe("Used bash");
  });

  test("thinking-only assistant messages show the reasoning text", async () => {
    const id = await seed([{ type: "thinking", thinking: "Confirm the directory first" }]);
    const row = (await previews()).find((s) => s.id === id);
    expect(row?.preview).toBe("Confirm the directory first");
  });

  test("user string content is shown as-is", async () => {
    const id = await seed(["review the animation"], { role: "user", piRole: "user" });
    const row = (await previews()).find((s) => s.id === id);
    expect(row?.preview).toBe("review the animation");
  });

  test("tool results fall back to their output text", async () => {
    const id = await seed([{ type: "text", text: "total 4\ndrwxr-xr-x" }], {
      role: "toolResult",
      piRole: "toolResult",
    });
    const row = (await previews()).find((s) => s.id === id);
    // Non-assistant previews are whitespace-normalized: the card is one line.
    expect(row?.preview).toBe("total 4 drwxr-xr-x");
  });

  test("the preview stays capped so cards cannot blow up", async () => {
    const id = await seed([{ type: "text", text: "z".repeat(400) }]);
    const row = (await previews()).find((s) => s.id === id);
    expect(row?.preview?.length).toBeLessThanOrEqual(140);
  });
});
