import { control } from "@/lib/control";
import { mapControlError, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Spawns the shared metadata process (unused by the UI).
    return ok(await control.health.listGlobalModels());
  } catch (err) {
    return mapControlError(err);
  }
}
