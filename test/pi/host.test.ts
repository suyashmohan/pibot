/**
 * PiAgentHost: the only place JSONL command names live. TDD for PR 4 of the
 * control-plane extraction — domain methods over the manager, no routes.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { createPiAgentHost } from "@/lib/pi/host";
import { destroyClient, getLiveClient, persistMessages } from "@/lib/pi/manager";
import type { PiEvent } from "@/lib/pi/types";
import {
  cleanupDbs,
  freshDb,
  installFakePi,
  makeTempDir,
  removeTempDir,
  uniqueId,
} from "../helpers/test-env";

const dirs: string[] = [];
const liveIds: string[] = [];
let restorePi: (() => void) | null = null;

beforeEach(async () => {
  await freshDb();
  restorePi?.();
  restorePi = installFakePi();
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

async function makeRow(): Promise<string> {
  const dir = await makeTempDir();
  dirs.push(dir);
  const id = uniqueId("host");
  const now = Date.now();
  (await getDb())
    .insert(sessions)
    .values({ id, name: "host-test", cwd: dir, createdAt: now, updatedAt: now })
    .run();
  liveIds.push(id);
  return id;
}

function waitFor(id: string, type: string, ms = 15_000): Promise<PiEvent> {
  const host = createPiAgentHost();
  return new Promise<PiEvent>((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`timed out waiting for ${type}`));
    }, ms);
    const off = host.subscribeRaw(id, (ev) => {
      if (String(ev.type) === type) {
        clearTimeout(timer);
        off();
        resolve(ev);
      }
    });
  });
}

describe("AgentHost", () => {
  test("getLive is null before ensure and wraps the live client after", async () => {
    const id = await makeRow();
    const host = createPiAgentHost();
    expect(host.getLive(id)).toBeNull();

    const session = await host.ensure(id);
    expect(session.alive).toBe(true);
    expect(host.getLive(id)).not.toBeNull();

    const row = (await getDb()).select().from(sessions).where(eq(sessions.id, id)).get();
    expect(row?.piSessionId).toBe("fake-pi-session");
  });

  test("syncIfLive on a sleeping session returns null and does not spawn", async () => {
    const id = await makeRow();
    const host = createPiAgentHost();
    expect(await host.syncIfLive(id)).toBeNull();
    expect(getLiveClient(id)).toBeNull();
  });

  test("prompt round-trips and syncIfLive persists messages", async () => {
    const id = await makeRow();
    const host = createPiAgentHost();
    const session = await host.ensure(id);

    const settled = waitFor(id, "agent_settled");
    const res = await session.prompt({ message: "hello host" });
    expect(res.success).toBe(true);
    expect(res.type).toBe("response");
    await settled;

    const messages = await host.syncIfLive(id);
    expect(messages?.map((m) => (m as { role?: string }).role)).toEqual(["user", "assistant"]);
  });

  test("prompt maps steer / follow_up to the right JSONL command", async () => {
    const id = await makeRow();
    const host = createPiAgentHost();
    const session = await host.ensure(id);

    const steer = await session.prompt({ message: "s", mode: "steer" });
    expect(steer.command).toBe("steer");
    const follow = await session.prompt({ message: "f", mode: "follow_up" });
    expect(follow.command).toBe("follow_up");
    const prompt = await session.prompt({ message: "p", mode: "prompt" });
    expect(prompt.command).toBe("prompt");
  });

  test("readCachedMessages reads the sqlite cache", async () => {
    const id = await makeRow();
    const host = createPiAgentHost();
    await persistMessages(id, [
      { role: "user", content: "cached", timestamp: 1 } as never,
    ]);
    const cached = await host.readCachedMessages(id);
    expect(cached).toHaveLength(1);
    expect((cached[0] as { content?: string }).content).toBe("cached");
  });

  test("syncIfLive uses the live client directly (no re-ensure)", async () => {
    const id = await makeRow();
    const host = createPiAgentHost();
    await host.ensure(id);
    const client = getLiveClient(id);
    const messages = await host.syncIfLive(id);
    expect(messages).not.toBeNull();
    expect(getLiveClient(id)).toBe(client);
  });
});
