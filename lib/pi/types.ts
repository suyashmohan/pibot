/**
 * Pi JSONL transport types.
 *
 * Transport-only: `RpcCommand` / `RpcResponse` / `PiEvent`. Transcript and
 * domain DTOs live in `@/lib/control/types` (importable from client code).
 */

export type RpcCommand = Record<string, unknown> & { type: string; id?: string };

export interface RpcResponse {
  id?: string;
  type: "response";
  command: string;
  success: boolean;
  error?: string;
  data?: unknown;
}

export type PiEvent = Record<string, unknown> & { type: string; id?: string };
