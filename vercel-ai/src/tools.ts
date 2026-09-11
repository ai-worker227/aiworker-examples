// Paid routes → Vercel AI SDK tools. One tool per route, built with
// tool({ description, inputSchema, execute }) from the installed ai v7
// (whose schema field is `inputSchema`, re-exported from
// @ai-sdk/provider-utils). The buyer's paying fetch does the x402 round trip,
// so each execute() costs exactly the route's quoted price.
import { tool, type Tool } from "ai";
import { z } from "zod";
import { fetchCatalog, resolvePath, type RouteInfo } from "./catalog.js";
import { createPayingFetch } from "./payer.js";
import { zodFromJsonSchema } from "./schema.js";

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

export function toolsFromRoutes(
  routes: RouteInfo[],
  o: { baseUrl: string; fetchImpl: typeof fetch; maxPriceUsd?: number },
): Record<string, Tool> {
  const baseUrl = o.baseUrl.replace(/\/+$/, "");
  const tools: Record<string, Tool> = {};
  for (const route of routes) {
    if (o.maxPriceUsd !== undefined && route.priceUsd !== null && route.priceUsd > o.maxPriceUsd) continue;
    const name = `aiworker_${route.key}`;
    // The SDK only accepts [a-zA-Z0-9_-] tool names; drop anything else
    // rather than handing the model an unusable tool.
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) continue;
    const price = route.priceUsd === null ? "unknown" : String(route.priceUsd);
    const description =
      `${route.summary} (price $${price} per call, paid over x402)` +
      (route.description ? ` ${route.description.slice(0, 300)}` : "");
    const converted = zodFromJsonSchema(route.inputSchema);
    const inputSchema = converted instanceof z.ZodObject ? converted : z.object({ value: converted });
    const method = route.method;
    const path = route.path;
    const fetchImpl = o.fetchImpl;
    tools[name] = tool({
      description,
      inputSchema,
      execute: async (args): Promise<string> => {
        // `{slug}`-style path parameters are filled from the arguments first; the rest is the query or the body.
        const resolved = resolvePath(path, (args ?? {}) as Record<string, unknown>);
        const input = resolved.rest;
        const target = `${baseUrl}${resolved.path}`;
        try {
          if (method === "GET") {
            const query = new URLSearchParams();
            for (const [field, value] of Object.entries(input)) {
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
            body: JSON.stringify(input),
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
  return tools;
}

// Catalogue (free endpoint, plain fetch) + paying fetch + tools.
export async function aiworkerTools(o: {
  baseUrl?: string;
  privateKey: `0x${string}`;
  chain?: "base" | "baseSepolia";
  maxPriceUsd?: number;
  fetchImpl?: typeof fetch;
}): Promise<Record<string, Tool>> {
  const baseUrl = o.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl = o.fetchImpl ?? fetch;
  const routes = await fetchCatalog(baseUrl, fetchImpl);
  const paying = createPayingFetch({ privateKey: o.privateKey, chain: o.chain, fetchImpl });
  return toolsFromRoutes(routes, { baseUrl, fetchImpl: paying, maxPriceUsd: o.maxPriceUsd });
}
