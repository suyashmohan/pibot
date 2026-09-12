import { ensureGlobalClient } from "@/lib/pi/manager";
import { fail, ok, toErrorMessage } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const client = await ensureGlobalClient();
    const res = await client.send({ type: "get_available_models" });
    if (!res.success) return fail(String(res.error ?? "failed to list models"), 500);
    return ok({ models: (res.data as { models?: unknown })?.models ?? [] });
  } catch (err) {
    return fail(toErrorMessage(err), 500);
  }
}
