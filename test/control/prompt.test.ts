/**
 * Control-layer prompt statuses (mirrors test/http-contract/prompt.test.ts,
 * without HTTP). The busy regex and the steer/follow_up 409 live in control;
 * a route change must not be able to drift them.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getDb } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { createControlPlane } from "@/lib/control";
import { createPolicyEngine } from "@/lib/control/policy";
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
  restorePi = null;
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

function fakePi(extra: Record<string, string> = {}): void {
  restorePi?.();
  restorePi = installFakePi(extra);
}

async function seed(): Promise<string> {
  const dir = await makeTempDir();
  dirs.push(dir);
  const id = uniqueId("cprompt");
  const now = Date.now();
  (await getDb())
    .insert(sessions)
    .values({ id, name: "cprompt", cwd: dir, createdAt: now, updatedAt: now })
    .run();
  liveIds.push(id);
  return id;
}

const control = createControlPlane({ policy: createPolicyEngine() });

describe("control.sessions.prompt", () => {
  test("empty message → 400 before spawning", async () => {
    fakePi();
    const id = await seed();
    const err = await control.sessions.prompt(id, { message: "  " }).catch((e: unknown) => e);
    expect((err as { status?: number }).status).toBe(400);
    expect((err as Error).message).toBe("Message is required");
    expect(getLiveClient(id)).toBeNull();
  });

  test("images without text are allowed", async () => {
    fakePi();
    const id = await seed();
    const out = await control.sessions.prompt(id, {
      message: "",
      images: [{ type: "image", data: "aGk=", mimeType: "image/png" }],
    });
    expect(out.response.success).toBe(true);
  });

  test("busy-regex failure → 409", async () => {
    fakePi({ FAKE_PI_PROMPT_ERROR: "agent is busy" });
    const id = await seed();
    const err = await control.sessions.prompt(id, { message: "x" }).catch((e: unknown) => e);
    expect((err as { status?: number }).status).toBe(409);
  });

  test("other prompt failure → 400", async () => {
    fakePi({ FAKE_PI_PROMPT_ERROR: "bad input" });
    const id = await seed();
    const err = await control.sessions.prompt(id, { message: "x" }).catch((e: unknown) => e);
    expect((err as { status?: number }).status).toBe(400);
  });

  test("steer / follow_up failure is always 409", async () => {
    fakePi({ FAKE_PI_STEER_ERROR: "nope" });
    const id = await seed();
    const steer = await control.sessions
      .prompt(id, { message: "x", mode: "steer" })
      .catch((e: unknown) => e);
    expect((steer as { status?: number }).status).toBe(409);
    const follow = await control.sessions
      .prompt(id, { message: "x", mode: "follow_up" })
      .catch((e: unknown) => e);
    expect((follow as { status?: number }).status).toBe(409);
  });
});
