import { Emitter } from "../emitter";
import { extraArgs, piBinary, rpcTimeoutMs } from "./env";
import { assertBunRuntime } from "../runtime";
import type { PiEvent, RpcCommand, RpcResponse } from "./types";

export interface SpawnOptions {
  cwd: string;
  sessionFile?: string | null;
  sessionId?: string | null;
  name?: string | null;
  provider?: string | null;
  model?: string | null;
  extraCliArgs?: string[];
}

interface Pending {
  resolve: (r: RpcResponse) => void;
  reject: (e: Error) => void;
  command: string;
  timer: ReturnType<typeof setTimeout>;
}

let clientSeq = 0;

/**
 * Bun-native JSONL client for `pi --mode rpc` (Bun.spawn + TextDecoder).
 *
 * Framing follows pi's spec strictly: split stdout on LF only,
 * strip a single trailing CR, JSON.parse each line.
 */
export class PiRpcClient extends Emitter {
  readonly clientId = `rpc-${++clientSeq}`;
  private proc: Bun.Subprocess | null = null;
  private buffer = "";
  private pending = new Map<string, Pending>();
  private reqSeq = 0;
  private _alive = false;
  private lastError: string | null = null;
  private readers: ReadableStreamDefaultReader<Uint8Array>[] = [];

  constructor(
    readonly cwd: string,
    readonly spawnArgs: string[],
  ) {
    super();
  }

  static spawn(opts: SpawnOptions): PiRpcClient {
    const args = ["--mode", "rpc", ...extraArgs(), ...(opts.extraCliArgs ?? [])];
    if (opts.name) args.push("--name", opts.name);
    if (opts.provider) args.push("--provider", opts.provider);
    if (opts.model) args.push("--model", opts.model);
    if (opts.sessionFile) args.push("--session", opts.sessionFile);
    else if (opts.sessionId) args.push("--session", opts.sessionId);

    const client = new PiRpcClient(opts.cwd, args);
    client.start();
    return client;
  }

  get alive(): boolean {
    return this._alive && this.proc != null && this.proc.exitCode == null;
  }

  get stderrTail(): string | null {
    return this.lastError;
  }

  private start() {
    assertBunRuntime("pi-rpc");
    let proc: Bun.Subprocess;
    try {
      proc = Bun.spawn([piBinary(), ...this.spawnArgs], {
        cwd: this.cwd,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (err) {
      // Bad binary or bad cwd — Bun.spawn throws synchronously.
      this._alive = false;
      this.lastError = err instanceof Error ? err.message : String(err);
      queueMicrotask(() => {
        this.emit("exit", { code: null, error: this.lastError });
        this.failAllPending(new Error(`pi process failed to start: ${this.lastError}`));
      });
      return;
    }
    this.proc = proc;
    this._alive = true;

    void this.pump(proc.stdout as unknown as ReadableStream<Uint8Array> | null, (text) =>
      this.onStdoutChunk(text),
    );
    void this.pump(proc.stderr as unknown as ReadableStream<Uint8Array> | null, (text) => {
      this.lastError = ((this.lastError ?? "") + text).slice(-4000);
      // Surface stderr for debugging; not part of the protocol.
      this.emit("stderr", text);
    });
    void proc.exited.then(
      (code) => this.onExit(code),
      (err) => this.onExit(null, err),
    );
  }

  private async pump(
    stream: ReadableStream<Uint8Array> | null | undefined,
    onText: (text: string) => void,
  ): Promise<void> {
    if (!stream || typeof stream.getReader !== "function") return;
    const reader = stream.getReader();
    this.readers.push(reader);
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value?.length) onText(decoder.decode(value, { stream: true }));
      }
      const tail = decoder.decode();
      if (tail) onText(tail);
    } catch {
      /* stream closed on dispose */
    } finally {
      this.readers = this.readers.filter((r) => r !== reader);
      try {
        reader.releaseLock();
      } catch {
        /* noop */
      }
    }
  }

  private onStdoutChunk(text: string) {
    this.buffer += text;
    while (true) {
      const idx = this.buffer.indexOf("\n");
      if (idx === -1) break;
      let line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.trim()) continue;
      this.onLine(line);
    }
  }

  private onLine(line: string) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.emit("protocol_error", { line: line.slice(0, 2000) });
      return;
    }
    const type = msg.type as string | undefined;

    if (type === "response") {
      const res = msg as unknown as RpcResponse;
      const pending = res.id != null ? this.pending.get(String(res.id)) : undefined;
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(String(res.id));
        pending.resolve(res);
      } else if (this.pending.size === 1) {
        // Pi echoes `id` only when provided; older responses may omit it.
        // Fall back to the single in-flight request.
        const onlyId = Array.from(this.pending.keys())[0];
        const only = Array.from(this.pending.values())[0];
        clearTimeout(only.timer);
        this.pending.delete(onlyId);
        only.resolve(res);
      } else {
        this.emit("unmatched_response", res);
      }
      return;
    }

    // Everything else (agent events, extension_ui_request, ...) is an event.
    this.emit("event", msg as PiEvent);
  }

  private onExit(code: number | null, err?: unknown) {
    if (!this._alive && this.proc == null) return;
    this._alive = false;
    if (err && !this.lastError) {
      this.lastError = err instanceof Error ? err.message : String(err);
    }
    this.emit("exit", { code, stderr: this.lastError });
    this.failAllPending(
      new Error(`pi process exited (code=${code ?? "?"}). ${this.lastError ?? ""}`.trim()),
    );
  }

  send(cmd: RpcCommand, opts?: { timeoutMs?: number }): Promise<RpcResponse> {
    if (!this.alive) {
      return Promise.reject(new Error("pi process is not running"));
    }
    const id = cmd.id != null ? String(cmd.id) : `web-${this.clientId}-${++this.reqSeq}`;
    const payload = JSON.stringify({ ...cmd, id }) + "\n";
    const timeoutMs = opts?.timeoutMs ?? rpcTimeoutMs();

    return new Promise<RpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`pi RPC timed out (${cmd.type}, ${timeoutMs}ms)`));
      }, timeoutMs);
      // Unref so idle requests never hold the server open.
      (timer as unknown as { unref?: () => void }).unref?.();
      this.pending.set(id, { resolve, reject, command: cmd.type, timer });
      try {
        this.writeStdin(payload);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private writeStdin(payload: string): void {
    const sink = this.proc?.stdin as unknown as {
      write(chunk: string): number;
      flush(): void;
    } | null;
    if (!this.proc || this.proc.exitCode != null || !sink || typeof sink === "number") {
      throw new Error("pi process is not running");
    }
    sink.write(payload);
    sink.flush();
  }

  /** Fire-and-forget write (used for extension_ui_response which expects no response). */
  writeRaw(obj: Record<string, unknown>): void {
    if (!this.alive) {
      throw new Error("pi process is not running");
    }
    this.writeStdin(JSON.stringify(obj) + "\n");
  }

  onEvent(listener: (ev: PiEvent) => void): () => void {
    return this.on("event", listener);
  }

  private failAllPending(err: Error) {
    for (const p of Array.from(this.pending.values())) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  dispose() {
    this.failAllPending(new Error("pi client disposed"));
    for (const r of this.readers) {
      try {
        void r.cancel();
      } catch {
        /* noop */
      }
    }
    this.readers = [];
    this.removeAllListeners();
    const sink = this.proc?.stdin as unknown as {
      end(): void;
      close(): void;
    } | null;
    try {
      sink?.end();
    } catch {
      try {
        sink?.close();
      } catch {
        /* noop */
      }
    }
    try {
      if (this.proc && this.proc.exitCode == null) this.proc.kill("SIGTERM");
    } catch {
      /* noop */
    }
    this.proc = null;
    this._alive = false;
    if (this.buffer.trim()) {
      const rest = this.buffer.trim();
      this.buffer = "";
      try {
        this.onLine(rest);
      } catch {
        /* noop */
      }
    } else {
      this.buffer = "";
    }
  }
}
