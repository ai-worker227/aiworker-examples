# aiworker for ElizaOS


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

## What it does not do

- No Solana: EVM/Base only, even where the server quotes Solana.
- No MCP: plain ElizaOS actions, not a Model Context Protocol server.
- No retries of a failed settlement: a non-2xx answer is returned
  as `{ success: false, error, text }` and the call is over.
- No provider/evaluator: actions only, no custom providers or evaluators.
- No path-parameter routes (`/v1/defi/protocol/:slug`): skipped rather
  than mis-sent.
