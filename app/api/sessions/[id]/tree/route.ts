import { control } from "@/lib/control";
import { mapControlError, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    // Spawns (unused by the UI) — keep for the future supervisor surface.
    return ok(await control.sessions.getTree(id));
  } catch (err) {
    return mapControlError(err);
  }
}
