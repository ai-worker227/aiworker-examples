# aiworker examples — paid data tools for agent frameworks

[aiworker](https://aiworker.duckdns.org) sells twenty small data routes to agents, paid per call in USDC over the
[x402](https://x402.org) protocol (Base and Solana): DeFi yields and protocol snapshots, page-to-Markdown, Base token
safety cards and wallet checks, Polymarket resolution, odds, history, screener and backtests, fact checks, sourced
briefs and headline search. No account, no API key: an unpaid request answers `402` with the price, a paying client
pays and retries. Every route and its price: `https://aiworker.duckdns.org/llms.txt`.

This repo holds the framework wrappers. Each is a copy-in package: one import reads the live OpenAPI catalogue and
builds one tool (or action) per route; each call pays from the buyer's own wallet through `@x402/fetch`.

| Package | Framework | Entry point |
|---|---|---|
| [`langchain/`](langchain/) | LangChain.js | `aiworkerTools({ privateKey, maxPriceUsd })` |
| [`vercel-ai/`](vercel-ai/) | Vercel AI SDK | `aiworkerTools({ privateKey, maxPriceUsd })` |
| [`elizaos/`](elizaos/) | ElizaOS 1.x | `aiworkerPluginFromSettings(runtime, { maxPriceUsd })` |
| [`openai-agents/`](openai-agents/) | OpenAI Agents SDK (JS) | `buildAiworkerTools({ tool, privateKey, maxPriceUsd })` — inject the SDK's `tool()` |
| [`mastra/`](mastra/) | Mastra | `buildAiworkerTools({ createTool, privateKey, maxPriceUsd })` — inject `createTool()` |

Shared across the five: `catalog.ts` (OpenAPI → route list), `schema.ts` (JSON schema → zod), `payer.ts` (the
x402 buyer from a private key: `@x402/core`, `@x402/evm`, `@x402/fetch`, `viem`). Copy the `src/` you need; each
README says what to install.

## Wallet and price cap

You need a Base wallet holding USDC. The key lives only in `AIWORKER_BUYER_KEY`; it is never logged or sent
anywhere except as an EIP-3009 signature inside the x402 payment header. `maxPriceUsd` drops every route priced
above it; the examples cap at $0.05 per call. Nothing is settled unless the request succeeds.

## Develop

```sh
pnpm install
pnpm test        # fakes only: no network, no wallet
pnpm -r build    # dist/ for the npm packages
pnpm typecheck
```

MIT. Questions, abuse reports or takedown requests: personalworkerai@gmail.com.

## Skills

Three skills for coding agents (`npx skills add ai-worker227/aiworker-examples` installs them; or copy a folder into
`~/.claude/skills/`): `skills/aiworker-trade-gate/`, `skills/aiworker-wallet-hygiene/`, `skills/aiworker-deep-research/`.
Claude Code users can also add this repo as a plugin marketplace (`/plugin marketplace add ai-worker227/aiworker-examples`,
then `/plugin install aiworker@aiworker-examples`): the plugin carries the aiworker MCP server (`.mcp.json`) and the skills.

`skills/aiworker-trade-gate/` — a skill for coding agents (Claude Code, Codex, anything that reads `SKILL.md`): check a
Base token with the rule-based trade gate before any swap, act on pass / caution / block with the listed reasons, and
scan the agent's own wallet for airdrop spam. Pays over x402 from the buyer's wallet (`scripts/gate.mjs`, thirty lines)
or creates an ACP job against the seller. Install: `cp -R skills/aiworker-trade-gate ~/.claude/skills/`.
