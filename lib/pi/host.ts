/**
 * Pi transport host — the **only** module that writes JSONL command names.
 *
 * `lib/control/**` talks domain methods (`prompt`, `abort`, `fork`, …); it
 * never constructs an `RpcCommand`. `sendRaw` exists solely for the
 * `POST /control` catch-all escape hatch (`SessionService.control()`).
 */

import {
  destroyClient,
  ensureClient,
  ensureGlobalClient,
  fetchAndPersist,
  getLiveClient,
  listRunningProcesses,
  processLimits,
  readCachedMessages,
  stopProcess,
  subscribe as managerSubscribe,
} from "./manager";
import { rpcTimeoutMs } from "./env";
import type { PiRpcClient } from "./rpc-client";
import type { PiEvent, RpcCommand, RpcResponse } from "./types";
import type {
  AgentMessage,
  PromptInput,
  ProcessLimits,
  RunningProcessInfo,
  Unsubscribe,
} from "../control/types";

export interface AgentSession {
  readonly alive: boolean;
  readonly pid: number | null;
  /** Maps omitted/`prompt` → `prompt`; `steer`; `follow_up`. */
  prompt(input: PromptInput): Promise<RpcResponse>;
  abort(): Promise<RpcResponse>; // timeoutMs 60_000
  compact(opts?: { customInstructions?: string }): Promise<RpcResponse>; // 300_000
  bash(command: string): Promise<RpcResponse>; // `bash-${Date.now()}`, 300_000
  abortBash(): Promise<RpcResponse>;
  getState(): Promise<RpcResponse>;
  getSessionStats(): Promise<RpcResponse>;
  getMessages(): Promise<RpcResponse>;
  getAvailableModels(): Promise<RpcResponse>;
  getAvailableThinkingLevels(): Promise<RpcResponse>;
  setModel(input: { provider?: string; modelId: string }): Promise<RpcResponse>;
  setThinkingLevel(level: string): Promise<RpcResponse>;
  setSessionName(name: string): Promise<RpcResponse>;
  getTree(): Promise<RpcResponse>;
  newSession(opts?: { parentSession?: string }): Promise<RpcResponse>;
  switchSession(sessionPath: string): Promise<RpcResponse>;
  fork(entryId: string): Promise<RpcResponse>;
  clone(): Promise<RpcResponse>;
  /** Fire-and-forget `extension_ui_response` (writeRaw; expects no response). */
  writeExtensionUi(payload: Record<string, unknown>): void;
  /**
   * Catch-all for `SessionService.control()` only.
   * Control `prompt` / `abort` / `compact` / `bash` / `lifecycle` must not use this.
   */
  sendRaw(cmd: RpcCommand, opts?: { timeoutMs?: number }): Promise<RpcResponse>;
}

class PiAgentSession implements AgentSession {
  constructor(readonly client: PiRpcClient) {}

  get alive(): boolean {
    return this.client.alive;
  }

  get pid(): number | null {
    return this.client.pid;
  }

  private send(cmd: RpcCommand, opts?: { timeoutMs?: number }): Promise<RpcResponse> {
    return this.client.send(cmd, opts);
  }

  prompt(input: PromptInput): Promise<RpcResponse> {
    const message = input.message ?? "";
    const images = input.images?.length ? { images: input.images } : {};
    const mode = input.mode ?? "prompt";
    if (mode === "steer") {
      return this.send({ type: "steer", message, ...images });
    }
    if (mode === "follow_up") {
      return this.send({ type: "follow_up", message, ...images });
    }
    return this.send({
      type: "prompt",
      message,
      ...images,
      ...(input.streamingBehavior ? { streamingBehavior: input.streamingBehavior } : {}),
    });
  }

  abort(): Promise<RpcResponse> {
    return this.send({ type: "abort" }, { timeoutMs: 60_000 });
  }

  compact(opts: { customInstructions?: string } = {}): Promise<RpcResponse> {
    const custom = opts.customInstructions?.trim();
    return this.send(
      { type: "compact", ...(custom ? { customInstructions: custom } : {}) },
      { timeoutMs: 300_000 },
    );
  }

  bash(command: string): Promise<RpcResponse> {
    return this.send(
      { type: "bash", id: `bash-${Date.now()}`, command },
      { timeoutMs: 300_000 },
    );
  }

  abortBash(): Promise<RpcResponse> {
    return this.send({ type: "abort_bash" });
  }

  getState(): Promise<RpcResponse> {
    return this.send({ type: "get_state" });
  }

  getSessionStats(): Promise<RpcResponse> {
    return this.send({ type: "get_session_stats" });
  }

  getMessages(): Promise<RpcResponse> {
    return this.send({ type: "get_messages" });
  }

  getAvailableModels(): Promise<RpcResponse> {
    return this.send({ type: "get_available_models" });
  }

  getAvailableThinkingLevels(): Promise<RpcResponse> {
    return this.send({ type: "get_available_thinking_levels" });
  }

  setModel(input: { provider?: string; modelId: string }): Promise<RpcResponse> {
    return this.send({
      type: "set_model",
      ...(input.provider ? { provider: input.provider } : {}),
      modelId: input.modelId,
    });
  }

  setThinkingLevel(level: string): Promise<RpcResponse> {
    return this.send({ type: "set_thinking_level", level });
  }

  setSessionName(name: string): Promise<RpcResponse> {
    return this.send({ type: "set_session_name", name });
  }

  getTree(): Promise<RpcResponse> {
    return this.send({ type: "get_tree" });
  }

  newSession(opts: { parentSession?: string } = {}): Promise<RpcResponse> {
    return this.send({
      type: "new_session",
      ...(opts.parentSession ? { parentSession: opts.parentSession } : {}),
    });
  }

  switchSession(sessionPath: string): Promise<RpcResponse> {
    return this.send({ type: "switch_session", sessionPath });
  }

  fork(entryId: string): Promise<RpcResponse> {
    return this.send({ type: "fork", entryId });
  }

  clone(): Promise<RpcResponse> {
    return this.send({ type: "clone" });
  }

  writeExtensionUi(payload: Record<string, unknown>): void {
    this.client.writeRaw({ type: "extension_ui_response", ...payload });
  }

  sendRaw(cmd: RpcCommand, opts?: { timeoutMs?: number }): Promise<RpcResponse> {
    return this.send(cmd, opts ?? { timeoutMs: rpcTimeoutMs() });
  }
}

export interface AgentHost {
  ensure(id: string): Promise<AgentSession>;
  getLive(id: string): AgentSession | null;
  subscribeRaw(id: string, fn: (ev: PiEvent) => void): Unsubscribe;
  destroy(id: string): void;
  listRunning(): Promise<RunningProcessInfo[]>;
  stop(id: string | null, opts?: { force?: boolean }): boolean;
  processLimits(): ProcessLimits;
  ensureGlobal(): Promise<AgentSession>;
  /** Persist `get_messages` through the live client. Returns null if asleep — never ensure. */
  syncIfLive(id: string): Promise<AgentMessage[] | null>;
  readCachedMessages(id: string): Promise<AgentMessage[]>;
}

function wrap(client: PiRpcClient): AgentSession {
  return new PiAgentSession(client);
}

export function createPiAgentHost(): AgentHost {
  return {
    async ensure(id: string): Promise<AgentSession> {
      return wrap(await ensureClient(id));
    },
    getLive(id: string): AgentSession | null {
      const client = getLiveClient(id);
      return client ? wrap(client) : null;
    },
    subscribeRaw(id: string, fn: (ev: PiEvent) => void): Unsubscribe {
      return managerSubscribe(id, fn);
    },
    destroy(id: string): void {
      destroyClient(id);
    },
    listRunning(): Promise<RunningProcessInfo[]> {
      return listRunningProcesses();
    },
    stop(id: string | null, opts: { force?: boolean } = {}): boolean {
      return stopProcess(id, opts);
    },
    processLimits(): ProcessLimits {
      return processLimits();
    },
    async ensureGlobal(): Promise<AgentSession> {
      return wrap(await ensureGlobalClient());
    },
    async syncIfLive(id: string): Promise<AgentMessage[] | null> {
      const client = getLiveClient(id);
      if (!client) return null;
      return fetchAndPersist(client, id);
    },
    readCachedMessages(id: string): Promise<AgentMessage[]> {
      return readCachedMessages(id);
    },
  };
}
