// Local mirror of Mastra's (`@mastra/core`) `createTool({ id, description,
// inputSchema, execute })` shape.
//
// This package deliberately does not depend on `@mastra/core`: the real
// package cannot be added to this repo's lockfile, and agent builders install
// it in their own agent. The interfaces below match the documented tool shape
// structurally, so a definition passed to the framework's `createTool`
// function is what Mastra expects, and the built record is what
// `new Agent({ tools })` takes. A mismatch with a future Mastra major
// surfaces as a compile error in the agent, not a runtime surprise here.
import type { z } from "zod";

/** One paid route as the framework's `createTool()` expects it: zod input schema plus an execute that pays over x402. */
export interface MastraToolDefinition {
  id: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  execute: (o: { context: Record<string, unknown> }) => Promise<string>;
}

/**
 * What the framework's `createTool()` returns. Only the id is read here; the
 * index signature keeps the mirror assignable to Mastra's richer tool type.
 */
export interface MastraToolLike {
  [k: string]: unknown;
  id: string;
}

/**
 * The framework's `createTool` function, injected by the caller (see
 * `buildAiworkerTools`) so nothing from `@mastra/core` is imported here.
 * Unconstrained on purpose: Mastra's richer tool type is accepted as-is.
 */
export type MastraCreateToolLike<TTool = MastraToolLike> = (config: MastraToolDefinition) => TTool;
