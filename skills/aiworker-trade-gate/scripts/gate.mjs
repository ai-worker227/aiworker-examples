// Pays one trade_gate call over x402 from AIWORKER_BUYER_KEY and prints the verdict. Exit 0 pass, 2 caution, 3 block, 1 error.
//   AIWORKER_BUYER_KEY=0x… node scripts/gate.mjs 0x<token address> [https://aiworker.duckdns.org]
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const [address, edge = "https://aiworker.duckdns.org"] = process.argv.slice(2);
const key = process.env.AIWORKER_BUYER_KEY;
if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? "") || !key) { console.error("usage: AIWORKER_BUYER_KEY=0x… node scripts/gate.mjs 0x<token> [edge url]"); process.exit(1); }

const client = new x402Client();
registerExactEvmScheme(client, { signer: toClientEvmSigner(privateKeyToAccount(key), createPublicClient({ chain: base, transport: http() })) });
const paying = wrapFetchWithPayment(fetch, client);

const res = await paying(`${edge}/v1/trade/gate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address }) });
const body = await res.json().catch(() => ({}));
if (res.status !== 200) { console.error(`${res.status}: ${body.error ?? "no answer"} (nothing settled unless 200)`); process.exit(1); }
console.log(`${body.verdict.toUpperCase()} — ${body.token?.symbol ?? "?"} (${body.token?.name ?? "?"}), liquidity $${body.liquidity_usd ?? "?"}, pool age ${body.largest_pool_age_days ?? "?"} d, holders ${body.holders_count ?? "?"}`);
for (const r of body.reasons ?? []) console.log(`  [${r.severity}] ${r.code}: ${r.detail}`);
console.log(`  ${body.disclaimer}`);
process.exit(body.verdict === "pass" ? 0 : body.verdict === "caution" ? 2 : 3);
