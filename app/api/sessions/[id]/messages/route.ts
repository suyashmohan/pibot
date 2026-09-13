import { getLiveClient, readCachedMessages, syncMessagesFromPi } from "@/lib/pi/manager";
import { fail, ok, toErrorMessage } from "@/lib/api";

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
    if (getLiveClient(id)) {
      return ok({ messages: await syncMessagesFromPi(id), live: true });
    }
    return ok({ messages: await readCachedMessages(id), live: false });
  } catch (err) {
    try {
      return ok({ messages: await readCachedMessages(id), live: false, liveError: toErrorMessage(err) });
    } catch (err2) {
      return fail(toErrorMessage(err2), 500);
    }
  }
}
