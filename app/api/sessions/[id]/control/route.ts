import { control } from "@/lib/control";
import { mapControlError, ok, readJson } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Generic agent controls: abort, clear_queue, compact, set_auto_compaction,
 * set_auto_retry, abort_retry, set_steering_mode, set_follow_up_mode,
 * get_commands, get_fork_messages, get_last_assistant_text, export_html.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const body = await readJson<{ action?: string } & Record<string, unknown>>(req);
    return ok(await control.sessions.control(id, { ...body, action: String(body.action ?? "") }));
  } catch (err) {
    return mapControlError(err);
  }
}
