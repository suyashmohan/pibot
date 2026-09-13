import { getDb } from "@/lib/db";
import { sessions as sessionsTable } from "@/lib/db/schema";
import { subscribe } from "@/lib/pi/manager";
import { fail } from "@/lib/api";
import { eq } from "drizzle-orm";
import type { PiEvent } from "@/lib/pi/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * SSE stream of pi RPC events for one web session.
 *
 * Attaching never spawns pi: the subscription registry creates a placeholder
 * entry (events fan out once a process exists) so an old session can be
 * viewed without starting a process. The stream also stays valid across
 * respawns — subscribers survive idle reaping and explicit stops.
 */
export async function GET(req: Request, { params }: Params) {
  const { id } = await params;

  const row = (await getDb()).select().from(sessionsTable).where(eq(sessionsTable.id, id)).get();
  if (!row) return fail("Session not found", 404);

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* closed */
        }
      };

      send("ready", { sessionId: id, ts: Date.now() });
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          /* closed */
        }
      }, 25_000);

      const off = subscribe(id, (ev: PiEvent) => {
        send(ev.type ?? "message", ev);
      });

      const abort = () => {
        clearInterval(heartbeat);
        off();
        try {
          controller.close();
        } catch {
          /* noop */
        }
      };
      req.signal.addEventListener("abort", abort, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
