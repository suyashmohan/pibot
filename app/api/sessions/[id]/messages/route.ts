import { control } from "@/lib/control";
import { mapControlError, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Transcript for a session. A live pi process is synced into the cache;
 * a sleeping session is served straight from the cache without spawning
 * (`live: false`).
 */
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    return ok(await control.sessions.getMessages(id));
  } catch (err) {
    return mapControlError(err);
  }
}
