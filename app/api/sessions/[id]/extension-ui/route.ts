import { ensureClient } from "@/lib/pi/manager";
import { fail, ok, readJson, toErrorMessage } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Answer a pending extension UI dialog (select/confirm/input/editor). */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const body = await readJson<{
      id?: string;
      value?: string;
      confirmed?: boolean;
      cancelled?: boolean;
    }>(req);
    if (!body.id) return fail("Dialog id is required", 400);
    const client = await ensureClient(id);
    const payload: Record<string, unknown> = { type: "extension_ui_response", id: body.id };
    if (body.cancelled) payload.cancelled = true;
    else if (typeof body.confirmed === "boolean") payload.confirmed = body.confirmed;
    else if (typeof body.value === "string") payload.value = body.value;
    else return fail("Provide value, confirmed, or cancelled", 400);
    client.writeRaw(payload);
    return ok({ sent: true });
  } catch (err) {
    return fail(toErrorMessage(err), 500);
  }
}
