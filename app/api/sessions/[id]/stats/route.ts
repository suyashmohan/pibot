import { getLiveClient } from "@/lib/pi/manager";
import { fail, ok, toErrorMessage } from "@/lib/api";

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
    const client = getLiveClient(id);
    if (!client) return ok({ state: null, stats: null, live: false });

    const [stateRes, statsRes] = await Promise.all([
      client.send({ type: "get_state" }),
      client.send({ type: "get_session_stats" }),
    ]);
    return ok({
      state: stateRes.success ? stateRes.data : null,
      stats: statsRes.success ? statsRes.data : null,
      live: true,
      stateError: stateRes.success ? null : String(stateRes.error ?? "get_state failed"),
      statsError: statsRes.success ? null : String(statsRes.error ?? "stats failed"),
    });
  } catch (err) {
    return fail(toErrorMessage(err), 500);
  }
}
