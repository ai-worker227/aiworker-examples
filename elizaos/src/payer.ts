// The x402 buyer for this example: EVM only (no Solana), mirroring the
// buyer built in scripts/e2e-pay.ts. The key lives in an env var and signs
// EIP-3009 USDC authorizations; nothing here ever prints it.
import { x402Client } from "@x402/core/client";
import type { PaymentRequirements } from "@x402/core/types";
import { decodePaymentResponseHeader, wrapFetchWithPayment } from "@x402/fetch";
import { toClientEvmSigner } from "@x402/evm";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http } from "viem";
import { base, baseSepolia } from "viem/chains";

export interface Settlement {
  transaction: string | null;
  network: string | null;
}

// Paying fetch: answers 402s by signing with the buyer's key and retrying.
// Pass-through for everything else (free routes, 200s, errors).
/** Atomic USDC (6 decimals) of a payment option, whichever field name the server used (v2 `amount`, v1 `maxAmountRequired`). */
function atomicAmountOf(a: PaymentRequirements): bigint | null {
  const raw = (a as unknown as { amount?: unknown; maxAmountRequired?: unknown }).amount ?? (a as unknown as { maxAmountRequired?: unknown }).maxAmountRequired;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  return BigInt(raw);
}

export function createPayingFetch(o: {
  privateKey: `0x${string}`;
  chain?: "base" | "baseSepolia";
  fetchImpl?: typeof fetch;
  /** The most one call may cost, in USD. Enforced here, on the amount the server's 402 actually asks for — not on the
   *  catalogue's advertised price — so a server that quotes more than it lists is refused before anything is signed. */
  maxPriceUsd?: number;
}): typeof fetch {
  const account = privateKeyToAccount(o.privateKey);
  const chain = o.chain === "baseSepolia" ? baseSepolia : base;
  // The one CAIP-2 network this buyer signs for. Registered as the ONLY network of the scheme and re-checked in the
  // selector, so a 402 that offers an affordable quote on another EVM chain is refused before anything is signed
  // (registry review, 2026-09-12: `@x402/evm` registers `eip155:*` by default).
  const network = `eip155:${chain.id}`;
  // Read-only client for the signer's contract reads; no key material here.
  const publicClient = createPublicClient({ chain, transport: http() });
  const capAtomic = o.maxPriceUsd === undefined ? null : BigInt(Math.round(o.maxPriceUsd * 1_000_000));
  const client = new x402Client((_version: number, accepts: PaymentRequirements[]) => {
    const candidates = accepts.filter((a) => a.network === network);
    if (candidates.length === 0) throw new Error(`x402: the server offers no payment option on ${network} (offered: ${accepts.map((a) => a.network).join(", ") || "none"}); nothing was signed`);
    if (capAtomic === null) return candidates[0]!;
    // An option whose amount cannot be read is never signed under a cap: unknown is not "within budget".
    const affordable = candidates.filter((a) => { const n = atomicAmountOf(a); return n !== null && n <= capAtomic; });
    if (affordable.length === 0) {
      const asked = atomicAmountOf(candidates[0]!);
      throw new Error(`x402: the server asks ${asked === null ? "an unreadable amount" : `$${(Number(asked) / 1_000_000).toFixed(6)}`}, over AIWORKER_MAX_PRICE_USD ($${o.maxPriceUsd}); nothing was signed`);
    }
    return affordable[0]!;
  });
  registerExactEvmScheme(client, { signer: toClientEvmSigner(account, publicClient), networks: [network as never] });
  return wrapFetchWithPayment(o.fetchImpl ?? fetch, client) as typeof fetch;
}

// Pulls the on-chain settlement out of a paid response's payment-response
// header (base64 JSON per the 402-flow spec). Null when the response carries
// none, or when the header does not decode.
export function settlementOf(res: Response): Settlement | null {
  const header = res.headers.get("payment-response");
  if (!header) return null;
  try {
    const decoded = decodePaymentResponseHeader(header);
    return {
      transaction: typeof decoded.transaction === "string" ? decoded.transaction : null,
      network: typeof decoded.network === "string" ? decoded.network : null,
    };
  } catch {
    return null;
  }
}
