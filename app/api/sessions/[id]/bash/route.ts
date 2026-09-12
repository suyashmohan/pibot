import { ensureClient } from "@/lib/pi/manager";
import { fail, ok, readJson, toErrorMessage } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const body = await readJson<{ command?: string }>(req);
    if (!body.command?.trim()) return fail("command is required", 400);
    const client = await ensureClient(id);
    // Direct `bash` RPC: output streams as bash_execution_update events and
    // lands in LLM context on the next prompt.
    const res = await client.send(
      { type: "bash", id: `bash-${Date.now()}`, command: body.command },
      { timeoutMs: 300_000 },
    );
    if (!res.success) return fail(String(res.error ?? "bash failed"), 500);
    return ok({ result: res.data });
  } catch (err) {
    return fail(toErrorMessage(err), 500);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const client = await ensureClient(id);
    const res = await client.send({ type: "abort_bash" });
    if (!res.success) return fail(String(res.error ?? "abort_bash failed"), 500);
    return ok({ response: res });
  } catch (err) {
    return fail(toErrorMessage(err), 500);
  }
}
