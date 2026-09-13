import { readJson, ok, toErrorMessage, fail } from "@/lib/api";
import { stopProcess } from "@/lib/pi/manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { id?: unknown; force?: unknown };

/**
 * Stop a live pi process on request.
 * Body: `{ id: string | null, force?: boolean }` — `id: null` targets the
 * shared server metadata process; `force` escalates SIGTERM to SIGKILL.
 */
export async function POST(req: Request) {
  try {
    const body = await readJson<Body>(req);
    const raw = body.id;
    if (raw !== null && typeof raw !== "string") {
      return fail("id must be a session id or null (server process)");
    }
    const force = body.force === true;
    const stopped = stopProcess(raw, { force });
    return ok({ stopped });
  } catch (err) {
    return fail(toErrorMessage(err), 500);
  }
}
