/**
 * HTTP SSE contract (PR 1 characterization): the stream is a named-event SSE
 * feed that attaches without spawning and exits 404 for a missing row.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GET as streamGET } from "@/app/api/sessions/[id]/stream/route";
import { getDb } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
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

async function seedSession(): Promise<string> {
  const dir = await makeTempDir();
  dirs.push(dir);
  const id = uniqueId("stream");
  const now = Date.now();
  (await getDb())
    .insert(sessions)
    .values({ id, name: "stream-test", cwd: dir, createdAt: now, updatedAt: now })
    .run();
  liveIds.push(id);
  return id;
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /stream contract", () => {
  test("content-type + first chunk is named `ready`; attaching does not spawn", async () => {
    const id = await seedSession();
    const ac = new AbortController();
    const res = await streamGET(
      new Request("http://localhost/stream", { signal: ac.signal }),
      params(id),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");

    const reader = res.body!.getReader();
    const first = await reader.read();
    const text = new TextDecoder().decode(first.value);
    expect(text).toContain("event: ready");
    expect(text).toContain(`"sessionId":"${id}"`);
    expect(getLiveClient(id)).toBeNull();

    ac.abort();
    await reader.cancel().catch(() => {});
  });

  test("missing session → 404", async () => {
    const res = await streamGET(new Request("http://localhost/stream"), params("nope"));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("Session not found");
  });
});
