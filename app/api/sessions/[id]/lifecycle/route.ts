import { control } from "@/lib/control";
import { mapControlError, ok, readJson } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Session lifecycle ops: new_session, switch_session, fork, clone. */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const body = await readJson<Record<string, unknown>>(req);
    return ok(
      await control.sessions.lifecycle(id, {
        ...body,
        op: String(body.op ?? "") as "new_session" | "switch_session" | "fork" | "clone",
      }),
    );
  } catch (err) {
    return mapControlError(err);
  }
}
