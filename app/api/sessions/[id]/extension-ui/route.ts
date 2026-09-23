import { control } from "@/lib/control";
import { mapControlError, ok, readJson } from "@/lib/api";

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
    return ok(
      await control.sessions.answerDialog(id, {
        id: body.id ?? "",
        value: body.value,
        confirmed: body.confirmed,
        cancelled: body.cancelled,
      }),
    );
  } catch (err) {
    return mapControlError(err);
  }
}
