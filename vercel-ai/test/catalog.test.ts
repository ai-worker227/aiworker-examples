import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fetchCatalog, routesFromOpenApi } from "../src/catalog.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/openapi.json", import.meta.url));

function doc(): Record<string, unknown> {
  return JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, unknown>;
}

describe("routesFromOpenApi", () => {
  it("yields the fixture's three paid routes with keys, methods and prices", () => {
    const routes = routesFromOpenApi(doc());
    expect(routes).toHaveLength(3);
    const byKey = Object.fromEntries(routes.map((r) => [r.key, r]));
    expect(Object.keys(byKey).sort()).toEqual([
      "get_v1_token_info",
      "post_v1_polymarket_backtest",
      "post_v1_scrape_markdown",
    ]);
    expect(byKey["get_v1_token_info"]?.method).toBe("GET");
    expect(byKey["get_v1_token_info"]?.path).toBe("/v1/token/info");
    expect(byKey["get_v1_token_info"]?.priceUsd).toBeCloseTo(0.005, 6);
    expect(byKey["post_v1_polymarket_backtest"]?.method).toBe("POST");
    expect(byKey["post_v1_polymarket_backtest"]?.priceUsd).toBeCloseTo(0.25, 6);
    expect(byKey["post_v1_scrape_markdown"]?.priceUsd).toBeCloseTo(0.02, 6);
    for (const route of routes) {
      expect(route.summary.length).toBeGreaterThan(0);
      expect(route.description.length).toBeGreaterThan(0);
    }
  });

  it("builds input schemas from query parameters (GET) and JSON bodies (POST)", () => {
    const routes = routesFromOpenApi(doc());
    const byKey = Object.fromEntries(routes.map((r) => [r.key, r]));
    const info = byKey["get_v1_token_info"]?.inputSchema as {
      type: string;
      properties: Record<string, { type: string }>;
      required: string[];
    };
    expect(info.type).toBe("object");
    expect(info.properties["address"]?.type).toBe("string");
    expect(info.properties["chain"]?.type).toBe("string");
    expect(info.required).toContain("address");
    expect(info.required).not.toContain("chain");
    const backtest = byKey["post_v1_polymarket_backtest"]?.inputSchema as {
      type: string;
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(backtest.type).toBe("object");
    expect(backtest.required).toEqual(["rule"]);
    expect(Object.keys(backtest.properties).sort()).toEqual(["markets", "rule", "stop", "threshold"]);
  });

  it("skips GET /health", () => {
    const routes = routesFromOpenApi(doc());
    expect(routes.some((r) => r.path === "/health")).toBe(false);
  });

  it("skips malformed operations and documents without throwing", () => {
    const broken = doc() as { paths: Record<string, unknown> };
    broken["paths"]["/v1/broken"] = {
      get: null,
      post: "not-an-operation",
      put: { summary: "wrong method, ignored" },
    };
    broken["paths"]["/v1/free"] = { get: { summary: "no x-payment-info, skipped" } };
    broken["paths"]["/v1/empty"] = null;
    expect(routesFromOpenApi(broken)).toHaveLength(3);
    expect(routesFromOpenApi(null)).toEqual([]);
    expect(routesFromOpenApi("junk")).toEqual([]);
    expect(routesFromOpenApi({})).toEqual([]);
    expect(routesFromOpenApi({ paths: null })).toEqual([]);
  });

  it("prefers operationId for the key when present", () => {
    const withId = doc() as { paths: Record<string, Record<string, Record<string, unknown>>> };
    const op = withId["paths"]["/v1/scrape/markdown"]?.["post"];
    expect(op).toBeDefined();
    if (op) op["operationId"] = "scrapeMarkdown";
    const routes = routesFromOpenApi(withId);
    expect(routes.some((r) => r.key === "scrapeMarkdown")).toBe(true);
    expect(routes.some((r) => r.key === "post_v1_scrape_markdown")).toBe(false);
  });
});

describe("fetchCatalog", () => {
  it("GETs ${baseUrl}/openapi.json and converts it", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(url);
      return new Response(readFileSync(FIXTURE, "utf8"), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const routes = await fetchCatalog("https://edge.example/", fetchImpl);
    expect(seen).toEqual(["https://edge.example/openapi.json"]);
    expect(routes).toHaveLength(3);
  });
});
