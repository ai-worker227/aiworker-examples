# aiworker x402 tools for LangChain.js


One import that turns the public aiworker OpenAPI catalogue into LangChain
tools. Each tool pays for its own call over x402 from the buyer's wallet.

## Install

```sh
pnpm add @langchain/core @x402/core @x402/evm @x402/fetch viem zod
```

Then copy `src/` (`catalog.ts`, `schema.ts`, `payer.ts`, `tools.ts`,
`index.ts`) into your project.

## Wallet

You need a Base wallet funded with USDC. The key lives only in an env var,
never in code:

```sh
export AIWORKER_BUYER_KEY=0x...
```

## Use

```ts
import { aiworkerTools } from "./src/index.js";
const tools = await aiworkerTools({
  privateKey: process.env.AIWORKER_BUYER_KEY as `0x${string}`,
  maxPriceUsd: 0.05, // skip anything pricier; omit for no cap
});
```

## Routes and prices

| Route | Price |
|---|---|
| `GET /v1/token/info` | $0.005 |
| `POST /v1/polymarket/backtest` | $0.25 |
| `POST /v1/scrape/markdown` | $0.02 |

The live catalogue has seventeen paid routes; the table above is the trimmed
fixture in `test/fixtures/openapi.json`.

## Example

```sh
AIWORKER_BUYER_KEY=0x... pnpm example
```

Lists the tools under the cap, then calls `token/info` once for Base USDC
and prints the answer plus the settlement hash.

## What it does not do

- No Solana: EVM (Base) only.
- No MCP wrapper.
- No retries of a failed settlement: a non-2xx answer is returned as an
  `{"error", "body"}` string for the agent to handle.
- No price negotiation: catalogue prices are fixed per route.
