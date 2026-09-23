import { control } from "@/lib/control";
import { fail, mapControlError, ok, readJson } from "@/lib/api";

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
    return ok(await control.processes.stop(raw as string | null, { force }));
  } catch (err) {
    return mapControlError(err);
  }
}
