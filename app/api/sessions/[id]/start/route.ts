import { ensureClient } from "@/lib/pi/manager";
import { fail, ok, toErrorMessage } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Spawn (or reuse) the pi process for a session on explicit user intent.
 *
 * Reading an old session deliberately does **not** start pi — the composer
 * calls this when it gains focus. Idempotent: concurrent/repeat calls share
 * the one spawn via the manager's in-flight map.
 */
export async function POST(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const client = await ensureClient(id);
    return ok({ started: true, live: client.alive });
  } catch (err) {
    return fail(toErrorMessage(err), 500);
  }
}
