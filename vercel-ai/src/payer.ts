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
export function createPayingFetch(o: {
  privateKey: `0x${string}`;
  chain?: "base" | "baseSepolia";
  fetchImpl?: typeof fetch;
}): typeof fetch {
  const account = privateKeyToAccount(o.privateKey);
  // Read-only client for the signer's contract reads; no key material here.
  const publicClient = createPublicClient({
    chain: o.chain === "baseSepolia" ? baseSepolia : base,
    transport: http(),
  });
  const client = new x402Client((_version: number, accepts: PaymentRequirements[]) => {
    const evm = accepts.filter((a) => a.network.startsWith("eip155:"));
    const picked = evm[0] ?? accepts[0];
    if (!picked) throw new Error("x402: server offered no payment options");
    return picked;
  });
  registerExactEvmScheme(client, { signer: toClientEvmSigner(account, publicClient) });
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
