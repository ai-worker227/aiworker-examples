# aiworker for ElizaOS

Published copy: [https://github.com/ai-worker227/aiworker-examples/tree/main/elizaos](https://github.com/ai-worker227/aiworker-examples/tree/main/elizaos).

Paid aiworker routes as an ElizaOS plugin. One import builds one action
per route from the live OpenAPI catalogue; each call pays over x402
from your own Base wallet. Copy `src/` into your agent.

## Install

In your agent, which already has `@elizaos/core`:

```sh
pnpm add @x402/core @x402/evm @x402/fetch viem zod
```

Then copy `src/` (`catalog.ts`, `schema.ts`, `payer.ts`,
`actions.ts`, `eliza-types.ts`, `index.ts`) and build the plugin from
the runtime's settings (`AIWORKER_BUYER_KEY`, optional
`AIWORKER_BASE_URL` and `AIWORKER_CHAIN` = `base` | `baseSepolia`):

```ts
import { aiworkerPluginFromSettings } from "./src/index.js";
const plugin = await aiworkerPluginFromSettings(runtime, { maxPriceUsd: 0.05 });
```

or directly with `aiworkerPlugin({ privateKey, maxPriceUsd })`. The package's default export is a
ready plugin object for a character's `plugins` list: empty until the runtime calls its `init`, which reads the
same settings (plus `AIWORKER_MAX_PRICE_USD`, default 0.05) and fills the actions in place; without a key it stays
empty and the agent still starts. An action
takes its arguments from `options.args` or from a message whose text is a
JSON object; anything else is `invalid_arguments` and nothing is paid.

## Why `@elizaos/core` is not a dependency here

The ElizaOS shapes are mirrored in `eliza-types.ts`; this example
cannot carry `@elizaos/core` in its lockfile. The export is
structurally what `@elizaos/core`'s `Plugin` expects. A type mismatch
with a future ElizaOS major is a compile error in the agent, not a
runtime surprise.

## Wallet

You need a Base wallet holding USDC. The key lives only in
`AIWORKER_BUYER_KEY`; it is never logged, committed, or sent anywhere
except as an EIP-3009 signature inside the x402 payment header.

## Price cap

`maxPriceUsd` drops every route priced above it (default: no cap). The
example uses `0.05`. Each action description carries its per-call price.

## Routes and prices

| Route | Price |
|---|---|
| `GET /v1/token/info` | $0.005 |
| `POST /v1/scrape/markdown` | $0.02 |
| `POST /v1/polymarket/backtest` | $0.25 |

The table is the trimmed fixture; the live catalogue has seventeen
paid routes, all discovered through `fetchCatalog` at runtime. Actions
are named `AIWORKER_<operation id>` (`AIWORKER_TOKEN_INFO` live).

## Example

```sh
AIWORKER_BUYER_KEY=0x… pnpm --filter @aiworker/example-elizaos example
```

Lists the capped actions, calls token/info once for Base USDC
(`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`), and prints the answer
plus the settlement hash. Refuses to run without the key (exit 2).

## With a model

```sh
MODEL_BASE_URL=… MODEL_API_KEY=… MODEL_NAME=… AIWORKER_BUYER_KEY=0x… pnpm --filter @aiworker/example-elizaos example:agent
```

Turns the capped actions into OpenAI tools for a chat model, which picks
at most one to answer one Polymarket question — see `example-agent.ts`.
The script needs no extra package beyond the example's dependencies.
It costs one $0.01 `market_odds` call plus the model's own tokens: this
pays real USDC.

## What it does not do

- No Solana: EVM/Base only, even where the server quotes Solana.
- No MCP: plain ElizaOS actions, not a Model Context Protocol server.
- No retries: a non-2xx answer is returned as a failed result with the status and, when the server reported one, the settlement hash. Settlement is the SERVER's rule, not this client's: aiworker's routes settle only on a 200 (the authorization flow) except routes whose 402 says they settle before the work; the client cannot enforce either, it only surfaces the hash for reconciliation
  as `{ success: false, error, text }` and the call is over.
- No provider/evaluator: actions only, no custom providers or evaluators.

## Changelog

- 0.1.2 — `AIWORKER_MAX_PRICE_USD` is enforced at payment time on the amount the server's 402 actually asks for (the catalogue's advertised price is only used to build the action list); a 402 over the cap is refused before anything is signed.
- 0.1.3 — actions are available from ordinary conversation (`validate` answers availability; arguments are resolved at the handler, a miss names the expected fields); the buyer signs only on the selected CAIP-2 network (`AIWORKER_CHAIN`), other EVM quotes are refused; settlement wording corrected (the server's rule, surfaced, not guaranteed by the client).
