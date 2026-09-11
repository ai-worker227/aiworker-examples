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
});
