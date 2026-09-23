/**
 * Runtime session operations: start, prompt, abort, compact, bash, model,
 * lifecycle, dialogs, tree.
 *
 * Status codes are frozen to today's HTTP adapter behavior (locked by
 * `test/http-contract/**`): every `ensure`-path failure is a 500 by default,
 * steer/follow_up failures are always 409, and a default prompt only 409s when
 * the error text looks like a busy agent.
 */

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { sessions as sessionsTable } from "@/lib/db/schema";
import { exportTempPath } from "@/lib/export-html";
import { ControlError } from "./errors";
import type { MutatingKind } from "./policy";
import type { RpcResponse } from "@/lib/pi/types";
import type {
  CallContext,
  DialogAnswer,
  ModelListing,
  PromptInput,
  SessionRecord,
  Unsubscribe,
} from "./types";
import { UI_CTX } from "./types";
import type { ControlDeps } from "./plane";

/** The busy regex lifted verbatim from the old prompt route. */
const BUSY_RX = /streaming|already|busy|queue/i;

const READ_ONLY_CONTROL = [
  "get_commands",
  "get_fork_messages",
  "get_last_assistant_text",
];

export interface RuntimeOps {
  start(
    id: string,
    ctx?: CallContext,
  ): Promise<{ started: boolean; live: boolean }>;
  prompt(
    id: string,
    input: PromptInput,
    ctx?: CallContext,
  ): Promise<{ response: RpcResponse }>;
  abort(id: string, ctx?: CallContext): Promise<{ response: RpcResponse }>;
  compact(
    id: string,
    opts?: { customInstructions?: string },
    ctx?: CallContext,
  ): Promise<{ response: RpcResponse }>;
  bash(id: string, command: string, ctx?: CallContext): Promise<{ result: unknown }>;
  abortBash(id: string, ctx?: CallContext): Promise<{ response: RpcResponse }>;
  getModel(id: string, ctx?: CallContext): Promise<ModelListing>;
  setModel(
    id: string,
    input: { provider?: string; modelId: string; level?: string },
    ctx?: CallContext,
  ): Promise<{ response: RpcResponse; model?: unknown }>;
  setThinkingLevel(
    id: string,
    level: string,
    ctx?: CallContext,
  ): Promise<{ response: RpcResponse }>;
  control(
    id: string,
    body: { action: string } & Record<string, unknown>,
    ctx?: CallContext,
  ): Promise<{ response: RpcResponse | null; live?: boolean }>;
  lifecycle(
    id: string,
    body: { op: "new_session" | "switch_session" | "fork" | "clone" } &
      Record<string, unknown>,
    ctx?: CallContext,
  ): Promise<{ response: RpcResponse; clonedSession?: SessionRecord }>;
  answerDialog(
    id: string,
    body: DialogAnswer,
    ctx?: CallContext,
  ): Promise<{ sent: true }>;
  getTree(id: string, ctx?: CallContext): Promise<{ tree: unknown }>;
}

function responseError(res: RpcResponse, fallback: string): ControlError {
  return new ControlError("internal", String(res.error ?? fallback), { status: 500 });
}

export function createRuntimeOps(deps: ControlDeps): RuntimeOps {
  const { host, policy } = deps;

  function guard(ctx: CallContext, id: string, kind: MutatingKind): void {
    policy.assertAllowed(ctx, id, kind);
  }

  function mapPromptFailure(
    res: RpcResponse,
    mode: NonNullable<PromptInput["mode"]>,
  ): ControlError {
    if (mode === "steer") {
      return new ControlError("conflict", String(res.error ?? "steer failed"), {
        status: 409,
      });
    }
    if (mode === "follow_up") {
      return new ControlError("conflict", String(res.error ?? "follow_up failed"), {
        status: 409,
      });
    }
    const errText = String(res.error ?? "prompt rejected");
    // Agent busy without streamingBehavior -> 409 so the UI can offer queueing.
    const busy = BUSY_RX.test(errText);
    return new ControlError(busy ? "conflict" : "bad_request", errText, {
      status: busy ? 409 : 400,
    });
  }

  const ops: RuntimeOps = {
    async start(id, ctx = UI_CTX) {
      guard(ctx, id, "prompt");
      // `ensureClient` throws `Session not found` for a missing row; mapControlError
      // turns that into a 500, matching today's start route.
      const session = await host.ensure(id);
      return { started: true, live: session.alive };
    },

    async prompt(id, input, ctx = UI_CTX) {
      const message = input.message?.trim() ?? "";
      if (!message && !(input.images?.length)) {
        throw new ControlError("bad_request", "Message is required", { status: 400 });
      }
      guard(ctx, id, "prompt");
      // Never log message text (prompt bodies stay out of logs).
      console.log(`[control] prompt session=${id} mode=${input.mode ?? "prompt"}`);
      const session = await host.ensure(id);

      const send = () => session.prompt({ ...input, message });
      const mode: NonNullable<PromptInput["mode"]> = input.mode ?? "prompt";

      const supervised = ctx.source === "supervisor" && Boolean(ctx.fromSessionId);
      if (!supervised) {
        const res = await send();
        if (!res.success) throw mapPromptFailure(res, mode);
        return { response: res };
      }

      // Supervisor: listen-before-send. One turn emits message_end + turn_end +
      // agent_end + agent_settled, and a fast fake/real turn may settle in the
      // same stdout chunk as the RPC response — so the listener must exist
      // before the send and release at most once.
      let off: Unsubscribe = () => {};
      let releaseSlot: () => void = () => {};
      let done = false;
      const release = () => {
        if (done) return;
        done = true;
        releaseSlot();
        off();
      };
      off = host.subscribeRaw(id, (ev) => {
        if (ev.type === "agent_settled" || ev.type === "client_exit") release();
      });
      releaseSlot = policy.acquirePrompt(ctx);

      try {
        const res = await send();
        if (!res.success) {
          release();
          throw mapPromptFailure(res, mode);
        }
        // If settle already ran during the await, release() already ran.
        return { response: res };
      } catch (err) {
        release();
        throw err;
      }
    },

    async abort(id, ctx = UI_CTX) {
      guard(ctx, id, "bash");
      const session = await host.ensure(id);
      const res = await session.abort();
      if (!res.success) throw responseError(res, "abort failed");
      void host.syncIfLive(id).catch(() => {});
      return { response: res };
    },

    async compact(id, opts = {}, ctx = UI_CTX) {
      guard(ctx, id, "bash");
      const session = await host.ensure(id);
      const res = await session.compact(opts);
      if (!res.success) throw responseError(res, "compact failed");
      void host.syncIfLive(id).catch(() => {});
      return { response: res };
    },

    async bash(id, command, ctx = UI_CTX) {
      if (!command?.trim()) {
        throw new ControlError("bad_request", "command is required", { status: 400 });
      }
      guard(ctx, id, "bash");
      const session = await host.ensure(id);
      const res = await session.bash(command);
      if (!res.success) throw responseError(res, "bash failed");
      return { result: res.data };
    },

    async abortBash(id, ctx = UI_CTX) {
      guard(ctx, id, "bash");
      const session = await host.ensure(id);
      const res = await session.abortBash();
      if (!res.success) throw responseError(res, "abort_bash failed");
      return { response: res };
    },

    async getModel(id, ctx = UI_CTX) {
      guard(ctx, id, "prompt");
      // NB: today's GET /model spawns (ModelPicker `onOpen`). Do not "fix" it.
      const session = await host.ensure(id);
      const [modelsRes, stateRes] = await Promise.all([
        session.getAvailableModels(),
        session.getState(),
      ]);
      if (!modelsRes.success) {
        throw new ControlError(
          "internal",
          String(modelsRes.error ?? "failed to list models"),
          { status: 500 },
        );
      }
      let thinkingLevels: string[] | null = null;
      try {
        const lv = await session.getAvailableThinkingLevels();
        if (lv.success) thinkingLevels = (lv.data as { levels?: string[] })?.levels ?? null;
      } catch {
        /* ignore */
      }
      return {
        models: ((modelsRes.data as { models?: unknown })?.models ?? []) as ModelListing["models"],
        state: stateRes.data,
        thinkingLevels,
      };
    },

    async setModel(id, input, ctx = UI_CTX) {
      guard(ctx, id, "prompt");
      const session = await host.ensure(id);
      const db = await deps.db();

      if (input.level && !input.modelId) {
        const res = await session.setThinkingLevel(input.level);
        if (!res.success) {
          throw new ControlError(
            "bad_request",
            String(res.error ?? "set_thinking_level failed"),
            { status: 400 },
          );
        }
        db.update(sessionsTable)
          .set({ thinkingLevel: input.level, updatedAt: deps.now() })
          .where(eq(sessionsTable.id, id))
          .run();
        return { response: res };
      }

      if (!input.modelId) {
        throw new ControlError("bad_request", "modelId is required", { status: 400 });
      }
      const res = await session.setModel({
        provider: input.provider,
        modelId: input.modelId,
      });
      if (!res.success) {
        throw new ControlError("bad_request", String(res.error ?? "set_model failed"), {
          status: 400,
        });
      }
      db.update(sessionsTable)
        .set({
          provider: input.provider ?? null,
          modelId: input.modelId,
          ...(input.level ? { thinkingLevel: input.level } : {}),
          updatedAt: deps.now(),
        })
        .where(eq(sessionsTable.id, id))
        .run();
      return { response: res, model: res.data };
    },

    async setThinkingLevel(id, level, ctx = UI_CTX) {
      const out = await ops.setModel(id, { modelId: "", level }, ctx);
      return { response: out.response };
    },

    async control(id, body, ctx = UI_CTX) {
      const action = String(body.action ?? "");

      // Read-only introspection: a sleeping session must not spawn just to be
      // asked what it could do — the UI refetches after the composer starts it.
      if (READ_ONLY_CONTROL.includes(action)) {
        const live = host.getLive(id);
        if (!live) return { response: null, live: false };
        const res = await live.sendRaw({ type: action });
        if (!res.success) throw responseError(res, `${action} failed`);
        return { response: res, live: true };
      }

      guard(ctx, id, "bash");
      const session = await host.ensure(id);

      switch (action) {
        case "abort": {
          const { response } = await ops.abort(id, ctx);
          return { response };
        }
        case "compact": {
          const { response } = await ops.compact(
            id,
            {
              customInstructions:
                typeof body.customInstructions === "string"
                  ? body.customInstructions
                  : undefined,
            },
            ctx,
          );
          return { response };
        }
        case "clear_queue": {
          const res = await session.sendRaw({ type: action });
          if (!res.success) throw responseError(res, "clear_queue failed");
          return { response: res };
        }
        case "set_auto_compaction":
        case "set_auto_retry":
        case "set_steering_mode":
        case "set_follow_up_mode": {
          const res = await session.sendRaw({ type: action, ...body, action: undefined });
          if (!res.success) throw responseError(res, `${action} failed`);
          return { response: res };
        }
        case "abort_retry": {
          const res = await session.sendRaw({ type: action });
          if (!res.success) throw responseError(res, `${action} failed`);
          return { response: res, live: true };
        }
        case "export_html": {
          // pi defaults to `${cwd}/pi-session-…_….html`; stage in the temp
          // dir instead so an export never pollutes the user's project. The
          // browser then downloads it from GET /api/sessions/[id]/export.
          const outputPath =
            typeof body.outputPath === "string" && body.outputPath
              ? body.outputPath
              : exportTempPath(id);
          const res = await session.sendRaw({
            type: "export_html",
            outputPath,
          });
          if (!res.success) throw responseError(res, "export failed");
          return { response: res };
        }
        default:
          throw new ControlError(
            "bad_request",
            `Unknown action: ${action || "(missing)"}`,
            { status: 400 },
          );
      }
    },

    async lifecycle(id, body, ctx = UI_CTX) {
      guard(ctx, id, "lifecycle");
      const session = await host.ensure(id);
      const db = await deps.db();
      const op = String(body.op ?? "");

      switch (op) {
        case "new_session": {
          const res = await session.newSession({
            parentSession:
              typeof body.parentSession === "string" ? body.parentSession : undefined,
          });
          if (!res.success) throw responseError(res, "new_session failed");
          // Refresh pi ids + clear local message cache (fresh conversation).
          try {
            const st = await session.getState();
            if (st.success) {
              const d = (st.data ?? {}) as Record<string, unknown>;
              db.update(sessionsTable)
                .set({
                  piSessionId: typeof d.sessionId === "string" ? d.sessionId : null,
                  piSessionFile: typeof d.sessionFile === "string" ? d.sessionFile : null,
                  // Fresh conversation: the previous turn's timing no longer
                  // describes anything on screen.
                  lastTurnMs: null,
                  updatedAt: deps.now(),
                })
                .where(eq(sessionsTable.id, id))
                .run();
            }
          } catch {
            /* ignore */
          }
          void host.syncIfLive(id).catch(() => {});
          return { response: res };
        }

        case "switch_session": {
          if (typeof body.sessionPath !== "string" || !body.sessionPath) {
            throw new ControlError("bad_request", "sessionPath is required", {
              status: 400,
            });
          }
          const res = await session.switchSession(body.sessionPath);
          if (!res.success) throw responseError(res, "switch_session failed");
          void host.syncIfLive(id).catch(() => {});
          return { response: res };
        }

        case "fork": {
          if (typeof body.entryId !== "string" || !body.entryId) {
            throw new ControlError("bad_request", "entryId is required", { status: 400 });
          }
          const res = await session.fork(body.entryId);
          if (!res.success) throw responseError(res, "fork failed");
          void host.syncIfLive(id).catch(() => {});
          return { response: res };
        }

        case "clone": {
          // Clone duplicates the branch into a *new pi session file* inside the
          // same RPC process. We surface it as a new web session row so the
          // sidebar keeps a 1:1 mapping of web session -> visible conversation.
          const res = await session.clone();
          if (!res.success) throw responseError(res, "clone failed");
          try {
            const st = await session.getState();
            const d = (st.success ? (st.data as Record<string, unknown>) : {}) as Record<
              string,
              unknown
            >;
            const piFile = typeof d.sessionFile === "string" ? d.sessionFile : null;
            const piSid = typeof d.sessionId === "string" ? d.sessionId : null;
            const src = db
              .select()
              .from(sessionsTable)
              .where(eq(sessionsTable.id, id))
              .get();
            if (src && piFile && piFile !== src.piSessionFile) {
              const newId = nanoid(12);
              const now = deps.now();
              db.insert(sessionsTable)
                .values({
                  id: newId,
                  name: `${src.name} (clone)`,
                  cwd: src.cwd,
                  provider: src.provider,
                  modelId: src.modelId,
                  thinkingLevel: src.thinkingLevel,
                  piSessionId: piSid,
                  piSessionFile: piFile,
                  createdAt: now,
                  updatedAt: now,
                })
                .run();
              // Point the old web session back at its original file.
              if (src.piSessionFile) {
                try {
                  await session.switchSession(src.piSessionFile);
                } catch {
                  /* ignore */
                }
              }
              host.destroy(newId);
              const created = db
                .select()
                .from(sessionsTable)
                .where(eq(sessionsTable.id, newId))
                .get();
              return { response: res, clonedSession: created };
            }
          } catch {
            /* fall through */
          }
          void host.syncIfLive(id).catch(() => {});
          return { response: res };
        }

        default:
          throw new ControlError("bad_request", `Unknown op: ${op || "(missing)"}`, {
            status: 400,
          });
      }
    },

    async answerDialog(id, body, ctx = UI_CTX) {
      guard(ctx, id, "prompt");
      if (!body.id) {
        throw new ControlError("bad_request", "Dialog id is required", { status: 400 });
      }
      const session = await host.ensure(id);
      const payload: Record<string, unknown> = { id: body.id };
      if (body.cancelled) payload.cancelled = true;
      else if (typeof body.confirmed === "boolean") payload.confirmed = body.confirmed;
      else if (typeof body.value === "string") payload.value = body.value;
      else {
        throw new ControlError(
          "bad_request",
          "Provide value, confirmed, or cancelled",
          { status: 400 },
        );
      }
      session.writeExtensionUi(payload);
      return { sent: true };
    },

    async getTree(id, ctx = UI_CTX) {
      guard(ctx, id, "prompt");
      const session = await host.ensure(id);
      const res = await session.getTree();
      if (!res.success) throw responseError(res, "get_tree failed");
      return { tree: res.data };
    },
  };

  return ops;
}
