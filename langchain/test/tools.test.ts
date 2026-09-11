import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { describe, expect, it } from "vitest";
import { routesFromOpenApi } from "../src/catalog.js";
import { toolsFromRoutes } from "../src/tools.js";

const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/openapi.json", import.meta.url)), "utf8"),
) as unknown;

const BASE_URL = "https://edge.example.test";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function routes() {
  return routesFromOpenApi(FIXTURE);
}

describe("toolsFromRoutes", () => {
  it("builds DynamicStructuredTools with safe names and priced descriptions", () => {
    const tools = toolsFromRoutes(routes(), { baseUrl: BASE_URL, fetchImpl: (async () => jsonResponse({})) as typeof fetch });
    expect(tools).toHaveLength(3);
    for (const tool of tools) {
      expect(tool).toBeInstanceOf(DynamicStructuredTool);
      expect(tool.name).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(tool.description).toContain("paid over x402");
    }
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName["aiworker_tokenInfo"]?.description).toContain("$0.005");
    expect(byName["aiworker_polymarketBacktest"]?.description).toContain("$0.25");
    expect(byName["aiworker_scrapeMarkdown"]?.description).toContain("$0.02");
    // Only the first 300 characters of the source description are kept.
    const token = routes().find((r) => r.key === "tokenInfo");
    const expected = (token?.description.length ?? 0) > 300 ? token?.description.slice(0, 300) : token?.description;
    expect(byName["aiworker_tokenInfo"]?.description).toContain(expected);
  });

  it("drops routes priced above maxPriceUsd", () => {
    const tools = toolsFromRoutes(routes(), {
      baseUrl: BASE_URL,
      fetchImpl: (async () => jsonResponse({})) as typeof fetch,
      maxPriceUsd: 0.05,
    });
    expect(tools.map((t) => t.name).sort()).toEqual(["aiworker_scrapeMarkdown", "aiworker_tokenInfo"]);
  });

  it("invokes the GET tool with a query string and returns the JSON body", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (input: unknown) => {
      seen.push(String(input));
      return jsonResponse({ symbol: "USDC", decimals: 6 });
    }) as unknown as typeof fetch;
    const tools = toolsFromRoutes(routes(), { baseUrl: BASE_URL, fetchImpl });
    const tool = tools.find((t) => t.name === "aiworker_tokenInfo");
    if (!tool) throw new Error("tokenInfo tool missing");
    const out = await tool.invoke({ address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", chain: "base" });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("/v1/token/info?");
    expect(seen[0]).toContain("address=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(seen[0]).toContain("chain=base");
    expect(JSON.parse(out as string)).toEqual({ symbol: "USDC", decimals: 6 });
  });

  it("invokes the POST tool with a JSON body and content type", async () => {
    let seenInit: RequestInit | undefined;
    const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
      seenInit = init;
      return jsonResponse({ pnl: 1.5 });
    }) as unknown as typeof fetch;
    const tools = toolsFromRoutes(routes(), { baseUrl: BASE_URL, fetchImpl });
    const tool = tools.find((t) => t.name === "aiworker_polymarketBacktest");
    if (!tool) throw new Error("backtest tool missing");
    const out = await tool.invoke({ rule: "favorite_hold" });
    expect(seenInit?.method).toBe("POST");
    expect(new Headers(seenInit?.headers).get("content-type")).toContain("application/json");
    expect(JSON.parse(String(seenInit?.body))).toEqual({ rule: "favorite_hold" });
    expect(JSON.parse(out as string)).toEqual({ pnl: 1.5 });
  });

  it("turns a 402 answer into an error string without throwing", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: "payment required" }), { status: 402 })) as unknown as typeof fetch;
    const tools = toolsFromRoutes(routes(), { baseUrl: BASE_URL, fetchImpl });
    const tool = tools.find((t) => t.name === "aiworker_tokenInfo");
    if (!tool) throw new Error("tokenInfo tool missing");
    const out = await tool.invoke({ address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" });
    const parsed = JSON.parse(out as string) as { error: number; body: string };
    expect(parsed.error).toBe(402);
    expect(typeof parsed.body).toBe("string");
  });
});
