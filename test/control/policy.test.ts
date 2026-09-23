/**
 * Supervisor CallContext policy.
 *
 * The fan-out half is the tricky one: a turn emits message_end + turn_end +
 * agent_end + agent_settled, and a fast turn settles **inside** the
 * `await prompt()` window (same stdout chunk as the RPC response). The
 * listener must be attached before the send and release at most once, or the
 * slot leaks / goes negative.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getDb } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { createControlPlane } from "@/lib/control";
import { createPolicyEngine } from "@/lib/control/policy";
import type { CallContext } from "@/lib/control/types";
import { UI_CTX } from "@/lib/control/types";
import { destroyClient, stopProcess } from "@/lib/pi/manager";
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

async function seed(label: string): Promise<string> {
  const dir = await makeTempDir();
  dirs.push(dir);
  const id = uniqueId(label);
  const now = Date.now();
  (await getDb())
    .insert(sessions)
    .values({ id, name: label, cwd: dir, createdAt: now, updatedAt: now })
    .run();
  liveIds.push(id);
  return id;
}

function supervisor(fromSessionId: string, chain: string[] = []): CallContext {
  return { source: "supervisor", fromSessionId, chain };
}

describe("policy: self-prompt and cycles", () => {
  test("UI context is allow-all, including a self-prompt", async () => {
    fakePi();
    const policy = createPolicyEngine();
    const plane = createControlPlane({ policy });
    const id = await seed("ui-self");
    await plane.sessions.prompt(id, { message: "self" }, UI_CTX);
    expect(policy.inFlight(undefined)).toBe(0);
  });

  test("supervisor self-prompt → 403", async () => {
    fakePi();
    const policy = createPolicyEngine();
    const plane = createControlPlane({ policy });
    const id = await seed("self");
    const err = await plane.sessions
      .prompt(id, { message: "loop" }, supervisor(id))
      .catch((e: unknown) => e);
    expect((err as { status?: number }).status).toBe(403);
    expect((err as Error).message).toContain("itself");
  });

  test("cycle A→B→A → 403", async () => {
    fakePi();
    const policy = createPolicyEngine();
    const plane = createControlPlane({ policy });
    const a = await seed("cycle-a");
    const b = await seed("cycle-b");
    const err = await plane.sessions
      .prompt(b, { message: "loop" }, supervisor(a, [b]))
      .catch((e: unknown) => e);
    expect((err as { status?: number }).status).toBe(403);
    expect((err as Error).message).toContain("cycle");
  });
});

describe("policy: fan-out", () => {
  test("four overlapping prompts: first three hold slots, fourth is 409", async () => {
    fakePi({ FAKE_PI_SLOW_TURN_MS: "500" });
    const policy = createPolicyEngine({ fanout: 3 });
    const plane = createControlPlane({ policy });
    const a = await seed("fan-sup");
    const b = await seed("fan-target");
    const ctx = supervisor(a);

    await plane.sessions.prompt(b, { message: "1" }, ctx);
    await plane.sessions.prompt(b, { message: "2" }, ctx);
    await plane.sessions.prompt(b, { message: "3" }, ctx);
    expect(policy.inFlight(a)).toBe(3);

    const err = await plane.sessions
      .prompt(b, { message: "4" }, ctx)
      .catch((e: unknown) => e);
    expect((err as { status?: number }).status).toBe(409);
    expect((err as Error).message).toContain("fan-out");

    // Wait for the three turns to settle: the slots come back.
    await Bun.sleep(900);
    expect(policy.inFlight(a)).toBe(0);
  });

  test("after settling, three more prompts are allowed", async () => {
    fakePi({ FAKE_PI_SLOW_TURN_MS: "200" });
    const policy = createPolicyEngine({ fanout: 3 });
    const plane = createControlPlane({ policy });
    const a = await seed("fan2-sup");
    const b = await seed("fan2-target");
    const ctx = supervisor(a);

    await plane.sessions.prompt(b, { message: "1" }, ctx);
    await plane.sessions.prompt(b, { message: "2" }, ctx);
    await plane.sessions.prompt(b, { message: "3" }, ctx);
    await Bun.sleep(700);
    expect(policy.inFlight(a)).toBe(0);

    await plane.sessions.prompt(b, { message: "4" }, ctx);
    await plane.sessions.prompt(b, { message: "5" }, ctx);
    await plane.sessions.prompt(b, { message: "6" }, ctx);
    expect(policy.inFlight(a)).toBe(3);
    await Bun.sleep(700);
    expect(policy.inFlight(a)).toBe(0);
  });

  test("a failed prompt does not leak a slot", async () => {
    fakePi({ FAKE_PI_PROMPT_ERROR: "nope" });
    const policy = createPolicyEngine({ fanout: 3 });
    const plane = createControlPlane({ policy });
    const a = await seed("fan3-sup");
    const b = await seed("fan3-target");
    const ctx = supervisor(a);

    await expect(plane.sessions.prompt(b, { message: "x" }, ctx)).rejects.toThrow("nope");
    expect(policy.inFlight(a)).toBe(0);
  });

  test("a full default fake-pi turn releases the slot during `await prompt()`", async () => {
    // No slow-turn hold: message_end + turn_end + agent_end + agent_settled
    // arrive in the same stdout chunk as the RPC response.
    fakePi();
    const policy = createPolicyEngine({ fanout: 3 });
    const plane = createControlPlane({ policy });
    const a = await seed("fan4-sup");
    const b = await seed("fan4-target");
    const ctx = supervisor(a);

    await plane.sessions.prompt(b, { message: "fast" }, ctx);
    expect(policy.inFlight(a)).toBe(0);

    // And it must not have gone negative: three more are still allowed.
    await plane.sessions.prompt(b, { message: "fast2" }, ctx);
    await plane.sessions.prompt(b, { message: "fast3" }, ctx);
    expect(policy.inFlight(a)).toBe(0);
  });
});
