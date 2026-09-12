import { ensureClient } from "@/lib/pi/manager";
import { fail, ok, toErrorMessage } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const client = await ensureClient(id);
    const res = await client.send({ type: "get_tree" });
    if (!res.success) return fail(String(res.error ?? "get_tree failed"), 500);
    return ok({ tree: res.data });
  } catch (err) {
    return fail(toErrorMessage(err), 500);
  }
}
