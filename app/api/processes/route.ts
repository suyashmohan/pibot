import { fail, ok, toErrorMessage } from "@/lib/api";
import { listRunningProcesses, processLimits } from "@/lib/pi/manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Live pi subprocesses, with the session/project each one serves. */
export async function GET() {
  try {
    return ok({
      processes: await listRunningProcesses(),
      limits: processLimits(),
    });
  } catch (err) {
    return fail(toErrorMessage(err), 500);
  }
}
