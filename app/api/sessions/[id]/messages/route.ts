import { ensureClient, readCachedMessages, syncMessagesFromPi } from "@/lib/pi/manager";
import { fail, ok, toErrorMessage } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    try {
      const messages = await syncMessagesFromPi(id);
      return ok({ messages, live: true });
    } catch (err) {
      return ok({ messages: await readCachedMessages(id), live: false, liveError: toErrorMessage(err) });
    }
  } catch (err) {
    return fail(toErrorMessage(err), 500);
  }
}
