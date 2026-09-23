import { control } from "@/lib/control";
import { mapControlError, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * State + token/cost stats for a session. Read-only: a sleeping session
 * reports `live: false` with null state instead of spawning pi — the process
 * starts only when the user focuses the composer (`POST /start`).
 */
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    return ok(await control.sessions.getStats(id));
  } catch (err) {
    return mapControlError(err);
  }
}
