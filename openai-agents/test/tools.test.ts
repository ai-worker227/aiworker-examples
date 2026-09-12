import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  aiworkerToolDefinitions,
  buildAiworkerTools,
  createPayingFetch,
  definitionsFromRoutes,
  routesFromOpenApi,
  type OpenAiToolDefinition,
  type OpenAiToolLike,
} from "../src/index.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/openapi.json", import.meta.url));
const BASE_URL = "https://edge.example";
const CATALOG_DOC = JSON.parse(readFileSync(FIXTURE, "utf8")) as unknown;

// Obviously-fake key for the wrapper-construction test only: no funds, no
// network, never leaves this file.
const DUMMY_KEY = "0x0000000000000000000000000000000000000000000000000000000000000001" as const;

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

// Fake fetch in this repo's style: serves the fixture catalogue at
// /openapi.json, answers every other call from the script, records all calls.
function catalogFetch(
  api: (call: SeenCall) => Response,
  calls: SeenCall[] = [],
): { fetchImpl: typeof fetch; calls: SeenCall[] } {
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const call: SeenCall = { url, init };
    calls.push(call);
    if (String(url).endsWith("/openapi.json")) return jsonResponse(CATALOG_DOC);
    return api(call);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function apiCalls(calls: SeenCall[]): SeenCall[] {
  return calls.filter((call) => !call.url.endsWith("/openapi.json"));
}

function mustDefinition(definitions: OpenAiToolDefinition[], name: string): OpenAiToolDefinition {
  const found = definitions.find((definition) => definition.name === name);
  expect(found).toBeDefined();
  if (found === undefined) throw new Error(`missing tool ${name}`);
  return found;
}

describe("aiworkerToolDefinitions", () => {
  it("lists one tool per paid route with SDK-legal names and priced descriptions", async () => {
    const { fetchImpl } = catalogFetch(() => jsonResponse({}));
    const definitions = await aiworkerToolDefinitions({ baseUrl: BASE_URL, fetchImpl });
    expect(definitions.map((definition) => definition.name).sort()).toEqual([
      "aiworker_get_v1_token_info",
      "aiworker_post_v1_polymarket_backtest",
      "aiworker_post_v1_scrape_markdown",
    ]);
    for (const definition of definitions) {
      expect(definition.name).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(typeof definition.description).toBe("string");
      expect(definition.description).toContain("per call, USDC on Base");
      expect(typeof definition.execute).toBe("function");
      expect(typeof definition.parameters.parse).toBe("function");
    }
    expect(mustDefinition(definitions, "aiworker_get_v1_token_info").description).toContain(
      "$0.005 per call, USDC on Base",
    );
    expect(mustDefinition(definitions, "aiworker_post_v1_scrape_markdown").description).toContain(
      "$0.02 per call, USDC on Base",
    );
  });

  it("carries a zod schema the SDK accepts, and execute(input) works on it", async () => {
    const body = { symbol: "USDC", decimals: 6 };
    const { fetchImpl } = catalogFetch(() => jsonResponse(body));
    const definitions = await aiworkerToolDefinitions({ baseUrl: BASE_URL, fetchImpl });
    const definition = mustDefinition(definitions, "aiworker_get_v1_token_info");
    expect(
      definition.parameters.parse({ address: "0xabababababababababababababababababababab", chain: "base" }),
    ).toEqual({ address: "0xabababababababababababababababababababab", chain: "base" });
    const out = await definition.execute({ address: "0xabababababababababababababababababababab" });
    expect(JSON.parse(out)).toEqual(body);
  });

  it("drops routes priced above maxPriceUsd", async () => {
    const { fetchImpl } = catalogFetch(() => jsonResponse({}));
    const definitions = await aiworkerToolDefinitions({ baseUrl: BASE_URL, fetchImpl, maxPriceUsd: 0.05 });
    expect(definitions.map((definition) => definition.name).sort()).toEqual([
      "aiworker_get_v1_token_info",
      "aiworker_post_v1_scrape_markdown",
    ]);
  });

  it("narrows to the routes allowlist and refuses an unknown route", async () => {
    const { fetchImpl } = catalogFetch(() => jsonResponse({}));
    const narrowed = await aiworkerToolDefinitions({ baseUrl: BASE_URL, fetchImpl, routes: ["get_v1_token_info"] });
    expect(narrowed.map((definition) => definition.name)).toEqual(["aiworker_get_v1_token_info"]);
    const { fetchImpl: refused } = catalogFetch(() => jsonResponse({}));
    await expect(
      aiworkerToolDefinitions({ baseUrl: BASE_URL, fetchImpl: refused, routes: ["no_such_route"] }),
    ).rejects.toThrow("unknown route: no_such_route");
  });

  it("builds the GET query string from the input and returns the JSON body", async () => {
    const { fetchImpl, calls } = catalogFetch(() => jsonResponse({ symbol: "USDC" }));
    const definitions = await aiworkerToolDefinitions({ baseUrl: BASE_URL, fetchImpl });
    const out = await mustDefinition(definitions, "aiworker_get_v1_token_info").execute({
      address: "0xabababababababababababababababababababab",
      chain: "base",
    });
    const api = apiCalls(calls);
    expect(api).toHaveLength(1);
    expect(api[0]?.url).toBe(`${BASE_URL}/v1/token/info?address=0xabababababababababababababababababababab&chain=base`);
    expect(api[0]?.init?.method).toBe("GET");
    expect(JSON.parse(out)).toEqual({ symbol: "USDC" });
  });

  it("sends the POST JSON body with the right content type", async () => {
    const { fetchImpl, calls } = catalogFetch(() => jsonResponse({ content_md: "# hi" }));
    const definitions = await aiworkerToolDefinitions({ baseUrl: BASE_URL, fetchImpl });
    const out = await mustDefinition(definitions, "aiworker_post_v1_scrape_markdown").execute({
      url: "https://example.com/x",
    });
    const api = apiCalls(calls);
    expect(api).toHaveLength(1);
    expect(api[0]?.url).toBe(`${BASE_URL}/v1/scrape/markdown`);
    expect(api[0]?.init?.method).toBe("POST");
    expect(new Headers(api[0]?.init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(api[0]?.init?.body as string)).toEqual({ url: "https://example.com/x" });
    expect(JSON.parse(out)).toEqual({ content_md: "# hi" });
  });

  it("turns a 402 answer into the {\"error\": 402, …} string without throwing", async () => {
    const { fetchImpl } = catalogFetch(() => jsonResponse({ message: "payment required" }, 402));
    const definitions = await aiworkerToolDefinitions({ baseUrl: BASE_URL, fetchImpl });
    const out = await mustDefinition(definitions, "aiworker_get_v1_token_info").execute({
      address: "0xabababababababababababababababababababab",
    });
    expect(typeof out).toBe("string");
    expect(out).toContain('"error":402');
    expect(JSON.parse(out)).toEqual({ error: 402, body: { message: "payment required" } });
  });

  it("truncates non-JSON error bodies to 500 characters", async () => {
    const { fetchImpl } = catalogFetch(() => new Response("x".repeat(600), { status: 500 }));
    const definitions = await aiworkerToolDefinitions({ baseUrl: BASE_URL, fetchImpl });
    const out = await mustDefinition(definitions, "aiworker_post_v1_scrape_markdown").execute({
      url: "https://example.com/x",
    });
    const parsed = JSON.parse(out) as { error: number; body: string };
    expect(parsed.error).toBe(500);
    expect(parsed.body).toHaveLength(500);
  });

  it("never throws when the fetch itself rejects", async () => {
    const { fetchImpl, calls } = catalogFetch(() => jsonResponse({}));
    const rejecting = (async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/openapi.json")) return fetchImpl(url, init);
      throw new Error("boom");
    }) as unknown as typeof fetch;
    const definitions = await aiworkerToolDefinitions({ baseUrl: BASE_URL, fetchImpl: rejecting });
    expect(calls.length).toBeGreaterThan(0);
    const out = await mustDefinition(definitions, "aiworker_get_v1_token_info").execute({
      address: "0xabababababababababababababababababababab",
    });
    expect(JSON.parse(out)).toEqual({ error: "fetch_failed", body: "boom" });
  });
});

describe("path parameters", () => {
  const PATH_DOC = { paths: { "/v1/defi/protocol/{slug}": { get: { operationId: "defi_protocol", summary: "one protocol", parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }, { name: "verbose", in: "query", schema: { type: "boolean" } }], "x-payment-info": { price: { mode: "fixed", currency: "USD", amount: "0.010000" } } } } } };
  it("fills a {slug} path parameter from the input (required in the schema) and keeps it out of the query", async () => {
    const { fetchImpl, calls } = catalogFetch(() => jsonResponse({ tvl: 1 }));
    const [route] = routesFromOpenApi(PATH_DOC);
    expect(route?.inputSchema).toMatchObject({ required: ["slug"] });
    if (route === undefined) throw new Error("missing fixture route");
    const definitions = definitionsFromRoutes([route], { baseUrl: BASE_URL, fetchImpl });
    const out = await mustDefinition(definitions, "aiworker_defi_protocol").execute({ slug: "aave-v3", verbose: true });
    const api = apiCalls(calls);
    expect(api[0]?.url).toBe(`${BASE_URL}/v1/defi/protocol/aave-v3?verbose=true`);
    expect(JSON.parse(out)).toEqual({ tvl: 1 });
  });
});

describe("buildAiworkerTools", () => {
  it("maps definitions through the injected tool with exactly the documented fields", async () => {
    const seen: OpenAiToolDefinition[] = [];
    const { fetchImpl, calls } = catalogFetch(() => jsonResponse({ symbol: "USDC" }));
    const tool = (definition: OpenAiToolDefinition): OpenAiToolLike & { built: true } => {
      seen.push(definition);
      return { ...definition, built: true as const };
    };
    const tools = await buildAiworkerTools({ tool, baseUrl: BASE_URL, fetchImpl });
    expect(tools).toHaveLength(3);
    expect(seen).toHaveLength(3);
    for (const definition of seen) {
      expect(Object.keys(definition).sort()).toEqual(["description", "execute", "name", "parameters"]);
    }
    expect(tools.map((current) => current["name"]).sort()).toEqual([
      "aiworker_get_v1_token_info",
      "aiworker_post_v1_polymarket_backtest",
      "aiworker_post_v1_scrape_markdown",
    ]);
    for (const current of tools) expect(current["built"]).toBe(true);
    // The catalogue fetch plus one tool call: the built execute pays nothing here and returns the JSON.
    const tokenInfo = tools.find((current) => current["name"] === "aiworker_get_v1_token_info");
    expect(tokenInfo).toBeDefined();
    const execute = (tokenInfo as unknown as OpenAiToolDefinition)["execute"];
    const out = await execute({ address: "0xabababababababababababababababababababab" });
    expect(JSON.parse(out)).toEqual({ symbol: "USDC" });
    expect(apiCalls(calls)).toHaveLength(1);
  });

  it("honours maxPriceUsd and the routes allowlist, and refuses unknown routes", async () => {
    const { fetchImpl } = catalogFetch(() => jsonResponse({}));
    const capped = await buildAiworkerTools({ tool: (definition) => definition, baseUrl: BASE_URL, fetchImpl, maxPriceUsd: 0.05 });
    expect(capped.map((current) => current.name).sort()).toEqual([
      "aiworker_get_v1_token_info",
      "aiworker_post_v1_scrape_markdown",
    ]);
    const { fetchImpl: narrowedFetch } = catalogFetch(() => jsonResponse({}));
    const narrowed = await buildAiworkerTools({
      tool: (definition) => definition,
      baseUrl: BASE_URL,
      fetchImpl: narrowedFetch,
      routes: ["post_v1_scrape_markdown"],
    });
    expect(narrowed.map((current) => current.name)).toEqual(["aiworker_post_v1_scrape_markdown"]);
    const { fetchImpl: refusedFetch } = catalogFetch(() => jsonResponse({}));
    await expect(
      buildAiworkerTools({ tool: (definition) => definition, baseUrl: BASE_URL, fetchImpl: refusedFetch, routes: ["ghost"] }),
    ).rejects.toThrow("unknown route: ghost");
  });

  it("wires a privateKey payer that passes a first-call 200 straight through", async () => {
    const seen: string[] = [];
    const lowLevel = (async (url: unknown) => {
      seen.push(url instanceof Request ? url.url : String(url));
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;
    // The paying fetch is constructed, not settled: a 200 never signs.
    const paying = createPayingFetch({ privateKey: DUMMY_KEY, fetchImpl: lowLevel });
    const res = await paying(`${BASE_URL}/v1/token/info?address=0xabababababababababababababababababababab`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(seen).toEqual([`${BASE_URL}/v1/token/info?address=0xabababababababababababababababababababab`]);
  });
});
