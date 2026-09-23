import { control } from "@/lib/control";
import { mapControlError, ok, readJson } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    // NB: today's GET /model spawns (ModelPicker `onOpen`). Do not "fix" it.
    return ok(await control.sessions.getModel(id));
  } catch (err) {
    return mapControlError(err);
  }
}

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const body = await readJson<{ provider?: string; modelId?: string; level?: string }>(req);
    return ok(
      await control.sessions.setModel(id, {
        provider: body.provider,
        modelId: body.modelId ?? "",
        level: body.level,
      }),
    );
  } catch (err) {
    return mapControlError(err);
  }
}
