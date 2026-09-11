/** The x402 buyer for this example: EVM only, mirroring `scripts/e2e-pay.ts`. */
import { x402Client } from "@x402/core/client";
import { toClientEvmSigner } from "@x402/evm";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { decodePaymentResponseHeader, wrapFetchWithPayment } from "@x402/fetch";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

const chains = { base, baseSepolia };

/** Builds a fetch that pays for x402-protected calls from the buyer's own wallet. */
export function createPayingFetch(o: {
  privateKey: `0x${string}`;
  chain?: "base" | "baseSepolia";
  fetchImpl?: typeof fetch;
}): typeof fetch {
  const account = privateKeyToAccount(o.privateKey);
  const publicClient = createPublicClient({ chain: chains[o.chain ?? "base"], transport: http() });
  const client = new x402Client((_version: number, accepts) => {
    const evm = accepts.filter((a) => a.network.startsWith("eip155:"));
    const picked = evm[0] ?? accepts[0];
    if (!picked) throw new Error("no payment options offered");
    return picked;
  });
  registerExactEvmScheme(client, { signer: toClientEvmSigner(account, publicClient) });
  return wrapFetchWithPayment(o.fetchImpl ?? fetch, client) as typeof fetch;
}

/** Reads the settlement receipt the edge echoes on a paid answer; null when absent. */
export function settlementOf(res: Response): { transaction: string | null; network: string | null } | null {
  const header = res.headers.get("payment-response");
  if (!header) return null;
  try {
    const decoded = decodePaymentResponseHeader(header);
    return { transaction: decoded.transaction ?? null, network: decoded.network ?? null };
  } catch {
    return null;
  }
}
