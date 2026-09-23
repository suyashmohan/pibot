/**
 * Control-level file service: the path jail lives in the service (routes are
 * thin), raw files never leak an absolute path as JSON, and missing sessions
 * are 404s.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getDb } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { createControlPlane } from "@/lib/control";
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

const control = createControlPlane();

async function seedSession(): Promise<{ id: string; dir: string }> {
  const dir = await makeTempDir();
  dirs.push(dir);
  const id = uniqueId("files");
  const now = Date.now();
  (await getDb())
    .insert(sessions)
    .values({ id, name: "files", cwd: dir, createdAt: now, updatedAt: now })
    .run();
  liveIds.push(id);
  return { id, dir };
}

describe("SessionService.files", () => {
  test("mentions + browse list the working directory", async () => {
    const { id, dir } = await seedSession();
    await Bun.write(`${dir}/a.txt`, "hello");
    const mentions = await control.sessions.files.listMentions(id, "");
    expect(mentions.cwd).toBe(dir);
    expect(mentions.entries.some((e) => e.name === "a.txt")).toBe(true);

    const listing = await control.sessions.files.browse(id, "");
    expect(listing.entries.some((e) => e.name === "a.txt")).toBe(true);
  });

  test("preview reads a text file and keeps kind/language metadata", async () => {
    const { id, dir } = await seedSession();
    await Bun.write(`${dir}/main.ts`, "export const x = 1;\n");
    const preview = await control.sessions.files.preview(id, "main.ts");
    expect(preview.status).toBe("text");
    expect(preview.content).toContain("export const x");
    expect(preview.language).toBe("typescript");
  });

  test("path jail: escapes are 400 for mentions/browse/preview/raw", async () => {
    const { id } = await seedSession();
    for (const call of [
      () => control.sessions.files.listMentions(id, "../"),
      () => control.sessions.files.browse(id, "../../etc"),
      () => control.sessions.files.preview(id, "/etc/passwd"),
      () => control.sessions.files.raw(id, "../secret"),
    ]) {
      const err = await call().catch((e: unknown) => e);
      expect((err as { status?: number }).status).toBe(400);
    }
  });

  test("raw returns an absolute path but never via the JSON layer", async () => {
    const { id, dir } = await seedSession();
    await Bun.write(`${dir}/pic.png`, new Uint8Array([137, 80, 78, 71]));
    const file = await control.sessions.files.raw(id, "pic.png");
    expect(file.absPath.startsWith("/")).toBe(true);
    expect(file.contentType).toBe("image/png");
    expect(file.download).toBe(false);
  });

  test("missing session → 404; missing file → 404", async () => {
    const err = await control.sessions.files.browse("nope", "").catch((e: unknown) => e);
    expect((err as { status?: number }).status).toBe(404);

    const { id } = await seedSession();
    const fileErr = await control.sessions.files
      .preview(id, "nope.txt")
      .catch((e: unknown) => e);
    expect((fileErr as { status?: number }).status).toBe(404);
  });
});
