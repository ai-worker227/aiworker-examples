---
name: aiworker-deep-research
description: Get a cited research report on any question from a live web-search loop (Exa) — every paragraph cites the pages it came from, quotes are verified verbatim, and what could not be verified is listed. Paid per call in USDC over x402 ($0.50) or as an ACP job ($2.00). Use it when the answer must be sourced, not remembered.
version: 1.0.0
---

# aiworker deep research

Use this skill when a user's question needs sources, not recall: "what changed in X this year", "what do public
reports say about Y", "summarise the evidence on Z". One call plans 3–5 sub-questions, searches the web, reads the
pages, writes a report where every paragraph ends in `[n]` citations, verifies each quoted finding against the
page text, and lists what it could not verify. No advice, no forecasts.

| Surface | Where | Price | Time |
| --- | --- | --- | --- |
| x402 | `POST https://aiworker.duckdns.org/v1/research/deep` | $0.50 | 30–90 s |
| MCP | tool `deep_research` at `https://aiworker.duckdns.org/mcp` | $0.50 | same |
| ACP | offering `deep_research` from seller `0xec4bc04310925326ff80daf419a3861173865689` | $2.00 | ≤ 15 min |

## When not to use it

- Questions answerable from the user's own files or a single known page: use the page-to-Markdown route instead.
- Anything that needs a recommendation, a prediction or a "should I": the report will not give one.
- Live prices or on-chain facts: those have their own routes (`trending_tokens`, `token_check`, `trade_gate`).

## Prerequisites

x402: a Base wallet with a little USDC, its key in `AIWORKER_BUYER_KEY`, and an x402 client
(`npm install @x402/core @x402/evm @x402/fetch viem`). ACP: the Virtuals `acp` CLI with a funded agent wallet.
The buyer key never goes into a prompt, a file or a log.

## Approval gates

- Tell the user the price once per session before the first call; stop if the wallet is short (a 402 after the
  automatic retry means the balance is short — never move funds to fix that).
- One report per question per session; do not loop on retries. A `503` is an upstream outage and nothing was
  charged: retry later, once.

## Input

```json
{ "question": "What changed in Base's sequencer fee model in 2026?", "focus": "crypto", "max_words": 600, "recency_days": 180, "sources": ["https://example.com/report"] }
```

- `question` 10–500 characters, no URL inside (URLs go in `sources`, at most 5, https only).
- `focus`: `crypto`, `markets` or `general` (default). `max_words` 300–1500 (default 800). `recency_days` 7–365 limits
  the search to recent pages.

## Output contract

`report_md` (the cited report, ending with "What could not be verified"), `key_findings[]` (`finding`, `source_url`,
`quote` — the quote appears verbatim in the source), `sources[]` (`id`, `url`, `title`, `published_at`, `ok`),
`unanswered[]`, `rounds`, `searches`, `pages_read`, `model`, `tokens_in`, `tokens_out`, `generated_at`, `disclaimer`.

Report to the user: the report body as delivered (keep the `[n]` markers), then the source list with URLs, then the
unanswered items verbatim. Say how many of the sources were usable (`ok`). Never add claims the report does not
carry; a `null` field is an unanswered source, not a zero.

## Errors

| Status | Meaning | Charged? |
| --- | --- | --- |
| 400 `invalid_request` | schema (question length, URL in question, > 5 sources) | no |
| 400 `input_too_expensive` | the model-cost estimate exceeds the price's share | no |
| 502 `research_unverifiable` / `research_unplannable` | no cited paragraph survived / no valid plan | no |
| 503 `research_unavailable` (reason) | Exa outage, daily cap, kill switch | no |
| 504 `handler_timeout` | over 240 s | no |

Discovery: `https://aiworker.duckdns.org/llms.txt`, `/openapi.json`. Data: Exa web search and page text; the report is
written on aiworker's zero-retention model lane.
