/**
 * HTTP lifecycle contract: clone returns the created web row (the clone dance
 * is the trickiest code in the API layer and previously had no test). Needs the
 * extended fake-pi, which moves `sessionFile` on clone.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { POST as lifecyclePOST } from "@/app/api/sessions/[id]/lifecycle/route";
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

async function seedSession(): Promise<string> {
  const dir = await makeTempDir();
  dirs.push(dir);
  const id = uniqueId("lc");
  const now = Date.now();
  (await getDb())
    .insert(sessions)
    .values({ id, name: "lifecycle", cwd: dir, createdAt: now, updatedAt: now })
    .run();
  liveIds.push(id);
  return id;
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function post(body: unknown): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /lifecycle", () => {
  test("clone → 200 with clonedSession pointing at a new pi file", async () => {
    const id = await seedSession();
    const res = await lifecyclePOST(post({ op: "clone" }), params(id));
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      ok: boolean;
      data: {
        response: { success: boolean };
        clonedSession?: { id: string; piSessionFile: string | null; name: string };
      };
    };
    expect(data.ok).toBe(true);
    expect(data.data.response.success).toBe(true);
    expect(data.data.clonedSession).toBeDefined();
    expect(data.data.clonedSession!.name).toContain("(clone)");
    expect(data.data.clonedSession!.piSessionFile).toContain(".clone-");
    liveIds.push(data.data.clonedSession!.id);
  });

  test("unknown op → 400; fork without entryId → 400; missing session → 500", async () => {
    const id = await seedSession();
    expect((await lifecyclePOST(post({ op: "nope" }), params(id))).status).toBe(400);
    expect((await lifecyclePOST(post({ op: "fork" }), params(id))).status).toBe(400);
    expect(
      (await lifecyclePOST(post({ op: "clone" }), params("missing-session"))).status,
    ).toBe(500);
  });
});
