import { describe, expect, it } from "vitest";
import { createPayingFetch, settlementOf } from "../src/payer.js";

// Obviously-fake key for the wrapper-construction test only: no funds, no
// network, never leaves this file.
const DUMMY_KEY = "0x0000000000000000000000000000000000000000000000000000000000000001" as const;

function settleHeader(transaction: string, network: string): string {
  return Buffer.from(JSON.stringify({ success: true, transaction, network })).toString("base64");
}

describe("settlementOf", () => {
  it("decodes a payment-response header", () => {
    const tx = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    const res = new Response("{}", {
      status: 200,
      headers: { "payment-response": settleHeader(tx, "eip155:8453") },
    });
    expect(settlementOf(res)).toEqual({ transaction: tx, network: "eip155:8453" });
  });

  it("returns null without a payment-response header", () => {
    expect(settlementOf(new Response("{}", { status: 200 }))).toBeNull();
  });

  it("returns null for an undecodable header instead of throwing", () => {
    const res = new Response("{}", { status: 200, headers: { "payment-response": "!!!not-base64!!!" } });
    expect(settlementOf(res)).toBeNull();
  });
});

describe("createPayingFetch", () => {
  it("passes a first-call 200 straight through the wrapper", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: unknown) => {
      seen.push(url instanceof Request ? url.url : String(url));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const paying = createPayingFetch({ privateKey: DUMMY_KEY, fetchImpl });
    const res = await paying("https://edge.example/openapi.json");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(seen).toEqual(["https://edge.example/openapi.json"]);
  });

  // The cap is enforced on the 402's own amount, not the catalogue's price (registry review, 2026-09-11).
  function edge402(amountAtomic: string): typeof fetch {
    const calls: number[] = [];
    const requirements = { x402Version: 2, resource: { url: "https://edge.example/v1/x", description: "x" }, accepts: [{ scheme: "exact", network: "eip155:8453", amount: amountAtomic, asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: "0x1111111111111111111111111111111111111111", maxTimeoutSeconds: 60, extra: { name: "USD Coin", version: "2" } }] };
    const fetchImpl = (async () => {
      calls.push(1);
      if (calls.length === 1) return new Response("{}", { status: 402, headers: { "content-type": "application/json", "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(requirements)).toString("base64") } });
      return new Response(JSON.stringify({ paid: true }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    (fetchImpl as unknown as { calls: number[] }).calls = calls;
    return fetchImpl;
  }

  it("refuses to sign when the 402 asks more than the cap, whatever the catalogue said — no retry, nothing signed", async () => {
    const fetchImpl = edge402("60000"); // $0.06
    const paying = createPayingFetch({ privateKey: DUMMY_KEY, fetchImpl, maxPriceUsd: 0.05 });
    await expect(paying("https://edge.example/v1/x")).rejects.toThrow(/over AIWORKER_MAX_PRICE_USD/);
    expect((fetchImpl as unknown as { calls: number[] }).calls).toHaveLength(1);
  });

  it("signs and retries when the 402's amount is within the cap", async () => {
    const fetchImpl = edge402("50000"); // $0.05
    const paying = createPayingFetch({ privateKey: DUMMY_KEY, fetchImpl, maxPriceUsd: 0.05 });
    const res = await paying("https://edge.example/v1/x");
    expect(res.status).toBe(200);
    expect((fetchImpl as unknown as { calls: number[] }).calls).toHaveLength(2);
  });
});
