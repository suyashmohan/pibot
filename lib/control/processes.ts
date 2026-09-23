/** Process inventory + manual stop. */

import type { ControlDeps } from "./plane";
import type { CallContext, ProcessLimits, RunningProcessInfo } from "./types";
import { UI_CTX } from "./types";
import type { MutatingKind } from "./policy";

export interface ProcessService {
  list(): Promise<{ processes: RunningProcessInfo[]; limits: ProcessLimits }>;
  stop(
    sessionId: string | null,
    opts?: { force?: boolean },
    ctx?: CallContext,
  ): Promise<{ stopped: boolean }>;
}

export function createProcessService(deps: ControlDeps): ProcessService {
  const guard = (ctx: CallContext, target: string, kind: MutatingKind) => {
    if (ctx.source === "supervisor") deps.policy.assertAllowed(ctx, target, kind);
  };

  return {
    async list() {
      return {
        processes: await deps.host.listRunning(),
        limits: deps.host.processLimits(),
      };
    },

    async stop(sessionId, opts = {}, ctx = UI_CTX) {
      if (sessionId !== null) guard(ctx, sessionId, "lifecycle");
      return { stopped: deps.host.stop(sessionId, opts) };
    },
  };
}
