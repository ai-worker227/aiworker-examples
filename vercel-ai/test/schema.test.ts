import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodFromJsonSchema } from "../src/schema.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/openapi.json", import.meta.url));

function backtestSchema(): Record<string, unknown> {
  const doc = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
    paths: Record<string, Record<string, { requestBody: { content: { "application/json": { schema: Record<string, unknown> } } } }>>;
  };
  return doc["paths"]["/v1/polymarket/backtest"]?.["post"]?.["requestBody"]?.["content"]?.["application/json"]?.["schema"] ?? {};
}

describe("zodFromJsonSchema", () => {
  it("accepts and rejects per the fixture's backtest schema", () => {
    const schema = zodFromJsonSchema(backtestSchema());
    expect(schema.parse({ rule: "favorite_hold" })).toEqual({ rule: "favorite_hold" });
    expect(() => schema.parse({})).toThrow();
    expect(() => schema.parse({ rule: "martingale" })).toThrow();
    expect(schema.parse({ rule: "momentum", threshold: 0.5 })).toMatchObject({ threshold: 0.5 });
    expect(() => schema.parse({ rule: "momentum", threshold: 2 })).toThrow();
    expect(() => schema.parse({ rule: "momentum", threshold: -0.1 })).toThrow();
  });

  it("round-trips string enums", () => {
    const schema = zodFromJsonSchema({ type: "string", enum: ["base", "mainnet"] });
    expect(schema.parse("base")).toBe("base");
    expect(() => schema.parse("devnet")).toThrow();
  });

  it("round-trips arrays", () => {
    const schema = zodFromJsonSchema({ type: "array", items: { type: "string" } });
    expect(schema.parse(["a", "b"])).toEqual(["a", "b"]);
    expect(() => schema.parse(["a", 1])).toThrow();
    expect(() => schema.parse("nope")).toThrow();
  });

  it("round-trips oneOf as a union", () => {
    const schema = zodFromJsonSchema({ oneOf: [{ type: "number" }, { type: "string" }] });
    expect(schema.parse(0.5)).toBe(0.5);
    expect(schema.parse("anytime")).toBe("anytime");
    expect(() => schema.parse(true)).toThrow();
  });

  it("honours string/number bounds, integers, booleans and nested objects", () => {
    expect(() => zodFromJsonSchema({ type: "string", minLength: 2 }).parse("x")).toThrow();
    expect(zodFromJsonSchema({ type: "string", pattern: "^0x[0-9]+$" }).parse("0x123")).toBe("0x123");
    expect(() => zodFromJsonSchema({ type: "integer", minimum: 1, maximum: 3 }).parse(1.5)).toThrow();
    expect(zodFromJsonSchema({ type: "integer", minimum: 1, maximum: 3 }).parse(2)).toBe(2);
    expect(zodFromJsonSchema({ type: "boolean" }).parse(false)).toBe(false);
    const nested = zodFromJsonSchema({
      type: "object",
      required: ["a"],
      properties: { a: { type: "string" }, b: { type: "object", properties: { c: { type: "number" } } } },
    });
    expect(nested.parse({ a: "x" })).toEqual({ a: "x" });
    expect(() => nested.parse({})).toThrow();
  });

  it("degrades unknown shapes to z.unknown instead of throwing", () => {
    for (const shape of [{}, { type: "null" }, { type: 42 }, { oneOf: [] }, { oneOf: [null] }]) {
      const schema = zodFromJsonSchema(shape as Record<string, unknown>);
      expect(schema).toBeInstanceOf(z.ZodType);
      expect(schema.parse("anything")).toBe("anything");
    }
  });
});
