# aiworker for the OpenAI Agents SDK

Paid aiworker routes as OpenAI Agents SDK tools. One import builds a tool per
route from the live OpenAPI catalogue; each call pays over x402 from your
own Base wallet. Copy `src/` into your agent, not this directory listing.

## Install

```sh
npm i aiworker-openai-agents-tools @openai/agents
```

Then copy `src/` (`catalog.ts`, `schema.ts`, `payer.ts`, `types.ts`,
`tools.ts`) and build the tools with the framework's `tool` injected (this
package never imports `@openai/agents` itself):

```ts
import { Agent, tool } from "@openai/agents";
import { buildAiworkerTools } from "./src/index.js";
const tools = await buildAiworkerTools({
  tool,
  privateKey: process.env.AIWORKER_PRIVATE_KEY as `0x${string}`,
  maxPriceUsd: 0.05,
});
const agent = new Agent({ name: "aiworker", instructions: "Answer with live data.", tools });
```

Prefer plain definitions (no framework needed) with
`aiworkerToolDefinitions({ baseUrl, maxPriceUsd, routes })`, then pass each
one to `tool()` yourself.

## Wallet

You need a Base wallet holding USDC. The key stays in an env var
(`AIWORKER_PRIVATE_KEY`); it is never logged, committed, or sent anywhere
except as an EIP-3009 signature inside the x402 payment header.

## Price cap

`maxPriceUsd` drops every route priced above it (default: no cap). The
example uses `0.05`, so only sub-nickel routes become tools. Each tool
description carries its exact per-call price (`$0.05 per call, USDC on
Base`).

## No key, pay per call

No API key to manage — no key, pay per call: every tool call pays its own
quoted price over x402 (USDC on Base) straight from your wallet.

## Routes and prices

| Tool | Route | Price |
|---|---|---|
| `aiworker_get_v1_token_info` | `GET /v1/token/info` | $0.005 |
| `aiworker_post_v1_scrape_markdown` | `POST /v1/scrape/markdown` | $0.02 |
| `aiworker_post_v1_polymarket_backtest` | `POST /v1/polymarket/backtest` | $0.25 |

The table is the trimmed fixture; the live catalogue has seventeen routes,
all priced at $0.05 or less — see the catalogue at
`https://aiworker.duckdns.org/llms.txt`.

## Example

```sh
AIWORKER_PRIVATE_KEY=0x… pnpm --filter @aiworker/example-openai-agents example
```

Lists the capped tools, calls token/info once for Base USDC
(`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`), and prints the answer
plus the settlement hash. Refuses to run without the key (exit 2).

## What it does not do

- No Solana: EVM/Base only, even where the server also quotes Solana.
- No MCP: plain SDK tools, not a Model Context Protocol server.
- No retries of a failed settlement: a non-2xx answer comes back as
  `{"error": <status>, "body": …}` and the call is over.
- No free routes: `/health` and the catalogue itself never become tools.
- No key management: bring your own funded wallet and env var.
