import { encodePaymentResponseHeader } from "@x402/core/http";
import { describe, expect, it } from "vitest";
import { createPayingFetch, settlementOf } from "../src/payer.js";

// Test-only dummy: never funded, never used past a fake fetch. Required
// because createPayingFetch needs a well-formed key to build its signer.
const DUMMY_KEY = "0x1111111111111111111111111111111111111111111111111111111111111111" as `0x${string}`;

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("settlementOf", () => {
  it("decodes a payment-response header", () => {
    const header = encodePaymentResponseHeader({
      success: true,
      transaction: "0xdeadbeef",
      network: "eip155:8453",
    });
    const res = jsonResponse({ ok: true }, 200, { "payment-response": header });
    expect(settlementOf(res)).toEqual({ transaction: "0xdeadbeef", network: "eip155:8453" });
  });

  it("returns null without a payment-response header, or with a broken one", () => {
    expect(settlementOf(jsonResponse({ ok: true }))).toBeNull();
    expect(settlementOf(jsonResponse({ ok: true }, 200, { "payment-response": "not-base64!!" }))).toBeNull();
  });
});

describe("createPayingFetch", () => {
  it("passes a 200 answer through the wrapper untouched", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: unknown) => {
      calls.push(input instanceof Request ? input.url : String(input));
      return jsonResponse({ hello: "world" });
    }) as unknown as typeof fetch;
    const paying = createPayingFetch({ privateKey: DUMMY_KEY, fetchImpl });
    const res = await paying("https://edge.example.test/v1/token/info?address=0x1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hello: "world" });
    expect(calls).toEqual(["https://edge.example.test/v1/token/info?address=0x1"]);
  });
});
