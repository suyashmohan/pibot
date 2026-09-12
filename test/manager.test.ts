import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import {
  destroyClient,
  ensureClient,
  readCachedMessages,
  subscribe,
  syncMessagesFromPi,
} from "@/lib/pi/manager";
import type { PiEvent } from "@/lib/pi/types";
import {
  cleanupDbs,
  freshDb,
  makeTempDir,
  removeTempDir,
  uniqueId,
  useFakePi,
} from "./helpers/test-env";

const dirs: string[] = [];
const liveIds: string[] = [];
let restorePi: (() => void) | null = null;

beforeEach(async () => {
  await freshDb();
  restorePi?.();
  restorePi = useFakePi();
});

afterEach(() => {
  for (const id of liveIds.splice(0)) destroyClient(id);
  restorePi?.();
  restorePi = null;
});

afterAll(async () => {
  await cleanupDbs();
  for (const d of dirs.splice(0)) await removeTempDir(d);
});

async function makeRow(cwd?: string): Promise<{ id: string; cwd: string }> {
  let dir: string;
  if (cwd) {
    dir = cwd;
  } else {
    dir = await makeTempDir();
    dirs.push(dir);
  }
  const id = uniqueId("web");
  const now = Date.now();
  (await getDb())
    .insert(sessions)
    .values({ id, name: "mtest", cwd: dir, createdAt: now, updatedAt: now })
    .run();
  liveIds.push(id);
  return { id, cwd: dir };
}

async function waitFor(id: string, type: string, ms = 15_000): Promise<PiEvent> {
  return new Promise<PiEvent>((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`timed out waiting for ${type}`));
    }, ms);
    const off = subscribe(id, (ev) => {
      if (String(ev.type) === type) {
        clearTimeout(timer);
        off();
        resolve(ev);
      }
    });
  });
}

describe("manager with fake-pi", () => {
  test("ensureClient spawns pi and records pi session ids", async () => {
    const { id } = await makeRow();
    const client = await ensureClient(id);
    expect(client.alive).toBe(true);
    // Second call reuses the live client (no duplicate spawn).
    expect(await ensureClient(id)).toBe(client);
    const row = (await getDb()).select().from(sessions).where(eq(sessions.id, id)).get();
    expect(row?.piSessionId).toBe("fake-pi-session");
    expect(row?.piSessionFile).toContain("fake-pi-session");
  });

  test("prompt round-trips, broadcasts settle, and caches messages", async () => {
    const { id } = await makeRow();
    const client = await ensureClient(id);
    const settled = waitFor(id, "agent_settled");
    const res = await client.send({ type: "prompt", message: "hello" });
    expect(res.success).toBe(true);
    await settled;
    const msgs = await syncMessagesFromPi(id);
    expect(msgs.map((m) => (m as { role?: string }).role)).toEqual(["user", "assistant"]);
    const cached = await readCachedMessages(id);
    expect(cached).toHaveLength(2);
  });

  test("missing working directory throws instead of spawning", async () => {
    const { id } = await makeRow("/nope-missing-dir-pibot-xyz");
    await expect(ensureClient(id)).rejects.toThrow("does not exist");
  });
});
