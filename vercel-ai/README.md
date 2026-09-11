# aiworker for the Vercel AI SDK


Paid aiworker routes as Vercel AI SDK tools. One import builds a tool per
route from the live OpenAPI catalogue; each call pays over x402 from your
own Base wallet. Copy `src/` into your agent, not this directory listing.

## Install

```sh
pnpm add ai @x402/core @x402/evm @x402/fetch viem zod
```

Then copy `src/` (`catalog.ts`, `schema.ts`, `payer.ts`, `tools.ts`)
and build the tools:

```ts
import { aiworkerTools } from "./src/index.js";
const tools = await aiworkerTools({
  privateKey: process.env.AIWORKER_BUYER_KEY as `0x${string}`,
  maxPriceUsd: 0.05,
});
```

## Wallet

You need a Base wallet holding USDC. The key stays in an env var
(`AIWORKER_BUYER_KEY`); it is never logged, committed, or sent anywhere
except as an EIP-3009 signature inside the x402 payment header.

## Price cap

`maxPriceUsd` drops every route priced above it (default: no cap). The
example uses `0.05`, so only sub-nickel routes become tools. Each tool
description carries its exact per-call price.

## Routes and prices

| Tool suffix | Route | Price |
|---|---|---|
| `get_v1_token_info` | `GET /v1/token/info` | $0.005 |
| `post_v1_scrape_markdown` | `POST /v1/scrape/markdown` | $0.02 |
| `post_v1_polymarket_backtest` | `POST /v1/polymarket/backtest` | $0.25 |

Tool names are prefixed (`aiworker_get_v1_token_info`, …); the live
catalogue has seventeen routes, all priced at $0.05 or less.

## Example

```sh
AIWORKER_BUYER_KEY=0x… pnpm --filter @aiworker/example-vercel-ai example
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
