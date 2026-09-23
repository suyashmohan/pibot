/**
 * In-process projected subscribe: one projector per listener, snapshots only,
 * no spawn on attach.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getDb } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { createControlPlane } from "@/lib/control";
import type { SessionEvent } from "@/lib/control/types";
import { destroyClient, getLiveClient, stopProcess } from "@/lib/pi/manager";
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
  restorePi = installFakePi({ FAKE_PI_SLOW_TURN_MS: "300" });
});

afterEach(() => {
  for (const id of liveIds.splice(0)) destroyClient(id);
  stopProcess(null);
  restorePi?.();
  restorePi = null;
});

afterAll(async () => {
  await cleanupDbs();
  for (const d of dirs.splice(0)) await removeTempDir(d);
});

const control = createControlPlane();

async function seedSession(): Promise<string> {
  const dir = await makeTempDir();
  dirs.push(dir);
  const id = uniqueId("sub");
  const now = Date.now();
  (await getDb())
    .insert(sessions)
    .values({ id, name: "sub", cwd: dir, createdAt: now, updatedAt: now })
    .run();
  liveIds.push(id);
  return id;
}

describe("sessions.subscribe", () => {
  test("attaching to a sleeping session does not spawn and delivers nothing", async () => {
    const id = await seedSession();
    const seen: SessionEvent[] = [];
    const off = control.sessions.subscribe(id, (ev) => seen.push(ev));
    expect(getLiveClient(id)).toBeNull();
    await Bun.sleep(50);
    expect(seen).toEqual([]);
    off();
  });

  test("prompt flows through as snapshot events", async () => {
    const id = await seedSession();
    const seen: SessionEvent[] = [];
    const events: SessionEvent[] = [];
    const settled = new Promise<void>((resolve) => {
      const off = control.sessions.subscribe(id, (ev) => {
        seen.push(ev);
        if (ev.type === "turn.settled") {
          off();
          resolve();
        }
      });
    });

    await control.sessions.start(id);
    const res = await control.sessions.prompt(id, { message: "hi" });
    expect(res.response.success).toBe(true);
    await settled;

    events.push(...seen);
    expect(events.some((e) => e.type === "turn.started")).toBe(true);
    const drafts = events.filter(
      (e): e is Extract<SessionEvent, { type: "draft.updated" }> => e.type === "draft.updated",
    );
    expect(drafts.length).toBeGreaterThan(0);
    expect(drafts[drafts.length - 1]!.draft.text).toBe("echo: hi");
    expect(events.some((e) => e.type === "turn.settled")).toBe(true);
  });

  test("subscribeRaw stays raw (no projection) and does not spawn", async () => {
    const id = await seedSession();
    const raw: string[] = [];
    const off = control.sessions.subscribeRaw(id, (ev) => raw.push(String(ev.type)));
    expect(getLiveClient(id)).toBeNull();
    await control.sessions.start(id);
    const res = await control.sessions.prompt(id, { message: "hey" });
    expect(res.response.success).toBe(true);
    await Bun.sleep(600);
    expect(raw).toContain("agent_start");
    expect(raw).toContain("agent_settled");
    off();
  });
});
