// Minimal JSON Schema → zod converter for the OpenAPI request shapes this
// package meets. Anything outside the supported subset becomes z.unknown()
// rather than failing, so a new route can never break tool construction.
import { z } from "zod";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function zodObject(schema: Record<string, unknown>): z.ZodTypeAny {
  const required = schema["required"];
  const requiredSet = new Set(
    Array.isArray(required) ? required.filter((entry): entry is string => typeof entry === "string") : [],
  );
  const shape: Record<string, z.ZodTypeAny> = {};
  const properties = schema["properties"];
  if (isRecord(properties)) {
    for (const [name, sub] of Object.entries(properties)) {
      const inner = isRecord(sub) ? zodFromJsonSchema(sub) : z.unknown();
      shape[name] = requiredSet.has(name) ? inner : inner.optional();
    }
  }
  return z.object(shape);
}

function zodString(schema: Record<string, unknown>): z.ZodTypeAny {
  const values = schema["enum"];
  if (Array.isArray(values)) {
    const options = values.filter((entry): entry is string => typeof entry === "string");
    if (options.length >= 1) return z.enum(options as [string, ...string[]]);
  }
  let out = z.string();
  const minLength = schema["minLength"];
  if (typeof minLength === "number" && Number.isInteger(minLength) && minLength >= 0) out = out.min(minLength);
  const maxLength = schema["maxLength"];
  if (typeof maxLength === "number" && Number.isInteger(maxLength) && maxLength >= 0) out = out.max(maxLength);
  const pattern = schema["pattern"];
  if (typeof pattern === "string" && pattern !== "") {
    try {
      out = out.regex(new RegExp(pattern));
    } catch {
      // A bad pattern must not break tool construction; keep the plain string.
    }
  }
  return out;
}

function zodNumber(schema: Record<string, unknown>, integer: boolean): z.ZodTypeAny {
  let out = integer ? z.number().int() : z.number();
  const minimum = schema["minimum"];
  if (typeof minimum === "number" && Number.isFinite(minimum)) out = out.min(minimum);
  const maximum = schema["maximum"];
  if (typeof maximum === "number" && Number.isFinite(maximum)) out = out.max(maximum);
  return out;
}

export function zodFromJsonSchema(schema: Record<string, unknown>): z.ZodTypeAny {
  const oneOf = schema["oneOf"];
  if (Array.isArray(oneOf)) {
    const options: z.ZodTypeAny[] = [];
    for (const option of oneOf) {
      if (isRecord(option)) options.push(zodFromJsonSchema(option));
    }
    const first = options[0];
    if (options.length === 1 && first !== undefined) return first;
    if (options.length >= 2) return z.union(options as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
    return z.unknown();
  }
  switch (schema["type"]) {
    case "object":
      return zodObject(schema);
    case "string":
      return zodString(schema);
    case "number":
      return zodNumber(schema, false);
    case "integer":
      return zodNumber(schema, true);
    case "boolean":
      return z.boolean();
    case "array": {
      const items = schema["items"];
      return z.array(isRecord(items) ? zodFromJsonSchema(items) : z.unknown());
    }
    default:
      return z.unknown();
  }
}
