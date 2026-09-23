/**
 * HTTP prompt contract (PR 1 characterization).
 *
 * Freezes the status codes the control-plane prompt must keep: 400 empty body,
 * 409 busy steer/follow_up failures, 409 busy-regex on the default prompt,
 * 400 other prompt failures, and **500** (not 404) for a missing session.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { POST as promptPOST } from "@/app/api/sessions/[id]/prompt/route";
import { getDb } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
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

async function seedSession(): Promise<string> {
  const dir = await makeTempDir();
  dirs.push(dir);
  const id = uniqueId("prompt");
  const now = Date.now();
  (await getDb())
    .insert(sessions)
    .values({ id, name: "prompt-test", cwd: dir, createdAt: now, updatedAt: now })
    .run();
  liveIds.push(id);
  return id;
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function post(body?: unknown): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("POST /prompt status contract", () => {
  test("empty body → 400 Message is required (before spawning)", async () => {
    fakePi();
    const id = await seedSession();
    const res = await promptPOST(post({}), params(id));
    expect(res.status).toBe(400);
    expect(await body<{ error: string }>(res)).toMatchObject({
      ok: false,
      error: "Message is required",
    });
  });

  test("default prompt busy-regex failure → 409", async () => {
    fakePi({ FAKE_PI_PROMPT_ERROR: "agent is busy" });
    const id = await seedSession();
    const res = await promptPOST(post({ message: "hi" }), params(id));
    expect(res.status).toBe(409);
    expect((await body<{ error: string }>(res)).error).toContain("busy");
  });

  test("other default prompt failure → 400", async () => {
    fakePi({ FAKE_PI_PROMPT_ERROR: "nope" });
    const id = await seedSession();
    const res = await promptPOST(post({ message: "hi" }), params(id));
    expect(res.status).toBe(400);
    expect((await body<{ error: string }>(res)).error).toBe("nope");
  });

  test("steer failure → 409 even when the error is not busy-shaped", async () => {
    fakePi({ FAKE_PI_STEER_ERROR: "no" });
    const id = await seedSession();
    const res = await promptPOST(post({ message: "hi", mode: "steer" }), params(id));
    expect(res.status).toBe(409);
  });

  test("follow_up failure → 409", async () => {
    fakePi({ FAKE_PI_STEER_ERROR: "no" });
    const id = await seedSession();
    const res = await promptPOST(post({ message: "hi", mode: "follow_up" }), params(id));
    expect(res.status).toBe(409);
  });

  test("missing session → 500 (ensure-path, do not 'fix' to 404)", async () => {
    fakePi();
    const res = await promptPOST(post({ message: "hi" }), params("no-such-session"));
    expect(res.status).toBe(500);
    expect((await body<{ error: string }>(res)).error).toBe("Session not found");
  });

  test("success → { ok: true, data: { response } } and spawns", async () => {
    fakePi();
    const id = await seedSession();
    const res = await promptPOST(post({ message: "hello" }), params(id));
    expect(res.status).toBe(200);
    const data = await body<{
      ok: boolean;
      data: { response: { type: string; success: boolean; command: string } };
    }>(res);
    expect(data.ok).toBe(true);
    expect(data.data.response.type).toBe("response");
    expect(data.data.response.success).toBe(true);
    expect(data.data.response.command).toBe("prompt");
  });
});
