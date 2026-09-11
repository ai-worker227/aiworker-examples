/** One LangChain tool per paid route, paying over x402 with the buyer's wallet. */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { fetchCatalog, resolvePath, type RouteInfo } from "./catalog.js";
import { createPayingFetch } from "./payer.js";
import { zodFromJsonSchema } from "./schema.js";

export const DEFAULT_BASE_URL = "https://aiworker.duckdns.org";

/** `operationId`s may contain dots or slashes; LangChain names must match `^[a-zA-Z0-9_-]+$`. */
export function toolNameFor(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `aiworker_${safe.length > 0 ? safe : "route"}`;
}

export function priceText(priceUsd: number | null): string {
  return priceUsd === null ? "unknown" : String(priceUsd);
}

function objectSchemaFor(route: RouteInfo): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const converted = zodFromJsonSchema(route.inputSchema);
  if (converted instanceof z.ZodObject) return converted as z.ZodObject<Record<string, z.ZodTypeAny>>;
  return z.object({ input: converted });
}

function appendQuery(url: string, args: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const e of v) params.append(k, typeof e === "object" ? JSON.stringify(e) : String(e));
    } else {
      params.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    }
  }
  const qs = params.toString();
  return qs.length > 0 ? `${url}?${qs}` : url;
}

/**
 * Builds one `DynamicStructuredTool` per route. The tool's `func` performs the
 * HTTP call through `fetchImpl` (the paying fetch) and always resolves to a
 * string: the response body as a JSON string, or a
 * `{"error": <status>, "body": <text>}` string on non-2xx — never throws.
 */
export function toolsFromRoutes(
  routes: RouteInfo[],
  o: { baseUrl: string; fetchImpl: typeof fetch; maxPriceUsd?: number },
): DynamicStructuredTool[] {
  const tools: DynamicStructuredTool[] = [];
  for (const route of routes) {
    if (o.maxPriceUsd !== undefined && route.priceUsd !== null && route.priceUsd > o.maxPriceUsd) continue;
    const base = o.baseUrl.replace(/\/+$/, "");
    const schema = objectSchemaFor(route);
    const description =
      `${route.summary} (price $${priceText(route.priceUsd)} per call, paid over x402)` +
      (route.description.length > 0 ? ` ${route.description.slice(0, 300)}` : "");
    const tool = new DynamicStructuredTool({
      name: toolNameFor(route.key),
      description,
      schema,
      func: async (input: Record<string, unknown>): Promise<string> => {
        try {
          // `{slug}`-style path parameters are filled from the arguments first; the rest is the query or the body.
          const resolved = resolvePath(route.path, (input ?? {}) as Record<string, unknown>);
          const args = resolved.rest;
          let url = `${base}${resolved.path}`;
          let init: RequestInit;
          if (route.method === "GET") {
            url = appendQuery(url, args);
            init = { method: "GET" };
          } else {
            init = {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(args),
            };
          }
          const res = await o.fetchImpl(url, init);
          const text = await res.text();
          if (!res.ok) return JSON.stringify({ error: res.status, body: text.slice(0, 500) });
          return text;
        } catch (err) {
          return JSON.stringify({ error: "fetch_failed", body: String(err).slice(0, 500) });
        }
      },
    });
    tools.push(tool);
  }
  return tools;
}

/** Fetches the catalogue and returns the priced tools, ready to hand to an agent. */
export async function aiworkerTools(o: {
  baseUrl?: string;
  privateKey: `0x${string}`;
  chain?: "base" | "baseSepolia";
  maxPriceUsd?: number;
  fetchImpl?: typeof fetch;
}): Promise<DynamicStructuredTool[]> {
  const baseUrl = o.baseUrl ?? DEFAULT_BASE_URL;
  const lowLevel = o.fetchImpl ?? fetch;
  const routes = await fetchCatalog(baseUrl, lowLevel);
  const paying = createPayingFetch({ privateKey: o.privateKey, chain: o.chain, fetchImpl: lowLevel });
  return toolsFromRoutes(routes, { baseUrl, fetchImpl: paying, maxPriceUsd: o.maxPriceUsd });
}
