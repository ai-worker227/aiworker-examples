import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { routesFromOpenApi } from "../src/catalog.js";

const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/openapi.json", import.meta.url)), "utf8"),
) as unknown;

type Doc = Record<string, unknown> & { paths: Record<string, Record<string, Record<string, unknown>>> };
function fixtureCopy(): Doc {
  return JSON.parse(JSON.stringify(FIXTURE)) as Doc;
}

describe("routesFromOpenApi", () => {
  it("yields the three paid routes with keys, methods, prices and input schemas", () => {
    const routes = routesFromOpenApi(FIXTURE);
    expect(routes).toHaveLength(3);

    const token = routes.find((r) => r.key === "tokenInfo");
    expect(token?.method).toBe("GET");
    expect(token?.path).toBe("/v1/token/info");
    expect(token?.priceUsd).toBeCloseTo(0.005, 10);
    const tokenProps = token?.inputSchema["properties"] as Record<string, unknown>;
    expect(Object.keys(tokenProps).sort()).toEqual(["address", "chain"]);
    expect(token?.inputSchema["required"]).toEqual(["address"]);

    const backtest = routes.find((r) => r.key === "polymarketBacktest");
    expect(backtest?.method).toBe("POST");
    expect(backtest?.path).toBe("/v1/polymarket/backtest");
    expect(backtest?.priceUsd).toBeCloseTo(0.25, 10);
    const backtestSchema = backtest?.inputSchema as { required?: string[] };
    expect(backtestSchema.required).toEqual(["rule"]);

    const scrape = routes.find((r) => r.key === "scrapeMarkdown");
    expect(scrape?.method).toBe("POST");
    expect(scrape?.path).toBe("/v1/scrape/markdown");
    expect(scrape?.priceUsd).toBeCloseTo(0.02, 10);
  });

  it("falls back to a slugified key when operationId is missing", () => {
    const doc = fixtureCopy();
    delete doc.paths["/v1/scrape/markdown"]?.["post"]?.["operationId"];
    const routes = routesFromOpenApi(doc);
    expect(routes.find((r) => r.path === "/v1/scrape/markdown")?.key).toBe("post_v1_scrape_markdown");
  });

  it("skips /health and malformed operations without throwing", () => {
    const doc = fixtureCopy();
    const paths = doc.paths as Record<string, unknown>;
    // Free route without x-payment-info, operations of the wrong shape, and junk.
    paths["/v1/broken"] = { get: null, post: "nope", put: { operationId: "ignored" } };
    paths["/v1/free"] = { get: { operationId: "free", summary: "free" } };
    paths["/v1/bad-price"] = {
      get: { operationId: "badPrice", "x-payment-info": { price: { amount: "not-a-number" } } },
    };
    expect(() => routesFromOpenApi(doc)).not.toThrow();
    const routes = routesFromOpenApi(doc);
    expect(routes.find((r) => r.path === "/health")).toBeUndefined();
    expect(routes.find((r) => r.key === "free")).toBeUndefined();
    expect(routes).toHaveLength(4);
    expect(routes.find((r) => r.key === "badPrice")?.priceUsd).toBeNull();
  });

  it("returns [] for a non-object document", () => {
    expect(routesFromOpenApi(null)).toEqual([]);
    expect(routesFromOpenApi({})).toEqual([]);
  });
});
