// Local mirror of `@elizaos/core` 1.x's public plugin/action shapes.
//
// This package deliberately does not depend on `@elizaos/core`: the real
// package cannot be added to this repo's lockfile, and agent builders install
// it in their own agent. The interfaces below match `@elizaos/core` 1.x
// structurally, so the exported plugin object is what `Plugin` expects when
// this `src/` is copied into an agent that has `@elizaos/core` installed. A
// type mismatch with a future ElizaOS major surfaces as a compile error in
// the agent, not a runtime surprise here.

export interface ElizaContent {
  text?: string;
  actions?: string[];
  source?: string;
  [k: string]: unknown;
}

export interface ElizaMemory {
  id?: string;
  entityId?: string;
  roomId?: string;
  content: ElizaContent;
}

export interface ElizaState {
  values?: Record<string, unknown>;
  data?: Record<string, unknown>;
  text?: string;
}

export interface ElizaRuntime {
  /** `@elizaos/core` 1.x returns `string | boolean | number | null` here; the plugin coerces what it reads. */
  getSetting(key: string): string | boolean | number | null | undefined;
  agentId?: string;
}

export type ElizaHandlerCallback = (response: ElizaContent) => Promise<unknown>;

export interface ElizaActionResult {
  success: boolean;
  text?: string;
  data?: Record<string, unknown>;
  error?: string;
}

export interface ElizaAction {
  /** `@elizaos/core` 1.x's `Action` carries an index signature; without it the mirror is not assignable to it. */
  [k: string]: unknown;
  name: string;
  similes?: string[];
  description: string;
  examples?: { name: string; content: ElizaContent }[][];
  validate(runtime: ElizaRuntime, message: ElizaMemory, state?: ElizaState): Promise<boolean>;
  handler(
    runtime: ElizaRuntime,
    message: ElizaMemory,
    state?: ElizaState,
    options?: Record<string, unknown>,
    callback?: ElizaHandlerCallback,
  ): Promise<ElizaActionResult>;
}

export interface ElizaPlugin {
  [k: string]: unknown;
  name: string;
  description: string;
  actions?: ElizaAction[];
  init?(config: Record<string, string>, runtime: ElizaRuntime): Promise<void>;
}
