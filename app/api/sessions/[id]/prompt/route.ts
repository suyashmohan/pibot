import { ensureClient } from "@/lib/pi/manager";
import { fail, ok, readJson, toErrorMessage } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

interface PromptBody {
  message?: string;
  images?: Array<{ type: "image"; data: string; mimeType: string }>;
  mode?: "prompt" | "steer" | "follow_up";
  streamingBehavior?: "steer" | "followUp";
}

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const body = await readJson<PromptBody>(req);
    const message = body.message?.trim() ?? "";
    if (!message && !(body.images?.length)) {
      return fail("Message is required", 400);
    }
    const client = await ensureClient(id);
    const mode = body.mode ?? "prompt";
    if (mode === "steer") {
      const res = await client.send({
        type: "steer",
        message,
        ...(body.images?.length ? { images: body.images } : {}),
      });
      if (!res.success) return fail(String(res.error ?? "steer failed"), 409);
      return ok({ response: res });
    }
    if (mode === "follow_up") {
      const res = await client.send({
        type: "follow_up",
        message,
        ...(body.images?.length ? { images: body.images } : {}),
      });
      if (!res.success) return fail(String(res.error ?? "follow_up failed"), 409);
      return ok({ response: res });
    }
    const res = await client.send({
      type: "prompt",
      message,
      ...(body.images?.length ? { images: body.images } : {}),
      ...(body.streamingBehavior ? { streamingBehavior: body.streamingBehavior } : {}),
    });
    if (!res.success) {
      const errText = String(res.error ?? "prompt rejected");
      // Agent busy without streamingBehavior -> 409 so the UI can offer queueing.
      const busy = /streaming|already|busy|queue/i.test(errText);
      return fail(errText, busy ? 409 : 400);
    }
    return ok({ response: res });
  } catch (err) {
    return fail(toErrorMessage(err), 500);
  }
}
