/**
 * Create/pin must keep returning 201 (PR 1 characterization): `ok(data)` still
 * defaults to 200 and the HTTP adapter owns the 201, not the control plane.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { POST as sessionsPOST } from "@/app/api/sessions/route";
import { POST as projectsPOST } from "@/app/api/projects/route";
import { cleanupDbs, freshDb, makeTempDir, removeTempDir } from "../helpers/test-env";

const dirs: string[] = [];

beforeEach(async () => {
  await freshDb();
});

afterEach(() => {
  /* per-test temp dirs are removed in afterAll */
});

afterAll(async () => {
  await cleanupDbs();
  for (const d of dirs.splice(0)) await removeTempDir(d);
});

function post(body: unknown): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("201s live in the HTTP adapter", () => {
  test("POST /api/sessions → 201", async () => {
    const dir = await makeTempDir();
    dirs.push(dir);
    const res = await sessionsPOST(post({ cwd: dir, name: "created" }));
    expect(res.status).toBe(201);
    const data = (await res.json()) as { ok: boolean; data: { session: { id: string } } };
    expect(data.ok).toBe(true);
    expect(data.data.session.id).toBeTruthy();
  });

  test("POST /api/projects (pin) → 201", async () => {
    const dir = await makeTempDir();
    dirs.push(dir);
    const res = await projectsPOST(post({ path: dir }));
    expect(res.status).toBe(201);
    const data = (await res.json()) as { ok: boolean; data: { project: { path: string } } };
    expect(data.ok).toBe(true);
    expect(data.data.project.path).toBe(dir);
  });
});
