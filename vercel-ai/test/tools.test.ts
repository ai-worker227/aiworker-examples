import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Tool } from "ai";
import { describe, expect, it } from "vitest";
import { routesFromOpenApi, type RouteInfo } from "../src/catalog.js";
import { toolsFromRoutes } from "../src/tools.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/openapi.json", import.meta.url));
const BASE_URL = "https://edge.example";

function routes(): RouteInfo[] {
  return routesFromOpenApi(JSON.parse(readFileSync(FIXTURE, "utf8")) as unknown);
}

interface SeenCall {
  url: string;
  init?: RequestInit;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Fake fetch in this repo's style: records calls, answers from a script.
function fakeFetch(handler: (call: SeenCall) => Response): { fetchImpl: typeof fetch; calls: SeenCall[] } {
  const calls: SeenCall[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const call: SeenCall = { url, init };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function mustExecute(tools: Record<string, Tool>, name: string): NonNullable<Tool["execute"]> {
  const current = tools[name];
  expect(current).toBeDefined();
  if (current === undefined || typeof current.execute !== "function") throw new Error(`missing tool ${name}`);
  return current.execute;
}

const EXEC_OPTIONS = { toolCallId: "test-call", messages: [], context: {} } as Parameters<
  NonNullable<Tool["execute"]>
>[1];

describe("toolsFromRoutes", () => {
  it("names tools aiworker_<key> with SDK-legal names and priced descriptions", () => {
    const tools = toolsFromRoutes(routes(), { baseUrl: BASE_URL, fetchImpl: fetch });
    expect(Object.keys(tools).sort()).toEqual([
      "aiworker_get_v1_token_info",
      "aiworker_post_v1_polymarket_backtest",
      "aiworker_post_v1_scrape_markdown",
    ]);
    for (const [name, current] of Object.entries(tools)) {
      expect(name).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(typeof current.description).toBe("string");
      expect(current.description as string).toContain("(price $");
      expect(current.description as string).toContain("per call, paid over x402)");
    }
    expect(tools["aiworker_get_v1_token_info"]?.description).toContain("(price $0.005 per call, paid over x402)");
    expect(tools["aiworker_post_v1_scrape_markdown"]?.description).toContain(
      "(price $0.02 per call, paid over x402)",
    );
  });

  it("drops routes priced above maxPriceUsd", () => {
    const tools = toolsFromRoutes(routes(), { baseUrl: BASE_URL, fetchImpl: fetch, maxPriceUsd: 0.05 });
    expect(Object.keys(tools).sort()).toEqual([
      "aiworker_get_v1_token_info",
      "aiworker_post_v1_scrape_markdown",
    ]);
  });

  it("carries a zod schema the SDK accepts, and execute(args) works on it", async () => {
    const body = { symbol: "USDC", decimals: 6 };
    const { fetchImpl } = fakeFetch(() => jsonResponse(body));
    const tools = toolsFromRoutes(routes(), { baseUrl: BASE_URL, fetchImpl });
    const execute = mustExecute(tools, "aiworker_get_v1_token_info");
    const schema = tools["aiworker_get_v1_token_info"]?.inputSchema as unknown as {
      parse: (value: unknown) => unknown;
    };
    expect(typeof schema.parse).toBe("function");
    expect(schema.parse({ address: "0xabababababababababababababababababababab", chain: "base" })).toEqual({ address: "0xabababababababababababababababababababab", chain: "base" });
    const out = await execute({ address: "0xabababababababababababababababababababab" }, EXEC_OPTIONS);
    expect(JSON.parse(out as string)).toEqual(body);
  });

  it("builds the GET query string from the args and returns the JSON body", async () => {
    const { fetchImpl, calls } = fakeFetch(() => jsonResponse({ symbol: "USDC" }));
    const tools = toolsFromRoutes(routes(), { baseUrl: BASE_URL, fetchImpl });
    const out = await mustExecute(tools, "aiworker_get_v1_token_info")(
      { address: "0xabababababababababababababababababababab", chain: "base" },
      EXEC_OPTIONS,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE_URL}/v1/token/info?address=0xabababababababababababababababababababab&chain=base`);
    expect(calls[0]?.init?.method).toBe("GET");
    expect(JSON.parse(out as string)).toEqual({ symbol: "USDC" });
  });

  it("sends the POST JSON body with the right content type", async () => {
    const { fetchImpl, calls } = fakeFetch(() => jsonResponse({ content_md: "# hi" }));
    const tools = toolsFromRoutes(routes(), { baseUrl: BASE_URL, fetchImpl });
    const out = await mustExecute(tools, "aiworker_post_v1_scrape_markdown")(
      { url: "https://example.com/x" },
      EXEC_OPTIONS,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE_URL}/v1/scrape/markdown`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(new Headers(calls[0]?.init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({ url: "https://example.com/x" });
    expect(JSON.parse(out as string)).toEqual({ content_md: "# hi" });
  });

  it("turns a 402 answer into the {\"error\": 402, …} string without throwing", async () => {
    const { fetchImpl } = fakeFetch(() => jsonResponse({ message: "payment required" }, 402));
    const tools = toolsFromRoutes(routes(), { baseUrl: BASE_URL, fetchImpl });
    const out = await mustExecute(tools, "aiworker_get_v1_token_info")({ address: "0xabababababababababababababababababababab" }, EXEC_OPTIONS);
    expect(typeof out).toBe("string");
    expect(out as string).toContain('"error":402');
    expect(JSON.parse(out as string)).toEqual({ error: 402, body: { message: "payment required" } });
  });

  it("truncates non-JSON error bodies to 500 characters", async () => {
    const { fetchImpl } = fakeFetch(() => new Response("x".repeat(600), { status: 500 }));
    const tools = toolsFromRoutes(routes(), { baseUrl: BASE_URL, fetchImpl });
    const out = await mustExecute(tools, "aiworker_post_v1_scrape_markdown")(
      { url: "https://example.com/x" },
      EXEC_OPTIONS,
    );
    const parsed = JSON.parse(out as string) as { error: number; body: string };
    expect(parsed.error).toBe(500);
    expect(parsed.body).toHaveLength(500);
  });

  it("never throws when the fetch itself rejects", async () => {
    const fetchImpl = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    const tools = toolsFromRoutes(routes(), { baseUrl: BASE_URL, fetchImpl });
    const out = await mustExecute(tools, "aiworker_get_v1_token_info")({ address: "0xabababababababababababababababababababab" }, EXEC_OPTIONS);
    expect(JSON.parse(out as string)).toEqual({ error: "fetch_failed", body: "boom" });
  });
});

describe("path parameters", () => {
  const PATH_DOC = { paths: { "/v1/defi/protocol/{slug}": { get: { operationId: "defi_protocol", summary: "one protocol", parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }, { name: "verbose", in: "query", schema: { type: "boolean" } }], "x-payment-info": { price: { mode: "fixed", currency: "USD", amount: "0.010000" } } } } } };
  it("fills a {slug} path parameter from the args (required in the schema) and keeps it out of the query", async () => {
    const { fetchImpl, calls } = fakeFetch(() => jsonResponse({ tvl: 1 }));
    const [route] = routesFromOpenApi(PATH_DOC);
    expect(route?.inputSchema).toMatchObject({ required: ["slug"] });
    const tools = toolsFromRoutes([route!], { baseUrl: BASE_URL, fetchImpl });
    const out = await mustExecute(tools, "aiworker_defi_protocol")({ slug: "aave-v3", verbose: true }, EXEC_OPTIONS);
    expect(calls[0]?.url).toBe(`${BASE_URL}/v1/defi/protocol/aave-v3?verbose=true`);
    expect(JSON.parse(out as string)).toEqual({ tvl: 1 });
  });
});
