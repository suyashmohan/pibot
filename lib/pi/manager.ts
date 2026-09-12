import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { Emitter } from "../emitter";
import { dirExists } from "../files";
import { messages as messagesTable, sessions as sessionsTable } from "../db/schema";
import { PiRpcClient } from "./rpc-client";
import type { AgentMessage, PiEvent, RpcResponse } from "./types";

interface ManagedEntry {
  webId: string;
  client: PiRpcClient;
  cwd: string;
  emitter: Emitter;
  detach: () => void;
  lastSeen: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __pibotManaged: Map<string, ManagedEntry> | undefined;
  // eslint-disable-next-line no-var
  var __pibotInflight: Map<string, Promise<PiRpcClient>> | undefined;
  // eslint-disable-next-line no-var
  var __pibotGlobalClient: PiRpcClient | undefined;
  // eslint-disable-next-line no-var
  var __pibotGlobalDetach: (() => void) | undefined;
}

function managedMap(): Map<string, ManagedEntry> {
  if (!globalThis.__pibotManaged) globalThis.__pibotManaged = new Map();
  return globalThis.__pibotManaged;
}

/** Broadcast a server-side synthesized event to SSE subscribers. */
export function broadcast(webId: string, ev: PiEvent): void {
  managedMap().get(webId)?.emitter.emit("sse", ev);
}

export function subscribe(webId: string, listener: (ev: PiEvent) => void): () => void {
  let entry = managedMap().get(webId);
  if (!entry) {
    // Create a lightweight placeholder emitter so SSE can attach before
    // the pi process is spawned (e.g. immediate navigation after create).
    const emitter = new Emitter();
    entry = {
      webId,
      client: null as unknown as PiRpcClient,
      cwd: "",
      emitter,
      detach: () => {},
      lastSeen: Date.now(),
    };
    managedMap().set(webId, entry);
  }
  entry.emitter.on("sse", listener);
  entry.lastSeen = Date.now();
  return () => {
    entry?.emitter.off("sse", listener);
  };
}

function attachForwarding(webId: string, client: PiRpcClient): () => void {
  const onEvent = (ev: PiEvent) => {
    managedMap().get(webId)?.emitter.emit("sse", ev);
    // Best-effort persistence: reconcile the message cache once the
    // agent fully settles (covers retries / queued continuations).
    if (ev.type === "agent_settled" || ev.type === "compaction_end") {
      void syncMessagesFromPi(webId).catch((err) =>
        console.error(`[pi] sync after ${String(ev.type)} failed`, err),
      );
    }
    if (ev.type === "agent_end" || ev.type === "turn_end") {
      touchSession(webId);
    }
  };
  const onExit = (info: unknown) => {
    managedMap().get(webId)?.emitter.emit("sse", {
      type: "client_exit",
      info,
    } satisfies PiEvent);
  };
  client.on("event", onEvent);
  client.on("exit", onExit);
  return () => {
    client.off("event", onEvent);
    client.off("exit", onExit);
  };
}

function touchSession(webId: string) {
  void getDb()
    .then((db) =>
      db
        .update(sessionsTable)
        .set({ updatedAt: Date.now() })
        .where(eq(sessionsTable.id, webId))
        .run(),
    )
    .catch(() => {
      /* noop */
    });
}

/**
 * Return the live RPC client for a web session, spawning (or respawning)
 * the `pi --mode rpc` subprocess when needed.
 *
 * Concurrent callers (e.g. an SSE reconnect racing a REST call) share one
 * in-flight spawn so we never orphan duplicate pi processes.
 */
export function ensureClient(webId: string): Promise<PiRpcClient> {
  const existing = managedMap().get(webId);
  if (existing?.client && existing.client.alive) {
    existing.lastSeen = Date.now();
    return Promise.resolve(existing.client);
  }
  if (!globalThis.__pibotInflight) globalThis.__pibotInflight = new Map();
  const running = globalThis.__pibotInflight.get(webId);
  if (running) return running;
  const p = ensureClientInner(webId).finally(() => {
    if (globalThis.__pibotInflight?.get(webId) === p) globalThis.__pibotInflight.delete(webId);
  });
  globalThis.__pibotInflight.set(webId, p);
  return p;
}

async function ensureClientInner(webId: string): Promise<PiRpcClient> {
  const db = await getDb();
  const row = db.select().from(sessionsTable).where(eq(sessionsTable.id, webId)).get();
  if (!row) throw new Error("Session not found");

  const existing = managedMap().get(webId);
  if (existing?.client && existing.client.alive) {
    existing.lastSeen = Date.now();
    return existing.client;
  }
  existing?.detach?.();
  try {
    existing?.client?.dispose();
  } catch {
    /* noop */
  }

  if (!(await dirExists(row.cwd))) {
    throw new Error(`Working directory does not exist: ${row.cwd}`);
  }

  const client = PiRpcClient.spawn({
    cwd: row.cwd,
    sessionFile: row.piSessionFile,
    name: row.name,
    provider: row.provider,
    model: row.modelId,
  });

  let emitter = existing?.emitter;
  if (!emitter) {
    emitter = new Emitter();
  }
  const detach = attachForwarding(webId, client);
  managedMap().set(webId, {
    webId,
    client,
    cwd: row.cwd,
    emitter,
    detach,
    lastSeen: Date.now(),
  });

  // Verify the process is usable and capture pi-assigned ids.
  const state = (await client.send({ type: "get_state" })) as RpcResponse;
  if (!state.success) {
    const msg = `pi get_state failed: ${String(state.error ?? "unknown error")}`;
    throw new Error(msg);
  }
  const data = (state.data ?? {}) as Record<string, unknown>;
  const piSessionId =
    typeof data.sessionId === "string" ? data.sessionId : row.piSessionId;
  const piSessionFile =
    typeof data.sessionFile === "string" ? data.sessionFile : row.piSessionFile;
  const thinking =
    typeof data.thinkingLevel === "string" ? data.thinkingLevel : row.thinkingLevel;
  db.update(sessionsTable)
    .set({
      piSessionId,
      piSessionFile,
      thinkingLevel: thinking,
      updatedAt: Date.now(),
    })
    .where(eq(sessionsTable.id, webId))
    .run();

  // Backfill cached messages for a resumed session (uses the fresh client
  // directly to avoid re-entering ensureClient while spawning).
  if (row.piSessionFile) {
    void fetchAndPersist(client, webId).catch(() => {});
  }

  return client;
}

export function getLiveClient(webId: string): PiRpcClient | null {
  const entry = managedMap().get(webId);
  return entry?.client && entry.client.alive ? entry.client : null;
}

export function destroyClient(webId: string): void {
  const entry = managedMap().get(webId);
  if (!entry) return;
  // Keep the SSE emitter alive briefly so the UI can observe client_exit.
  entry.detach?.();
  try {
    entry.client?.dispose();
  } catch {
    /* noop */
  }
  entry.emitter.emit("sse", { type: "client_exit", reason: "disposed" });
  managedMap().delete(webId);
}

/** Shared client (server cwd) used for metadata like model listings. */
export async function ensureGlobalClient(): Promise<PiRpcClient> {
  const cur = globalThis.__pibotGlobalClient;
  if (cur && cur.alive) return cur;
  try {
    globalThis.__pibotGlobalDetach?.();
  } catch {
    /* noop */
  }
  try {
    cur?.dispose();
  } catch {
    /* noop */
  }
  const cwd = process.env.PI_DEFAULT_CWD?.trim() || process.cwd();
  const client = PiRpcClient.spawn({ cwd, extraCliArgs: ["--no-session"] });
  globalThis.__pibotGlobalClient = client;
  const detach = () => {
    client.removeAllListeners();
  };
  globalThis.__pibotGlobalDetach = detach;
  await client.send({ type: "get_state" });
  return client;
}

/** Pull pi's authoritative messages via a known client and mirror into sqlite. */
export async function fetchAndPersist(client: PiRpcClient, webId: string): Promise<AgentMessage[]> {
  const res = await client.send({ type: "get_messages" });
  if (!res.success) throw new Error(String(res.error ?? "get_messages failed"));
  const list = ((res.data as { messages?: unknown })?.messages ?? []) as AgentMessage[];
  await persistMessages(webId, list);
  return list;
}

export async function syncMessagesFromPi(webId: string): Promise<AgentMessage[]> {
  const client = await ensureClient(webId);
  return fetchAndPersist(client, webId);
}

export async function persistMessages(webId: string, list: AgentMessage[]): Promise<void> {
  const db = await getDb();
  db.delete(messagesTable).where(eq(messagesTable.sessionId, webId)).run();
  if (!list.length) {
    touchSession(webId);
    return;
  }
  for (const m of list) {
    const role =
      typeof (m as { role?: unknown }).role === "string"
        ? String((m as { role?: unknown }).role)
        : "unknown";
    const ts =
      typeof (m as { timestamp?: unknown }).timestamp === "number"
        ? Number((m as { timestamp?: unknown }).timestamp)
        : Date.now();
    let contentJson = "[]";
    try {
      const c = (m as { content?: unknown }).content;
      contentJson = JSON.stringify(c ?? null).slice(0, 200_000);
    } catch {
      contentJson = "[]";
    }
    let rawJson = "{}";
    try {
      rawJson = JSON.stringify(m).slice(0, 500_000);
    } catch {
      rawJson = "{}";
    }
    db.insert(messagesTable)
      .values({ sessionId: webId, role, contentJson, rawJson, timestamp: ts })
      .run();
  }
  touchSession(webId);
}

export async function readCachedMessages(webId: string): Promise<AgentMessage[]> {
  const db = await getDb();
  const rows = db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.sessionId, webId))
    .all();
  const out: AgentMessage[] = [];
  for (const r of rows) {
    try {
      out.push(JSON.parse(r.rawJson) as AgentMessage);
    } catch {
      /* skip corrupt rows */
    }
  }
  return out;
}
