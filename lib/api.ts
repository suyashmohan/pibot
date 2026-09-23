import { NextResponse } from "next/server";
import { isControlError } from "@/lib/control/errors";

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

/**
 * Control-plane error → HTTP envelope. `ControlError.status` is explicit at the
 * throw site; anything else is today's generic 500.
 */
export function mapControlError(err: unknown): NextResponse {
  if (isControlError(err)) return fail(err.message, err.status, err.extra);
  return fail(toErrorMessage(err), 500);
}

export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}
