// Runnable starter: paid aiworker routes as Vercel AI SDK tools.
//
//   AIWORKER_BUYER_KEY=0x… AIWORKER_BASE_URL=https://aiworker.duckdns.org pnpm --filter @aiworker/example-vercel-ai example
//
// Lists every tool under the price cap, then calls the token/info tool once
// for Base USDC and prints the answer plus the on-chain settlement. No model
// call here: this shows the tools, not an agent loop.
import type { Tool } from "ai";
import { aiworkerTools, settlementOf } from "./src/index.js";

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

// Records the paid response so the settlement hash can be shown without
// paying for the same call twice.
let lastResponse: Response | null = null;
const recording: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  lastResponse = response.clone();
  return response;
};

const tools = await aiworkerTools({ baseUrl, privateKey, maxPriceUsd: 0.05, fetchImpl: recording });

const names = Object.keys(tools).sort();
for (const name of names) {
  const current: Tool | undefined = tools[name];
  const description = typeof current?.description === "string" ? current.description : "";
  console.log(`- ${name}: ${description}`);
}

const target = names.find((n) => n.toLowerCase().includes("token") && n.toLowerCase().includes("info"));
if (target === undefined) {
  console.error("no token/info tool in the catalogue");
  process.exit(1);
}
const tokenInfo: Tool | undefined = tools[target];
if (tokenInfo === undefined || typeof tokenInfo.execute !== "function") {
  console.error(`tool ${target} has no execute function`);
  process.exit(1);
}
const answer = await tokenInfo.execute(
  { address: USDC_BASE },
  { toolCallId: "example-token-info", messages: [], context: {} },
);
console.log(answer);

const settlement = lastResponse ? settlementOf(lastResponse) : null;
console.log(
  settlement?.transaction
    ? `settlement: ${settlement.transaction} on ${settlement.network}`
    : "settlement: none (response carried no payment-response header)",
);

// Hand the same `tools` record to a model once a provider package is
// installed (none is here — this block is documentation, not code):
//
//   import { generateText } from "ai";
//   import { createOpenAI } from "@ai-sdk/openai"; // any provider package
//   const { text } = await generateText({
//     model: createOpenAI("gpt-4o-mini"),
//     tools,
//     prompt: "What is the total supply of Base USDC?",
//   });
//   console.log(text);
