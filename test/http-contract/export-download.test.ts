/**
 * GET /api/sessions/[id]/export — browser download of the staged HTML export.
 *
 * The export itself is produced by `POST /control { action: "export_html" }`,
 * which stages it in the OS temp dir. This route only streams the staged file
 * as an attachment: it must never spawn pi (downloading is a read).
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GET as exportGET } from "@/app/api/sessions/[id]/export/route";
import { getDb } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { destroyClient, getLiveClient, stopProcess } from "@/lib/pi/manager";
import { exportFileName, exportTempPath } from "@/lib/export-html";
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
const staged: string[] = [];
let restorePi: (() => void) | null = null;

beforeEach(async () => {
  await freshDb();
  restorePi?.();
  restorePi = installFakePi();
});

afterEach(async () => {
  for (const id of liveIds.splice(0)) destroyClient(id);
  stopProcess(null);
  restorePi?.();
  restorePi = null;
  for (const path of staged.splice(0)) {
    try {
      await Bun.file(path).delete();
    } catch {
      /* best effort */
    }
  }
});

afterAll(async () => {
  await cleanupDbs();
  for (const d of dirs.splice(0)) await removeTempDir(d);
});

async function seedSession(): Promise<string> {
  const dir = await makeTempDir();
  dirs.push(dir);
  const id = uniqueId("dl");
  const now = Date.now();
  (await getDb())
    .insert(sessions)
    .values({ id, name: "download", cwd: dir, createdAt: now, updatedAt: now })
    .run();
  liveIds.push(id);
  return id;
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const request = () => new Request("http://localhost/api/test");

describe("GET /api/sessions/[id]/export", () => {
  test("streams the staged file as an HTML attachment", async () => {
    const id = await seedSession();
    const path = exportTempPath(id);
    staged.push(path);
    await Bun.write(path, "<!doctype html><html><body>hello export</body></html>");

    const res = await exportGET(request(), params(id));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="${exportFileName(id)}"`,
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(await res.text()).toContain("hello export");
  });

  test("404s before the first export", async () => {
    const id = await seedSession();
    const res = await exportGET(request(), params(id));
    expect(res.status).toBe(404);
    const data = (await res.json()) as { ok: boolean; error?: string };
    expect(data.ok).toBe(false);
  });

  test("404s for an unknown session", async () => {
    const res = await exportGET(request(), params("no-such-session"));
    expect(res.status).toBe(404);
  });

  test("does not spawn a sleeping session's pi process", async () => {
    const id = await seedSession();
    const path = exportTempPath(id);
    staged.push(path);
    await Bun.write(path, "<html></html>");

    const res = await exportGET(request(), params(id));
    expect(res.status).toBe(200);
    expect(getLiveClient(id)).toBeNull();
  });
});
