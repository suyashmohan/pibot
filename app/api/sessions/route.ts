import { control } from "@/lib/control";
import { mapControlError, ok, readJson } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return ok(await control.sessions.list());
  } catch (err) {
    return mapControlError(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = await readJson<{
      name?: string;
      cwd?: string;
      provider?: string;
      model?: string;
      thinkingLevel?: string;
    }>(req);
    return ok(await control.sessions.create(body), { status: 201 });
  } catch (err) {
    return mapControlError(err);
  }
}
