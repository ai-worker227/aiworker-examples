// Local mirror of the OpenAI Agents SDK (TypeScript, `@openai/agents`)
// `tool({ name, description, parameters, execute })` shape.
//
// This package deliberately does not depend on `@openai/agents`: the real
// package cannot be added to this repo's lockfile, and agent builders install
// it in their own agent. The interfaces below match the SDK's documented tool
// shape structurally, so a definition passed to the framework's `tool()`
// function is what the SDK expects. A mismatch with a future SDK major
// surfaces as a compile error in the agent, not a runtime surprise here.
import type { z } from "zod";

/** One paid route as the framework's `tool()` expects it: zod parameters plus an execute that pays over x402. */
export interface OpenAiToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodTypeAny;
  execute: (input: unknown, context?: unknown) => Promise<string>;
}

/**
 * What the framework's `tool()` returns. Only the name is read here; the
 * index signature keeps the mirror assignable to the SDK's richer tool type.
 */
export interface OpenAiToolLike {
  [k: string]: unknown;
  name: string;
}

/**
 * The framework's `tool` function, injected by the caller (see
 * `buildAiworkerTools`) so nothing from `@openai/agents` is imported here.
 * Unconstrained on purpose: the SDK's richer tool type is accepted as-is.
 */
export type OpenAiToolFactory<TTool = OpenAiToolLike> = (definition: OpenAiToolDefinition) => TTool;
