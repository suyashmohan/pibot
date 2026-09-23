/**
 * POST /control catch-all through the control plane: read-only actions never
 * spawn, mutating actions delegate to host methods, unknown actions are 400.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { createControlPlane } from "@/lib/control";
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
  restorePi = installFakePi();
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
  const id = uniqueId("ctlact");
  const now = Date.now();
  (await getDb())
    .insert(sessions)
    .values({ id, name: "ctlact", cwd: dir, createdAt: now, updatedAt: now })
    .run();
  liveIds.push(id);
  return id;
}

describe("SessionService.control", () => {
  test("read-only actions on a sleeping session do not spawn", async () => {
    const id = await seedSession();
    for (const action of ["get_commands", "get_fork_messages", "get_last_assistant_text"]) {
      expect(await control.sessions.control(id, { action })).toEqual({
        response: null,
        live: false,
      });
    }
    expect(getLiveClient(id)).toBeNull();
  });

  test("read-only actions on a live session return the response", async () => {
    const id = await seedSession();
    await control.sessions.start(id);
    const out = await control.sessions.control(id, { action: "get_commands" });
    expect(out.live).toBe(true);
    expect(out.response?.type).toBe("response");
  });

  test("unknown action → 400", async () => {
    const id = await seedSession();
    const err = await control.sessions
      .control(id, { action: "wibble" })
      .catch((e: unknown) => e);
    expect((err as { status?: number }).status).toBe(400);
    expect(String((err as Error).message)).toContain("Unknown action: wibble");
  });

  test("abort delegates to the host and syncs", async () => {
    const id = await seedSession();
    await control.sessions.start(id);
    const out = await control.sessions.control(id, { action: "abort" });
    expect(out.response?.success).toBe(true);
  });

  test("set_* actions pass their extra fields through sendRaw", async () => {
    const id = await seedSession();
    await control.sessions.start(id);
    const out = await control.sessions.control(id, {
      action: "set_steering_mode",
      mode: "all",
    });
    expect(out.response?.success).toBe(true);
  });

  test("answerDialog guards its inputs", async () => {
    const id = await seedSession();
    await expect(control.sessions.answerDialog(id, { id: "" })).rejects.toThrow(
      "Dialog id is required",
    );
    await control.sessions.start(id);
    await expect(control.sessions.answerDialog(id, { id: "d1" })).rejects.toThrow(
      "Provide value, confirmed, or cancelled",
    );
    expect(await control.sessions.answerDialog(id, { id: "d1", cancelled: true })).toEqual({
      sent: true,
    });
  });
});

describe("SessionService model + tree", () => {
  test("getModel returns the model list and thinking levels", async () => {
    const id = await seedSession();
    const out = await control.sessions.getModel(id);
    expect(out.models).toHaveLength(1);
    expect(out.thinkingLevels).toEqual(["off", "low", "high"]);
  });

  test("setThinkingLevel persists the level on the row", async () => {
    const id = await seedSession();
    const out = await control.sessions.setThinkingLevel(id, "high");
    expect(out.response.success).toBe(true);
    const row = (await getDb())
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .get();
    expect(row?.thinkingLevel).toBe("high");
  });

  test("setModel requires a modelId", async () => {
    const id = await seedSession();
    const err = await control.sessions
      .setModel(id, { modelId: "" })
      .catch((e: unknown) => e);
    expect((err as { status?: number }).status).toBe(400);
    expect(String((err as Error).message)).toBe("modelId is required");
  });

  test("getTree spawns (unused by UI) and returns data", async () => {
    const id = await seedSession();
    const out = await control.sessions.getTree(id);
    expect(out).toHaveProperty("tree");
    expect(getLiveClient(id)).not.toBeNull();
  });
});
