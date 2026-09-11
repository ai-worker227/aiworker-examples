/**
 * Runnable example: lists the paid aiworker tools and calls token/info once.
 *
 *   AIWORKER_BUYER_KEY=0x... [AIWORKER_BASE_URL=https://...] pnpm example
 *
 * No model call here: this shows the tools, not an agent loop. To hand them
 * to an agent, install `@langchain/langgraph` and do:
 *
 *   // import { createReactAgent } from "@langchain/langgraph/prebuilt";
 *   // const agent = createReactAgent({ llm, tools });
 *   // await agent.invoke({ messages: [{ role: "user", content: "…" }] });
 */
import { fetchCatalog, createPayingFetch, priceText, settlementOf, toolNameFor, toolsFromRoutes } from "./src/index.js";

// Well-known Base USDC contract (public); used as the example query argument.
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const rawKey = process.env["AIWORKER_BUYER_KEY"];
if (!rawKey || !/^0x[0-9a-fA-F]{64}$/.test(rawKey)) {
  console.error("set AIWORKER_BUYER_KEY to a 0x-prefixed buyer private key");
  process.exit(2);
}
const privateKey = rawKey as `0x${string}`;
const baseUrl = process.env["AIWORKER_BASE_URL"] ?? "https://aiworker.duckdns.org";

const routes = await fetchCatalog(baseUrl);
const paying = createPayingFetch({ privateKey });

// The tools return strings, so the settlement receipt is captured from the
// underlying response headers instead of the tool output.
let lastResponse: Response | null = null;
const tap: typeof fetch = (async (url, init) => {
  const res = await paying(url, init);
  lastResponse = res;
  return res;
}) as typeof fetch;

const tools = toolsFromRoutes(routes, { baseUrl, fetchImpl: tap, maxPriceUsd: 0.05 });
for (const tool of tools) {
  const route = routes.find((r) => toolNameFor(r.key) === tool.name);
  console.log(`- ${tool.name} ($${route ? priceText(route.priceUsd) : "unknown"}): ${tool.description}`);
}

const tokenRoute = routes.find((r) => r.path === "/v1/token/info");
const tokenTool = tokenRoute ? tools.find((t) => t.name === toolNameFor(tokenRoute.key)) : undefined;
if (!tokenTool) {
  console.error("token/info tool not in catalogue (priced out or missing)");
  process.exit(1);
}
const answer = await tokenTool.invoke({ address: BASE_USDC, chain: "base" });
console.log(answer);
const settlement = lastResponse ? settlementOf(lastResponse) : null;
console.log(`settlement: ${settlement?.transaction ?? "none"} on ${settlement?.network ?? "no network"}`);
