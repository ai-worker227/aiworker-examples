// Runnable starter: paid aiworker routes as an ElizaOS plugin.
//
//   AIWORKER_BUYER_KEY=0x… [AIWORKER_BASE_URL=https://aiworker.duckdns.org] pnpm --filter @aiworker/example-elizaos example
//
// Lists every action under the price cap, then calls the token/info action
// once for Base USDC and prints the answer plus the on-chain settlement. No
// agent loop here: this shows the plugin, not a full ElizaOS runtime.
import { aiworkerPlugin } from "./src/index.js";
import type { ElizaMemory, ElizaRuntime } from "./src/eliza-types.js";

// Base USDC contract (public, not a secret).
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function refuse(message: string): never {
  console.error(message);
  process.exit(2);
}

const rawKey = process.env.AIWORKER_BUYER_KEY;
if (rawKey === undefined || !/^0x[0-9a-fA-F]{64}$/.test(rawKey)) {
  refuse("AIWORKER_BUYER_KEY is missing: export a 0x-prefixed Base private key holding USDC first.");
}
const privateKey = rawKey as `0x${string}`;
const baseUrl = process.env.AIWORKER_BASE_URL ?? "https://aiworker.duckdns.org";

const plugin = await aiworkerPlugin({ baseUrl, privateKey, maxPriceUsd: 0.05 });
const actions = plugin.actions ?? [];

for (const action of actions) {
  console.log(`- ${action.name}: ${action.description}`);
}

const target = actions.find((a) => a.name.includes("TOKEN") && a.name.includes("INFO"));
if (target === undefined) {
  console.error("no token/info action in the catalogue");
  process.exit(1);
}

const runtime: ElizaRuntime = { getSetting: () => undefined, agentId: "example" };
const message: ElizaMemory = {
  content: { text: JSON.stringify({ address: USDC_BASE }) },
};
const result = await target.handler(runtime, message, undefined, undefined, async (response) => {
  console.log(response.text);
  return null;
});
console.log(result.text);

const settlement = (result.data?.["settlement"] ?? null) as { transaction?: string | null; network?: string | null } | null;
console.log(
  settlement?.transaction
    ? `settlement: ${settlement.transaction} on ${settlement.network}`
    : "settlement: none (response carried no payment-response header)",
);

// To register the same plugin in a real agent, copy `src/` into the agent
// (which has `@elizaos/core` installed) and do:
//
//   import { aiworkerPlugin } from "./src/index.js";
//   const character = {
//     name: "aiworker-agent",
//     plugins: [await aiworkerPlugin({ privateKey: process.env.AIWORKER_BUYER_KEY as `0x${string}`, maxPriceUsd: 0.05 })],
//     // ...the rest of the character
//   };
