/** Minimal JSON-schema to zod converter: just enough for the catalogue's input schemas. */
import { z } from "zod";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asStringArray(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((e) => typeof e === "string") ? (v as string[]) : null;
}

function unionOf(members: z.ZodTypeAny[]): z.ZodTypeAny {
  const first = members[0];
  const second = members[1];
  if (first === undefined) return z.unknown();
  if (second === undefined) return first;
  return z.union([first, second, ...members.slice(2)]);
}

function stringFromEnum(values: unknown[]): z.ZodTypeAny {
  const strings = asStringArray(values);
  if (strings !== null && strings.length > 0) return z.enum(strings as [string, ...string[]]);
  const literals: z.ZodTypeAny[] = [];
  for (const v of values) {
    // JSON-schema enums are primitives in practice; anything else stays permissive.
    if (v === null || v === undefined || ["string", "number", "boolean", "bigint"].includes(typeof v)) {
      literals.push(z.literal(v as string & number & boolean & bigint & null & undefined));
    } else {
      return z.unknown();
    }
  }
  return unionOf(literals);
}

function withDescription(schema: z.ZodTypeAny, node: Record<string, unknown>): z.ZodTypeAny {
  return typeof node["description"] === "string" ? schema.describe(node["description"]) : schema;
}

function stringSchema(node: Record<string, unknown>): z.ZodTypeAny {
  let s = z.string();
  if (typeof node["minLength"] === "number") s = s.min(node["minLength"]);
  if (typeof node["maxLength"] === "number") s = s.max(node["maxLength"]);
  if (typeof node["pattern"] === "string") {
    try {
      s = s.regex(new RegExp(node["pattern"]));
    } catch {
      // An invalid pattern must not break tool construction; the check is dropped.
    }
  }
  return s;
}

function numberSchema(node: Record<string, unknown>, integer: boolean): z.ZodTypeAny {
  let s = integer ? z.number().int() : z.number();
  if (typeof node["minimum"] === "number") s = s.min(node["minimum"]);
  if (typeof node["maximum"] === "number") s = s.max(node["maximum"]);
  return s;
}

function objectSchema(node: Record<string, unknown>): z.ZodTypeAny {
  const properties = isRecord(node["properties"]) ? node["properties"] : {};
  const required = asStringArray(node["required"]) ?? [];
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, sub] of Object.entries(properties)) {
    const field = isRecord(sub) ? zodFromJsonSchema(sub) : z.unknown();
    shape[name] = required.includes(name) ? field : field.optional();
  }
  return z.object(shape);
}

/**
 * Converts a JSON-schema node to zod. Supports `object` with
 * `properties`/`required`, `string` with `enum`/`minLength`/`maxLength`/`pattern`,
 * `number`/`integer` with `minimum`/`maximum`, `boolean`, `array` of the above,
 * and `oneOf` as `z.union`; anything else becomes `z.unknown()`.
 */
export function zodFromJsonSchema(schema: Record<string, unknown>): z.ZodTypeAny {
  if (Array.isArray(schema["enum"])) return stringFromEnum(schema["enum"] as unknown[]);
  const oneOf = schema["oneOf"];
  if (Array.isArray(oneOf)) {
    const members = (oneOf as unknown[]).filter(isRecord).map(zodFromJsonSchema);
    if (members.length === 1) return withDescription(members[0] as z.ZodTypeAny, schema);
    return withDescription(unionOf(members), schema);
  }
  const type = schema["type"];
  if (type === "object") return withDescription(objectSchema(schema), schema);
  if (type === "string") return withDescription(stringSchema(schema), schema);
  if (type === "number") return withDescription(numberSchema(schema, false), schema);
  if (type === "integer") return withDescription(numberSchema(schema, true), schema);
  if (type === "boolean") return withDescription(z.boolean(), schema);
  if (type === "array") {
    const items = isRecord(schema["items"]) ? zodFromJsonSchema(schema["items"]) : z.unknown();
    return withDescription(z.array(items), schema);
  }
  return z.unknown();
}
