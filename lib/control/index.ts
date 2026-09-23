/**
 * SERVER barrel — do not import from client components (drags `bun:sqlite`
 * into the browser bundle). Client code imports `@/lib/control/types` and
 * `@/lib/control/projector`, or the `@/lib/client` SDK.
 */

export {
  control,
  createControlPlane,
  type ControlDeps,
  type ControlPlane,
} from "./plane";
export { ControlError, isControlError, type ControlCode, type ControlStatus } from "./errors";
export type { FileService } from "./files";
export type { HealthService } from "./health";
export type { PolicyEngine, MutatingKind } from "./policy";
export { DEFAULT_SUPERVISOR_FANOUT, assertAllowed, createPolicyEngine } from "./policy";
export type { ProcessService } from "./processes";
export type { ProjectService } from "./projects";
export type { SessionService } from "./sessions";
export * from "./types";
