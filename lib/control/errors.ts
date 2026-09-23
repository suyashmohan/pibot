/**
 * Control-plane error type.
 *
 * Errors are **thrown**, never returned as `{ ok: false }` — that envelope is
 * HTTP-only. `status` is explicit at the throw site and is never inferred from
 * `code`: today "Session not found" is a 404 on read paths and a 500 on
 * `ensureClient` paths, and the extract must not silently "fix" that.
 */

export type ControlCode =
  | "not_found"
  | "bad_request"
  | "conflict" // prompt 409 (busy regex, or any steer/follow_up failure)
  | "internal"
  | "forbidden"; // policy (self-prompt, cycle)

export type ControlStatus = 400 | 403 | 404 | 409 | 500;

export class ControlError extends Error {
  readonly status: ControlStatus;
  readonly code: ControlCode;
  readonly extra?: Record<string, unknown>;

  constructor(
    code: ControlCode,
    message: string,
    opts: { status: ControlStatus; extra?: Record<string, unknown> },
  ) {
    super(message);
    this.name = "ControlError";
    this.code = code;
    this.status = opts.status;
    this.extra = opts.extra;
  }

  /** Convenience for the common `ensureClient` "missing session → 500" path. */
  static sessionNotFound(status: ControlStatus = 500): ControlError {
    return new ControlError("not_found", "Session not found", { status });
  }
}

export function isControlError(err: unknown): err is ControlError {
  return err instanceof ControlError;
}
