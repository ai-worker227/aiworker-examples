// Paid routes → Mastra tools. One tool per route, built for the documented
// `createTool({ id, description, inputSchema, execute })` shape and handed
// to `new Agent({ tools })` as a `{ [id]: tool }` record.
//
// The framework is never imported here: `aiworkerToolDefinitions` returns
// plain definitions (id, description, zod input schema, execute over
// `{ context }`) and `buildAiworkerTools` maps them through the caller's
// injected `createTool` function. The buyer's paying fetch does the x402
// round trip, so each execute() costs exactly the route's quoted price.
import { z } from "zod";
import { fetchCatalog, resolvePath, type RouteInfo } from "./catalog.js";
import { createPayingFetch } from "./payer.js";
import { zodFromJsonSchema } from "./schema.js";
import type { MastraCreateToolLike, MastraToolDefinition } from "./types.js";

export const DEFAULT_BASE_URL = "https://aiworker.duckdns.org";

interface ErrorResult {
  error: number | string;
  body: unknown;
}

// Error bodies stay small and structured: parsed JSON when the server sent
// JSON, else plain text cut at 500 characters.
function errorBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text.slice(0, 500);
  }
}

// Success bodies come back as a JSON string when the server sent JSON,
// otherwise as the raw text.
function okBody(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text) as unknown);
  } catch {
    return text;
  }
}

function failure(status: number | string, text: string): string {
  return JSON.stringify({ error: status, body: errorBody(text) } satisfies ErrorResult);
}

// `routes` is a route-key allowlist (the catalogue `key`, e.g. `token_info`
// live or `get_v1_token_info` for slug keys): only listed routes become
// tools, and an unknown entry is refused rather than silently ignored.
function selectRoutes(routes: RouteInfo[], only?: string[]): RouteInfo[] {
  if (only === undefined) return routes;
  const known = new Set(routes.map((route) => route.key));
  for (const key of only) {
    if (!known.has(key)) throw new Error(`unknown route: ${key}`);
  }
  const wanted = new Set(only);
  return routes.filter((route) => wanted.has(route.key));
}

// Pure builder: paid routes → framework-free definitions. The request
// building, price cap and error contract mirror tools.ts in
// examples/vercel-ai exactly; only the interface differs (id/inputSchema
// and execute over `{ context }`).
export function definitionsFromRoutes(
  routes: RouteInfo[],
  o: { baseUrl: string; fetchImpl: typeof fetch; maxPriceUsd?: number; routes?: string[] },
): MastraToolDefinition[] {
  const baseUrl = o.baseUrl.replace(/\/+$/, "");
  const definitions: MastraToolDefinition[] = [];
  for (const route of selectRoutes(routes, o.routes)) {
    if (o.maxPriceUsd !== undefined && route.priceUsd !== null && route.priceUsd > o.maxPriceUsd) continue;
    const id = `aiworker_${route.key}`;
    // Tool ids only accept [a-zA-Z0-9_-]; drop anything else rather than
    // handing the model an unusable tool.
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) continue;
    const price = route.priceUsd === null ? "unknown" : String(route.priceUsd);
    const description =
      `${route.summary} ($${price} per call, USDC on Base, paid over x402)` +
      (route.description ? ` ${route.description.slice(0, 300)}` : "");
    const converted = zodFromJsonSchema(route.inputSchema);
    const inputSchema = converted instanceof z.ZodObject ? converted : z.object({ value: converted });
    const method = route.method;
    const path = route.path;
    const fetchImpl = o.fetchImpl;
    definitions.push({
      id,
      description,
      inputSchema,
      execute: async ({ context }: { context: Record<string, unknown> }): Promise<string> => {
        // `{slug}`-style path parameters are filled from the arguments first; the rest is the query or the body.
        const resolved = resolvePath(path, ((context ?? {}) as Record<string, unknown>));
        const args = resolved.rest;
        const target = `${baseUrl}${resolved.path}`;
        try {
          if (method === "GET") {
            const query = new URLSearchParams();
            for (const [field, value] of Object.entries(args)) {
              if (value === undefined || value === null) continue;
              if (Array.isArray(value)) {
                for (const entry of value) query.append(field, String(entry));
              } else {
                query.set(field, String(value));
              }
            }
            const suffix = query.toString();
            const response = await fetchImpl(suffix ? `${target}?${suffix}` : target, { method: "GET" });
            const text = await response.text();
            if (!response.ok) return failure(response.status, text);
            return okBody(text);
          }
          const response = await fetchImpl(target, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(args),
          });
          const text = await response.text();
          if (!response.ok) return failure(response.status, text);
          return okBody(text);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return JSON.stringify({ error: "fetch_failed", body: message.slice(0, 500) } satisfies ErrorResult);
        }
      },
    });
  }
  return definitions;
}

// Catalogue (free endpoint, plain fetch) → definitions. Pass `fetchImpl` in
// tests to serve a fixture catalogue; `routes` narrows to a key allowlist.
export async function aiworkerToolDefinitions(o?: {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxPriceUsd?: number;
  routes?: string[];
}): Promise<MastraToolDefinition[]> {
  const baseUrl = o?.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl = o?.fetchImpl ?? fetch;
  const routes = await fetchCatalog(baseUrl, fetchImpl);
  return definitionsFromRoutes(routes, { baseUrl, fetchImpl, maxPriceUsd: o?.maxPriceUsd, routes: o?.routes });
}

// Catalogue + paying fetch + the framework's `createTool()` injected by the
// caller, returned as the `{ [id]: tool }` record `new Agent({ tools })`
// takes. Without `privateKey` there is no payer: a 402 comes back as the
// structured `{"error": 402, …}` string instead of settling.
export async function buildAiworkerTools<TTool>(o: {
  createTool: MastraCreateToolLike<TTool>;
  baseUrl?: string;
  privateKey?: `0x${string}`;
  chain?: "base" | "baseSepolia";
  maxPriceUsd?: number;
  fetchImpl?: typeof fetch;
  routes?: string[];
}): Promise<Record<string, TTool>> {
  const baseUrl = o.baseUrl ?? DEFAULT_BASE_URL;
  const lowLevel = o.fetchImpl ?? fetch;
  const routes = await fetchCatalog(baseUrl, lowLevel);
  const paying =
    o.privateKey !== undefined
      ? createPayingFetch({ privateKey: o.privateKey, chain: o.chain, fetchImpl: lowLevel })
      : lowLevel;
  const tools: Record<string, TTool> = {};
  for (const definition of definitionsFromRoutes(routes, {
    baseUrl,
    fetchImpl: paying,
    maxPriceUsd: o.maxPriceUsd,
    routes: o.routes,
  })) {
    tools[definition.id] = o.createTool({
      id: definition.id,
      description: definition.description,
      inputSchema: definition.inputSchema,
      execute: definition.execute,
    });
  }
  return tools;
}
