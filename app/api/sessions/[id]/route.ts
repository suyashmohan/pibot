import { control } from "@/lib/control";
import { mapControlError, ok, readJson } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Session detail. Read-only: when no pi process is attached the session is
 * served from the cache (`state`/`stats` null, `live: false`) — opening an
 * old session must not spawn pi. The composer triggers `POST /start`.
 */
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    return ok(await control.sessions.get(id));
  } catch (err) {
    return mapControlError(err);
  }
}

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const body = await readJson<{ name?: string }>(req);
    return ok(await control.sessions.rename(id, body.name ?? ""));
  } catch (err) {
    return mapControlError(err);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    return ok(await control.sessions.delete(id));
  } catch (err) {
    return mapControlError(err);
  }
}
