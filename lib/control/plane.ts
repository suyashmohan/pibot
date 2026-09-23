/**
 * ControlPlane facade.
 *
 * The plane is a plain object; process state still lives in `globalThis`
 * inside the manager (this does not grow a second process table). Next routes
 * and tests use `createControlPlane(...)`; production routes use the default
 * `control` singleton.
 */

import { getDb } from "@/lib/db";
import { createPiAgentHost, type AgentHost } from "@/lib/pi/host";
import { createFileService } from "./files";
import { createHealthService, type HealthService } from "./health";
import { createPolicyEngine, defaultPolicy, type PolicyEngine } from "./policy";
import { createProcessService, type ProcessService } from "./processes";
import { createProjectService, type ProjectService } from "./projects";
import { createSessionService, type SessionService } from "./sessions";

export interface ControlDeps {
  host: AgentHost;
  db: typeof getDb;
  now: () => number;
  policy: PolicyEngine;
}

export interface ControlPlane {
  sessions: SessionService;
  processes: ProcessService;
  projects: ProjectService;
  health: HealthService;
}

export function createControlPlane(deps: Partial<ControlDeps> = {}): ControlPlane {
  const resolved: ControlDeps = {
    host: deps.host ?? createPiAgentHost(),
    db: deps.db ?? getDb,
    now: deps.now ?? Date.now,
    policy: deps.policy ?? createPolicyEngine(),
  };
  const files = createFileService(resolved);
  return {
    sessions: createSessionService(resolved, files),
    processes: createProcessService(resolved),
    projects: createProjectService(resolved),
    health: createHealthService(resolved),
  };
}

/** Process-wide default. Next routes call this. */
export const control: ControlPlane = createControlPlane({ policy: defaultPolicy });
