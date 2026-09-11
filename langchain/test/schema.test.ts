import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { routesFromOpenApi } from "../src/catalog.js";
import { zodFromJsonSchema } from "../src/schema.js";

const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/openapi.json", import.meta.url)), "utf8"),
) as unknown;

function backtestSchema() {
  const route = routesFromOpenApi(FIXTURE).find((r) => r.key === "polymarketBacktest");
  if (!route) throw new Error("fixture missing polymarketBacktest");
  return zodFromJsonSchema(route.inputSchema);
}

describe("zodFromJsonSchema on the backtest schema", () => {
  it("accepts a valid rule and rejects an unknown one", () => {
    const schema = backtestSchema();
    expect(schema.safeParse({ rule: "favorite_hold" }).success).toBe(true);
    expect(schema.safeParse({ rule: "no_such_rule" }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("rejects an out-of-range threshold", () => {
    const schema = backtestSchema();
    expect(schema.safeParse({ rule: "favorite_hold", threshold: 0.5 }).success).toBe(true);
    expect(schema.safeParse({ rule: "favorite_hold", threshold: 2 }).success).toBe(false);
    expect(schema.safeParse({ rule: "favorite_hold", threshold: -0.1 }).success).toBe(false);
  });

  it("round-trips string enums, arrays and oneOf", () => {
    const schema = backtestSchema();
    // Array of strings.
    expect(schema.safeParse({ rule: "favorite_hold", markets: ["a", "b"] }).success).toBe(true);
    expect(schema.safeParse({ rule: "favorite_hold", markets: [42] }).success).toBe(false);
    // oneOf string | integer(1..365).
    expect(schema.safeParse({ rule: "favorite_hold", window: "weekly" }).success).toBe(true);
    expect(schema.safeParse({ rule: "favorite_hold", window: 30 }).success).toBe(true);
    expect(schema.safeParse({ rule: "favorite_hold", window: 0 }).success).toBe(false);
    expect(schema.safeParse({ rule: "favorite_hold", window: true }).success).toBe(false);
  });

  it("maps primitives and falls back to unknown", () => {
    expect(zodFromJsonSchema({ type: "boolean" }).safeParse(true).success).toBe(true);
    expect(zodFromJsonSchema({ type: "boolean" }).safeParse("yes").success).toBe(false);
    expect(zodFromJsonSchema({ type: "integer", minimum: 1 }).safeParse(1.5).success).toBe(false);
    expect(zodFromJsonSchema({ type: "string", minLength: 2 }).safeParse("a").success).toBe(false);
    // Anything unrecognised stays permissive instead of throwing.
    expect(zodFromJsonSchema({ type: "null" }).safeParse(null).success).toBe(true);
    expect(zodFromJsonSchema({}).safeParse(42).success).toBe(true);
  });
});
