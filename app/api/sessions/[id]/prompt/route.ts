import { control } from "@/lib/control";
import { mapControlError, ok, readJson } from "@/lib/api";
import type { PromptInput } from "@/lib/control/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const body = await readJson<PromptInput>(req);
    return ok(await control.sessions.prompt(id, body));
  } catch (err) {
    return mapControlError(err);
  }
}
