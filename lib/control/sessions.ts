/**
 * SessionService — CRUD, reads, prompt/runtime, subscriptions and files.
 *
 * Composes the runtime ops (`runtime.ts`), the raw/projected subscriptions
 * (`subscribe.ts`) and the file service (`files.ts`). Read paths use
 * `host.getLive` only and **never** `ensure`: opening an old session must not
 * spawn pi.
 */

import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  messages as messagesTable,
  sessions as sessionsTable,
} from "@/lib/db/schema";
import { dirExists } from "@/lib/files";
import { defaultCwd } from "@/lib/pi/env";
import type { PiEvent } from "@/lib/pi/types";
import { ControlError } from "./errors";
import type { FileService } from "./files";
import type { ControlDeps } from "./plane";
import { createRuntimeOps, type RuntimeOps } from "./runtime";
import { createSubscribe, createSubscribeRaw } from "./subscribe";
import type {
  AgentMessage,
  CallContext,
  CreateSessionInput,
  SessionDetail,
  SessionEvent,
  SessionListItem,
  SessionMessagesSnapshot,
  SessionRecord,
  SessionStatsSnapshot,
  Unsubscribe,
} from "./types";
import { UI_CTX, messagePreview } from "./types";

export interface SessionService extends RuntimeOps {
  list(): Promise<{ sessions: SessionListItem[] }>;
  create(
    input: CreateSessionInput,
    ctx?: CallContext,
  ): Promise<{ session: SessionRecord }>;
  get(id: string): Promise<SessionDetail>;
  rename(
    id: string,
    name: string,
    ctx?: CallContext,
  ): Promise<{ session: SessionRecord }>;
  delete(id: string, ctx?: CallContext): Promise<{ deleted: string }>;
  getMessages(id: string): Promise<SessionMessagesSnapshot>;
  getStats(id: string): Promise<SessionStatsSnapshot>;
  /** In-process projected events. Does not spawn; each subscriber owns a projector. */
  subscribe(id: string, listener: (ev: SessionEvent) => void): Unsubscribe;
  /**
   * `@internal` raw PiEvent fan-out. Does not project, does not spawn.
   * The HTTP SSE adapter is the only production caller.
   */
  subscribeRaw(id: string, listener: (ev: PiEvent) => void): Unsubscribe;
  files: FileService;
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createSessionService(
  deps: ControlDeps,
  files: FileService,
): SessionService {
  const runtime = createRuntimeOps(deps);
  const subscribe = createSubscribe(deps.host);
  const subscribeRaw = createSubscribeRaw(deps.host);

  return {
    ...runtime,
    files,

    async list() {
      const db = await deps.db();
      const rows = db
        .select()
        .from(sessionsTable)
        .orderBy(desc(sessionsTable.updatedAt))
        .all();
      // Attach a preview from the cached messages.
      const data: SessionListItem[] = rows.map((s) => {
        let preview: string | null = null;
        let messageCount = 0;
        try {
          const msgs = db
            .select()
            .from(messagesTable)
            .where(eq(messagesTable.sessionId, s.id))
            .all();
          messageCount = msgs.length;
          const last = msgs[msgs.length - 1];
          if (last) {
            try {
              // Unwrap the pi content blocks into human text. Serializing the
              // raw blocks here is what made every sidebar card read
              // `[{"type":"thinking","thinking":"…` (see messagePreview).
              const text = messagePreview(
                JSON.parse(last.rawJson) as AgentMessage,
                140,
              ).trim();
              preview = text && text !== "…" ? text : null;
            } catch {
              preview = null;
            }
          }
        } catch {
          /* ignore */
        }
        return { ...s, preview, messageCount };
      });
      return { sessions: data };
    },

    async create(input, _ctx = UI_CTX) {
      const cwd = (input.cwd?.trim() || defaultCwd()).trim();
      if (!(await dirExists(cwd))) {
        throw new ControlError(
          "bad_request",
          `Working directory does not exist: ${cwd}`,
          { status: 400 },
        );
      }
      const db = await deps.db();
      const now = deps.now();
      const id = nanoid(12);
      const name = input.name?.trim() || "New session";
      db.insert(sessionsTable)
        .values({
          id,
          name,
          cwd,
          provider: input.provider?.trim() || null,
          modelId: input.model?.trim() || null,
          thinkingLevel: input.thinkingLevel?.trim() || null,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      // Lazy spawn: no pi process boots here. It starts on first real use
      // (composer focus → POST /start).
      const row = db
        .select()
        .from(sessionsTable)
        .where(eq(sessionsTable.id, id))
        .get();
      return { session: row! };
    },

    async get(id) {
      const db = await deps.db();
      const row = db
        .select()
        .from(sessionsTable)
        .where(eq(sessionsTable.id, id))
        .get();
      if (!row) {
        throw new ControlError("not_found", "Session not found", { status: 404 });
      }

      let state: SessionDetail["state"] = null;
      let stats: SessionDetail["stats"] = null;
      let msgList: AgentMessage[] | null = null;
      let liveError: string | null = null;
      const live = deps.host.getLive(id);

      if (live) {
        try {
          const [stateRes, statsRes] = await Promise.all([
            live.getState(),
            live.getSessionStats(),
          ]);
          if (stateRes.success) {
            state = stateRes.data as SessionDetail["state"];
            const d = (stateRes.data ?? {}) as Record<string, unknown>;
            db.update(sessionsTable)
              .set({
                piSessionId:
                  typeof d.sessionId === "string" ? d.sessionId : row.piSessionId,
                piSessionFile:
                  typeof d.sessionFile === "string" ? d.sessionFile : row.piSessionFile,
                thinkingLevel:
                  typeof d.thinkingLevel === "string"
                    ? d.thinkingLevel
                    : row.thinkingLevel,
                updatedAt: deps.now(),
              })
              .where(eq(sessionsTable.id, id))
              .run();
          }
          if (statsRes.success) stats = statsRes.data as SessionDetail["stats"];
          msgList = await deps.host.syncIfLive(id);
        } catch (err) {
          liveError = toMessage(err);
        }
      }
      if (msgList == null) msgList = await deps.host.readCachedMessages(id);
      const isLive = live != null && liveError == null;

      const fresh = db
        .select()
        .from(sessionsTable)
        .where(eq(sessionsTable.id, id))
        .get();
      return {
        session: fresh!,
        state,
        stats,
        messages: msgList,
        liveError,
        live: isLive,
      };
    },

    async rename(id, name, _ctx = UI_CTX) {
      const db = await deps.db();
      const row = db
        .select()
        .from(sessionsTable)
        .where(eq(sessionsTable.id, id))
        .get();
      if (!row) {
        throw new ControlError("not_found", "Session not found", { status: 404 });
      }
      const trimmed = name?.trim();
      if (!trimmed) {
        throw new ControlError("bad_request", "Name is required", { status: 400 });
      }
      // Renaming is pure metadata — mirror it into a running pi process when
      // one exists, but never spawn one just to sync a name.
      const live = deps.host.getLive(id);
      if (live) {
        try {
          await live.setSessionName(trimmed);
        } catch {
          /* best effort — pi name sync is non-critical */
        }
      }
      db.update(sessionsTable)
        .set({ name: trimmed, updatedAt: deps.now() })
        .where(eq(sessionsTable.id, id))
        .run();
      const fresh = db
        .select()
        .from(sessionsTable)
        .where(eq(sessionsTable.id, id))
        .get();
      return { session: fresh! };
    },

    async delete(id, _ctx = UI_CTX) {
      const db = await deps.db();
      deps.host.destroy(id);
      db.delete(sessionsTable).where(eq(sessionsTable.id, id)).run();
      return { deleted: id };
    },

    async getMessages(id) {
      const live = deps.host.getLive(id);
      if (live) {
        try {
          return {
            messages: (await deps.host.syncIfLive(id)) ?? [],
            live: true,
          };
        } catch (err) {
          try {
            return {
              messages: await deps.host.readCachedMessages(id),
              live: false,
              liveError: toMessage(err),
            };
          } catch (err2) {
            throw new ControlError("internal", toMessage(err2), { status: 500 });
          }
        }
      }
      return { messages: await deps.host.readCachedMessages(id), live: false };
    },

    async getStats(id) {
      const live = deps.host.getLive(id);
      if (!live) return { state: null, stats: null, live: false };

      const [stateRes, statsRes] = await Promise.all([
        live.getState(),
        live.getSessionStats(),
      ]);
      return {
        state: stateRes.success ? (stateRes.data as SessionStatsSnapshot["state"]) : null,
        stats: statsRes.success ? (statsRes.data as SessionStatsSnapshot["stats"]) : null,
        live: true,
        stateError: stateRes.success ? null : String(stateRes.error ?? "get_state failed"),
        statsError: statsRes.success ? null : String(statsRes.error ?? "stats failed"),
      };
    },

    subscribe,
    subscribeRaw,
  };
}
