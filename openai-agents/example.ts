// Runnable starter: paid aiworker routes as OpenAI Agents SDK tools.
//
//   AIWORKER_PRIVATE_KEY=0x… [AIWORKER_BASE_URL=https://aiworker.duckdns.org] pnpm --filter @aiworker/example-openai-agents example
//
// Lists every tool under the price cap, then calls the token/info tool once
// for Base USDC and prints the answer plus the on-chain settlement. No model
// call here: this shows the tools, not an agent loop.
import { buildAiworkerTools, settlementOf, type OpenAiToolDefinition } from "./src/index.js";

// Base USDC contract (public, not a secret).
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function refuse(message: string): never {
  console.error(message);
  process.exit(2);
}

const rawKey = process.env.AIWORKER_PRIVATE_KEY;
if (rawKey === undefined || !/^0x[0-9a-fA-F]{64}$/.test(rawKey)) {
  refuse("AIWORKER_PRIVATE_KEY is missing: export a 0x-prefixed Base private key holding USDC first.");
}
const privateKey = rawKey as `0x${string}`;
const baseUrl = process.env.AIWORKER_BASE_URL ?? "https://aiworker.duckdns.org";

// Records the paid response so the settlement hash can be shown without
// paying for the same call twice.
let lastResponse: Response | null = null;
const recording: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  lastResponse = response.clone();
  return response;
};

// No `@openai/agents` import here: the identity `tool` keeps this starter
// dependency-free. In a real agent, pass the framework's `tool` instead and
// hand the result to `new Agent({ name, instructions, tools })`.
const tools = await buildAiworkerTools({
  tool: (definition: OpenAiToolDefinition) => definition,
  baseUrl,
  privateKey,
  maxPriceUsd: 0.05,
  fetchImpl: recording,
});

for (const current of tools) {
  console.log(`- ${current.name}: ${current.description}`);
}

const target = tools.find((current) => current.name.toLowerCase().includes("token") && current.name.toLowerCase().includes("info"));
if (target === undefined) {
  console.error("no token/info tool in the catalogue");
  process.exit(1);
}
const answer = await target.execute({ address: USDC_BASE });
console.log(answer);

const settlement = lastResponse ? settlementOf(lastResponse) : null;
console.log(
  settlement?.transaction
    ? `settlement: ${settlement.transaction} on ${settlement.network}`
    : "settlement: none (response carried no payment-response header)",
);

// Hand the same tools to a model once `@openai/agents` is installed (none
// is here — this block is documentation, not code):
//
//   import { Agent, tool } from "@openai/agents";
//   const tools = await buildAiworkerTools({
//     tool,
//     privateKey: process.env.AIWORKER_PRIVATE_KEY as `0x${string}`,
//     maxPriceUsd: 0.05,
//   });
//   const agent = new Agent({ name: "aiworker-agent", instructions: "Answer with live data.", tools });
