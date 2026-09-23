import { control } from "@/lib/control";
import { mapControlError, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Live pi subprocesses, with the session/project each one serves. */
export async function GET() {
  try {
    return ok(await control.processes.list());
  } catch (err) {
    return mapControlError(err);
  }
}
