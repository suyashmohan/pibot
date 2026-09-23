/**
 * Lazy spawn contract.
 *
 * Viewing an old session must never start a pi process. Mounting ChatView
 * calls five read paths — session detail, /messages, /stats, the SSE stream
 * and the read-only control actions — and every one of them used to
 * `ensureClient()` (spawn). Now they serve cache / empty read-only state and
 * report `live: false`; a process starts only on explicit intent
 * (`POST /api/sessions/[id]/start`, called when the composer is focused).
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GET as sessionGET } from "@/app/api/sessions/[id]/route";
import { POST as controlPOST } from "@/app/api/sessions/[id]/control/route";
import { GET as messagesGET } from "@/app/api/sessions/[id]/messages/route";
import { GET as modelGET } from "@/app/api/sessions/[id]/model/route";
import { POST as startPOST } from "@/app/api/sessions/[id]/start/route";
import { GET as statsGET } from "@/app/api/sessions/[id]/stats/route";
import { GET as streamGET } from "@/app/api/sessions/[id]/stream/route";
import { GET as treeGET } from "@/app/api/sessions/[id]/tree/route";
import { GET as modelsGET } from "@/app/api/models/route";
import { getDb } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import {
  destroyClient,
  getLiveClient,
  listRunningProcesses,
  persistMessages,
  stopProcess,
} from "@/lib/pi/manager";
import {
  cleanupDbs,
  freshDb,
  makeTempDir,
  removeTempDir,
  uniqueId,
  installFakePi,
} from "./helpers/test-env";

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
  stopProcess(null); // never leak the shared metadata process across tests
  restorePi?.();
  restorePi = null;
});

async function seedSession(): Promise<string> {
  const dir = await makeTempDir();
  dirs.push(dir);
  const id = uniqueId("lazy");
  const now = Date.now();
  (await getDb())
    .insert(sessions)
    .values({ id, name: "sleepy", cwd: dir, createdAt: now, updatedAt: now })
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

async function assertNoProcess(id: string) {
  expect(getLiveClient(id)).toBeNull();
  expect((await listRunningProcesses()).some((p) => p.sessionId === id)).toBe(false);
}

describe("viewing a session does not spawn a pi process", () => {
  test("SSE stream attaches without spawning", async () => {
    const id = await seedSession();
    const ac = new AbortController();

    const res = await streamGET(
      new Request("http://localhost/stream", { signal: ac.signal }),
      params(id),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("event: ready");
    await assertNoProcess(id);

    ac.abort();
    await reader.cancel().catch(() => {});
  });

  test("stats returns live:false instead of spawning", async () => {
    const id = await seedSession();
    const data = await body<{ ok: boolean; data: { stats: unknown; live: boolean } }>(
      await statsGET(new Request("http://localhost/api/test"), params(id)),
    );
    expect(data.data.live).toBe(false);
    expect(data.data.stats).toBeNull();
    await assertNoProcess(id);
  });

  test("messages serves the cache instead of spawning", async () => {
    const id = await seedSession();
    await persistMessages(id, [
      { role: "user", content: "old question", timestamp: 1 } as never,
      { role: "assistant", content: [{ type: "text", text: "old answer" }], timestamp: 2 } as never,
    ]);

    const data = await body<{ data: { messages: unknown[]; live: boolean } }>(
      await messagesGET(new Request("http://localhost/api/test"), params(id)),
    );
    expect(data.data.live).toBe(false);
    expect(data.data.messages).toHaveLength(2);
    await assertNoProcess(id);
  });

  test("session detail serves the cache instead of spawning", async () => {
    const id = await seedSession();
    await persistMessages(id, [
      { role: "user", content: "cached", timestamp: 1 } as never,
    ]);

    const data = await body<{
      data: { messages: unknown[]; state: unknown; stats: unknown; live: boolean; session: { id: string } };
    }>(await sessionGET(new Request("http://localhost/api/test"), params(id)));

    expect(data.data.session.id).toBe(id);
    expect(data.data.messages).toHaveLength(1);
    expect(data.data.state).toBeNull();
    expect(data.data.stats).toBeNull();
    expect(data.data.live).toBe(false);
    await assertNoProcess(id);
  });

  test("read-only control actions do not spawn", async () => {
    const id = await seedSession();
    const data = await body<{ data: { response: unknown; live: boolean } }>(
      await controlPOST(post({ action: "get_commands" }), params(id)),
    );
    expect(data.data.live).toBe(false);
    expect(data.data.response).toBeNull();
    await assertNoProcess(id);
  });
});

/**
 * Known lazy-spawn leaks. These endpoints DO spawn today; the control-plane
 * extraction must not silently "fix" them by switching to `getLiveClient`.
 */
describe("known spawn leaks stay locked", () => {
  test("GET /model spawns the session process (opens the model picker)", async () => {
    const id = await seedSession();
    const res = await modelGET(new Request("http://localhost/api/test"), params(id));
    expect(res.status).toBe(200);
    expect(getLiveClient(id)).not.toBeNull();
    expect((await listRunningProcesses()).some((p) => p.sessionId === id)).toBe(true);
  });

  test("GET /tree spawns the session process (unused by the UI)", async () => {
    const id = await seedSession();
    const res = await treeGET(new Request("http://localhost/api/test"), params(id));
    expect(res.status).toBe(200);
    expect(getLiveClient(id)).not.toBeNull();
  });

  test("GET /api/models spawns the shared metadata process", async () => {
    expect((await listRunningProcesses()).some((p) => p.kind === "server")).toBe(false);
    const res = await modelsGET();
    expect(res.status).toBe(200);
    expect((await listRunningProcesses()).some((p) => p.kind === "server")).toBe(true);
  });
});

describe("explicit start", () => {
  test("POST /start spawns, and reads become live afterwards", async () => {
    const id = await seedSession();

    const started = await body<{ data: { started: boolean; live: boolean } }>(
      await startPOST(post(), params(id)),
    );
    expect(started.data.started).toBe(true);
    expect(started.data.live).toBe(true);
    expect(getLiveClient(id)).not.toBeNull();

    const data = await body<{
      data: { live: boolean; stats: { tokens?: { total?: number } } | null };
    }>(await statsGET(new Request("http://localhost/api/test"), params(id)));
    expect(data.data.live).toBe(true);
    expect(data.data.stats?.tokens?.total).toBe(10); // fake-pi's get_session_stats
  });

  test("start is idempotent — a second focus reuses the same process", async () => {
    const id = await seedSession();
    await startPOST(post(), params(id));
    const first = getLiveClient(id);
    await startPOST(post(), params(id));
    expect(getLiveClient(id)).toBe(first);
  });
});

afterAll(async () => {
  await cleanupDbs();
  for (const d of dirs.splice(0)) await removeTempDir(d);
});
