import { control } from "@/lib/control";
import { mapControlError, ok, readJson } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const body = await readJson<{ command?: string }>(req);
    // Direct `bash` RPC: output streams as bash_execution_update events and
    // lands in LLM context on the next prompt.
    return ok(await control.sessions.bash(id, body.command ?? ""));
  } catch (err) {
    return mapControlError(err);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    return ok(await control.sessions.abortBash(id));
  } catch (err) {
    return mapControlError(err);
  }
}
