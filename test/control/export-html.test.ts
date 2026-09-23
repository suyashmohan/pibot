/**
 * `export_html` staging regression.
 *
 * pi's default output path is the session cwd (it writes
 * `pi-session-<timestamp>_<id>.html` there), so a click on Export dumped a
 * multi-megabyte file into the user's project. The control plane must pass an
 * explicit temp-dir `outputPath`; the browser then downloads the staged file.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getDb } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { createControlPlane } from "@/lib/control";
import { destroyClient, stopProcess } from "@/lib/pi/manager";
import { exportTempPath } from "@/lib/export-html";
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

const control = createControlPlane();

async function seedSession(): Promise<{ id: string; dir: string }> {
  const dir = await makeTempDir();
  dirs.push(dir);
  const id = uniqueId("export");
  const now = Date.now();
  (await getDb())
    .insert(sessions)
    .values({ id, name: "export me", cwd: dir, createdAt: now, updatedAt: now })
    .run();
  liveIds.push(id);
  return { id, dir };
}

describe("export_html staging", () => {
  test("stages the transcript in the temp dir, never the session cwd", async () => {
    const { id, dir } = await seedSession();
    await control.sessions.start(id);
    const out = await control.sessions.control(id, { action: "export_html" });
    const path = (out.response?.data as { path?: string } | undefined)?.path ?? "";
    staged.push(path);

    expect(path).toBe(exportTempPath(id));
    expect(path.startsWith("/tmp/")).toBe(true);
    expect(await Bun.file(path).exists()).toBe(true);

    // The session working directory must stay clean: real pi would have
    // dropped `pi-session-*.html` here when no outputPath is sent.
    const htmlInCwd: string[] = [];
    for await (const name of new Bun.Glob("*.html").scan({ cwd: dir })) htmlInCwd.push(name);
    expect(htmlInCwd).toEqual([]);
  });

  test("an explicit outputPath still wins (API parity)", async () => {
    const { id, dir } = await seedSession();
    await control.sessions.start(id);
    const target = `${dir}/custom-export.html`;
    staged.push(target);
    const out = await control.sessions.control(id, {
      action: "export_html",
      outputPath: target,
    });
    const path = (out.response?.data as { path?: string } | undefined)?.path;
    expect(path).toBe(target);
    expect(await Bun.file(target).exists()).toBe(true);
  });
});
