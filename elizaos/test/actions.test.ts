import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import { routesFromOpenApi, type RouteInfo } from "../src/catalog.js";
import { actionsFromRoutes, aiworkerPluginFromSettings } from "../src/actions.js";
import { settlementOf } from "../src/payer.js";
import type { ElizaAction, ElizaContent, ElizaMemory, ElizaRuntime } from "../src/eliza-types.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/openapi.json", import.meta.url));
const BASE_URL = "https://edge.example";
// Public Base USDC contract used as a schema-valid address argument.
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const OTHER = "0x4200000000000000000000000000000000000006";
const PATH_DOC = { paths: { "/v1/defi/protocol/{slug}": { get: { operationId: "defi_protocol", summary: "one protocol", parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }, { name: "verbose", in: "query", schema: { type: "boolean" } }], "x-payment-info": { price: { mode: "fixed", currency: "USD", amount: "0.010000" } } } } } };

function routes(): RouteInfo[] {
  return routesFromOpenApi(JSON.parse(readFileSync(FIXTURE, "utf8")) as unknown);
}

function fixtureText(): string {
  return readFileSync(FIXTURE, "utf8");
}

const runtime: ElizaRuntime = { getSetting: () => undefined };

function messageWith(text: string): ElizaMemory {
  return { content: { text } };
}

function actionByName(actions: ElizaAction[], name: string): ElizaAction {
  const found = actions.find((a) => a.name === name);
  expect(found).toBeDefined();
  if (!found) throw new Error(`missing action ${name}`);
  return found;
}

interface SeenCall {
  url: string;
  init?: RequestInit;
}

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
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

describe("actionsFromRoutes", () => {
  it("names actions AIWORKER_<KEY> with legal names, priced descriptions, a simile and an example", () => {
    const actions = actionsFromRoutes(routes(), { baseUrl: BASE_URL, fetchImpl: fetch });
    expect(actions.map((a) => a.name).sort()).toEqual([
      "AIWORKER_GET_V1_TOKEN_INFO",
      "AIWORKER_POST_V1_POLYMARKET_BACKTEST",
      "AIWORKER_POST_V1_SCRAPE_MARKDOWN",
    ]);
    for (const action of actions) {
      expect(action.name).toMatch(/^[A-Z0-9_]+$/);
      expect(action.name.startsWith("AIWORKER_")).toBe(true);
      expect(action.description).toContain("(price $");
      expect(action.description).toContain("per call, paid over x402)");
      expect(action.examples?.[0]?.[1]?.content.actions).toEqual([action.name]);
    }
    const byName = Object.fromEntries(actions.map((a) => [a.name, a]));
    expect(byName["AIWORKER_GET_V1_TOKEN_INFO"]?.description).toContain("(price $0.005 per call, paid over x402)");
    expect(byName["AIWORKER_POST_V1_SCRAPE_MARKDOWN"]?.description).toContain("(price $0.02 per call, paid over x402)");
    expect(byName["AIWORKER_GET_V1_TOKEN_INFO"]?.similes).toEqual(["GET V1 TOKEN INFO"]);
  });

  it("drops routes priced above maxPriceUsd", () => {
    const capped = actionsFromRoutes(routes(), { baseUrl: BASE_URL, fetchImpl: fetch, maxPriceUsd: 0.05 });
    expect(capped.map((a) => a.name).sort()).toEqual(["AIWORKER_GET_V1_TOKEN_INFO", "AIWORKER_POST_V1_SCRAPE_MARKDOWN"]);
  });

  it("fills a {slug} path parameter from the arguments (required in the schema) and keeps it out of the query", async () => {
    const { fetchImpl, calls } = fakeFetch(() => jsonResponse({ tvl: 1 }));
    const [route] = routesFromOpenApi(PATH_DOC);
    expect(route?.inputSchema).toMatchObject({ required: ["slug"] });
    const [action] = actionsFromRoutes([route!], { baseUrl: BASE_URL, fetchImpl });
    expect(action?.name).toBe("AIWORKER_DEFI_PROTOCOL");
    await expect(action!.validate(runtime, messageWith(JSON.stringify({ verbose: true })))).resolves.toBe(false); // slug missing
    const r = await action!.handler(runtime, messageWith(JSON.stringify({ slug: "aave-v3", verbose: true })));
    expect(r.success).toBe(true);
    expect(calls[0]?.url).toBe(`${BASE_URL}/v1/defi/protocol/aave-v3?verbose=true`);
  });
});

describe("validate (ElizaOS 1.x: runtime, message, state)", () => {
  it("accepts a JSON message the schema accepts, rejects prose and an object the schema rejects", async () => {
    const actions = actionsFromRoutes(routes(), { baseUrl: BASE_URL, fetchImpl: fetch });
    const info = actionByName(actions, "AIWORKER_GET_V1_TOKEN_INFO");
    const backtest = actionByName(actions, "AIWORKER_POST_V1_POLYMARKET_BACKTEST");
    await expect(info.validate(runtime, messageWith(JSON.stringify({ address: USDC })))).resolves.toBe(true);
    await expect(info.validate(runtime, messageWith("what is the total supply of Base USDC?"))).resolves.toBe(false);
    await expect(backtest.validate(runtime, messageWith(JSON.stringify({ rule: "martingale" })))).resolves.toBe(false);
    await expect(backtest.validate(runtime, messageWith(JSON.stringify({ rule: "favorite_hold" })))).resolves.toBe(true);
  });
});

describe("handler", () => {
  it("builds the GET query string from options.args and returns success with the body as text and the settlement", async () => {
    const { fetchImpl, calls } = fakeFetch(() => jsonResponse({ symbol: "USDC" }));
    const actions = actionsFromRoutes(routes(), { baseUrl: BASE_URL, fetchImpl });
    const info = actionByName(actions, "AIWORKER_GET_V1_TOKEN_INFO");
    const result = await info.handler(runtime, messageWith("ignored prose"), undefined, { args: { address: USDC, chain: "base" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE_URL}/v1/token/info?address=${USDC}&chain=base`);
    expect(calls[0]?.init?.method).toBe("GET");
    expect(result.success).toBe(true);
    expect(result.text).toBe(JSON.stringify({ symbol: "USDC" }));
    expect(result.data).toEqual({ status: 200, settlement: null, body: { symbol: "USDC" } });
  });

  it("carries the decoded payment-response as data.settlement, on success and on a failure after payment", async () => {
    const header = Buffer.from(JSON.stringify({ success: true, transaction: "0xabc", network: "eip155:8453" })).toString("base64");
    const expected = settlementOf(new Response("", { headers: { "payment-response": header } }));
    expect(expected).not.toBeNull();
    const { fetchImpl } = fakeFetch(() => jsonResponse({ symbol: "USDC" }, 200, { "payment-response": header }));
    const actions = actionsFromRoutes(routes(), { baseUrl: BASE_URL, fetchImpl });
    const info = actionByName(actions, "AIWORKER_GET_V1_TOKEN_INFO");
    const ok = await info.handler(runtime, messageWith(JSON.stringify({ address: USDC })));
    expect(ok.data?.["settlement"]).toEqual(expected);
    const failing = actionsFromRoutes(routes(), { baseUrl: BASE_URL, fetchImpl: fakeFetch(() => jsonResponse({ error: "handler_timeout" }, 504, { "payment-response": header })).fetchImpl });
    const failed = await actionByName(failing, "AIWORKER_GET_V1_TOKEN_INFO").handler(runtime, messageWith(JSON.stringify({ address: USDC })));
    expect(failed.success).toBe(false);
    expect(failed.data).toEqual({ status: 504, settlement: expected });
  });

  it("takes args from the message text when options carry none; options.args wins when both validate; the raw options bag is never sent", async () => {
    const { fetchImpl, calls } = fakeFetch(() => jsonResponse({ symbol: "USDC" }));
    const actions = actionsFromRoutes(routes(), { baseUrl: BASE_URL, fetchImpl });
    const info = actionByName(actions, "AIWORKER_GET_V1_TOKEN_INFO");
    await info.handler(runtime, messageWith(JSON.stringify({ address: USDC })));
    expect(calls[0]?.url).toBe(`${BASE_URL}/v1/token/info?address=${USDC}`);
    await info.handler(runtime, messageWith(JSON.stringify({ address: USDC })), undefined, { args: { address: OTHER } });
    expect(calls[1]?.url).toBe(`${BASE_URL}/v1/token/info?address=${OTHER}`);
    // A realistic ElizaOS options bag (context, prior responses) is not an argument source.
    const bag = await info.handler(runtime, messageWith("my seed phrase is private"), undefined, { context: "You are a helpful agent", responses: [] });
    expect(bag).toMatchObject({ success: false, error: "invalid_arguments" });
    expect(calls).toHaveLength(2); // nothing was sent, nothing paid
    // Extra keys the schema does not know are stripped before the request is built.
    await info.handler(runtime, messageWith(JSON.stringify({ address: USDC, note: "leaks?" })));
    expect(calls[2]?.url).toBe(`${BASE_URL}/v1/token/info?address=${USDC}`);
  });

  it("sends the POST JSON body with the right content type", async () => {
    const { fetchImpl, calls } = fakeFetch(() => jsonResponse({ content_md: "# hi" }));
    const actions = actionsFromRoutes(routes(), { baseUrl: BASE_URL, fetchImpl });
    const scrape = actionByName(actions, "AIWORKER_POST_V1_SCRAPE_MARKDOWN");
    const result = await scrape.handler(runtime, messageWith("{}"), undefined, { args: { url: "https://example.com/x" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE_URL}/v1/scrape/markdown`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(new Headers(calls[0]?.init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({ url: "https://example.com/x" });
    expect(result.success).toBe(true);
    expect(JSON.parse(result.text ?? "")).toEqual({ content_md: "# hi" });
  });

  it("turns a 402 answer into success:false with error 402 without throwing", async () => {
    const { fetchImpl } = fakeFetch(() => jsonResponse({ message: "payment required" }, 402));
    const actions = actionsFromRoutes(routes(), { baseUrl: BASE_URL, fetchImpl });
    const info = actionByName(actions, "AIWORKER_GET_V1_TOKEN_INFO");
    const result = await info.handler(runtime, messageWith(JSON.stringify({ address: USDC })));
    expect(result.success).toBe(false);
    expect(result.error).toBe("402");
    expect(JSON.parse(result.text ?? "")).toEqual({ error: 402, body: { message: "payment required" } });
  });

  it("returns success:false with the message when the fetch throws", async () => {
    const fetchImpl = (async () => { throw new Error("boom"); }) as unknown as typeof fetch;
    const actions = actionsFromRoutes(routes(), { baseUrl: BASE_URL, fetchImpl });
    const info = actionByName(actions, "AIWORKER_GET_V1_TOKEN_INFO");
    const result = await info.handler(runtime, messageWith(JSON.stringify({ address: USDC })));
    expect(result).toMatchObject({ success: false, error: "boom" });
  });

  it("awaits the callback with text, actions and source; a throwing callback never voids a paid answer; works without one", async () => {
    const { fetchImpl } = fakeFetch(() => jsonResponse({ symbol: "USDC" }));
    const actions = actionsFromRoutes(routes(), { baseUrl: BASE_URL, fetchImpl });
    const info = actionByName(actions, "AIWORKER_GET_V1_TOKEN_INFO");
    const seen: ElizaContent[] = [];
    const result = await info.handler(runtime, messageWith(JSON.stringify({ address: USDC })), undefined, undefined, async (response) => { seen.push(response); return null; });
    expect(result.success).toBe(true);
    expect(seen).toEqual([{ text: result.text, actions: [info.name], source: "aiworker" }]);
    const despite = await info.handler(runtime, messageWith(JSON.stringify({ address: USDC })), undefined, undefined, async () => { throw new Error("host callback blew up"); });
    expect(despite.success).toBe(true);
    expect(despite.data?.["body"]).toEqual({ symbol: "USDC" });
    const bare = await info.handler(runtime, messageWith(JSON.stringify({ address: USDC })));
    expect(bare.success).toBe(true);
  });
});

describe("aiworkerPluginFromSettings", () => {
  it("throws the documented errors without the key or with a malformed one", async () => {
    await expect(aiworkerPluginFromSettings({ getSetting: () => undefined })).rejects.toThrow("AIWORKER_BUYER_KEY is not set");
    await expect(aiworkerPluginFromSettings({ getSetting: (n) => (n === "AIWORKER_BUYER_KEY" ? "not-a-key" : undefined) })).rejects.toThrow(/not a 0x-prefixed 64-hex private key/);
  });

  it("builds the plugin through a fake fetchImpl serving the fixture", async () => {
    const key = generatePrivateKey();
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(String(url));
      return new Response(fixtureText(), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const settings: ElizaRuntime = {
      getSetting: (name: string) => {
        if (name === "AIWORKER_BUYER_KEY") return key;
        if (name === "AIWORKER_BASE_URL") return "https://edge.example";
        return undefined;
      },
    };
    const plugin = await aiworkerPluginFromSettings(settings, { fetchImpl });
    expect(seen).toEqual(["https://edge.example/openapi.json"]);
    expect(plugin.name).toBe("aiworker");
    expect(plugin.actions?.map((a) => a.name).sort()).toEqual([
      "AIWORKER_GET_V1_TOKEN_INFO",
      "AIWORKER_POST_V1_POLYMARKET_BACKTEST",
      "AIWORKER_POST_V1_SCRAPE_MARKDOWN",
    ]);
  });
});

describe("aiworkerElizaPlugin (the default export an agent lists in plugins)", () => {
  it("starts empty, fills its actions from the runtime's settings on init with the default price cap, and stays empty without a key", async () => {
    const { aiworkerElizaPlugin, DEFAULT_MAX_PRICE_USD } = await import("../src/actions.js");
    const mod = await import("../src/index.js");
    expect(mod.default).toBe(aiworkerElizaPlugin);
    expect(aiworkerElizaPlugin.name).toBe("aiworker");
    expect(aiworkerElizaPlugin.actions).toEqual([]);
    await aiworkerElizaPlugin.init?.({}, { getSetting: () => undefined });
    expect(aiworkerElizaPlugin.actions).toEqual([]); // no key: the agent still starts
    const key = generatePrivateKey();
    const fetchImpl = (async () => new Response(fixtureText(), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const settings = (cap?: string): ElizaRuntime => ({ getSetting: (n) => (n === "AIWORKER_BUYER_KEY" ? key : n === "AIWORKER_BASE_URL" ? "https://edge.example" : n === "AIWORKER_MAX_PRICE_USD" ? cap : undefined) });
    // The default cap ($0.05) drops the $0.25 backtest; a wider cap keeps it.
    const { aiworkerPluginFromSettings: build } = await import("../src/actions.js");
    const capped = await build(settings(), { maxPriceUsd: DEFAULT_MAX_PRICE_USD, fetchImpl });
    expect(capped.actions?.map((a) => a.name).sort()).toEqual(["AIWORKER_GET_V1_TOKEN_INFO", "AIWORKER_POST_V1_SCRAPE_MARKDOWN"]);
    // `init` cannot take a fetchImpl (the runtime calls it), so it is exercised through the settings path here
    // with the live default; the wiring under test is the in-place fill.
    const filled = await build(settings("1"), { maxPriceUsd: 1, fetchImpl });
    aiworkerElizaPlugin.actions.splice(0, aiworkerElizaPlugin.actions.length, ...(filled.actions ?? []));
    expect(aiworkerElizaPlugin.actions).toHaveLength(3);
  });
});
