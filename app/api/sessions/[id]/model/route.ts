import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { sessions as sessionsTable } from "@/lib/db/schema";
import { ensureClient } from "@/lib/pi/manager";
import { fail, ok, readJson, toErrorMessage } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const client = await ensureClient(id);
    const [modelsRes, stateRes] = await Promise.all([
      client.send({ type: "get_available_models" }),
      client.send({ type: "get_state" }),
    ]);
    if (!modelsRes.success) return fail(String(modelsRes.error ?? "failed to list models"), 500);
    let thinkingLevels: string[] | null = null;
    try {
      const lv = await client.send({ type: "get_available_thinking_levels" });
      if (lv.success) thinkingLevels = (lv.data as { levels?: string[] })?.levels ?? null;
    } catch {
      /* ignore */
    }
    return ok({ models: (modelsRes.data as { models?: unknown })?.models ?? [], state: stateRes.data, thinkingLevels });
  } catch (err) {
    return fail(toErrorMessage(err), 500);
  }
}

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const body = await readJson<{ provider?: string; modelId?: string; level?: string }>(req);
    const client = await ensureClient(id);

    if (body.level && !body.modelId) {
      const res = await client.send({ type: "set_thinking_level", level: body.level });
      if (!res.success) return fail(String(res.error ?? "set_thinking_level failed"), 400);
      (await getDb()).update(sessionsTable).set({ thinkingLevel: body.level, updatedAt: Date.now() }).where(eq(sessionsTable.id, id)).run();
      return ok({ response: res });
    }

    if (!body.modelId) return fail("modelId is required", 400);
    const res = await client.send({
      type: "set_model",
      ...(body.provider ? { provider: body.provider } : {}),
      modelId: body.modelId,
    });
    if (!res.success) return fail(String(res.error ?? "set_model failed"), 400);
    (await getDb())
      .update(sessionsTable)
      .set({
        provider: body.provider ?? null,
        modelId: body.modelId,
        ...(body.level ? { thinkingLevel: body.level } : {}),
        updatedAt: Date.now(),
      })
      .where(eq(sessionsTable.id, id))
      .run();
    return ok({ response: res, model: res.data });
  } catch (err) {
    return fail(toErrorMessage(err), 500);
  }
}
