/** Turns the public OpenAPI catalogue into the paid-route list the tools are built from. */

export interface RouteInfo {
  key: string;
  method: "GET" | "POST";
  path: string;
  summary: string;
  description: string;
  priceUsd: number | null;
  inputSchema: Record<string, unknown>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** `<method>_<path>` slug: `POST /v1/polymarket/backtest` -> `post_v1_polymarket_backtest`. */
export function slugFor(method: string, path: string): string {
  return `${method.toLowerCase()}_${path
    .replace(/[{]/g, "")
    .replace(/[}]/g, "")
    .split("/")
    .filter(Boolean)
    .join("_")}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_");
}

function priceFromPaymentInfo(op: Record<string, unknown>): number | null {
  const info = op["x-payment-info"];
  if (!isRecord(info)) return null;
  const price = info["price"];
  if (!isRecord(price)) return null;
  const amount = price["amount"];
  if (typeof amount !== "string" && typeof amount !== "number") return null;
  const n = typeof amount === "number" ? amount : Number(amount);
  return Number.isFinite(n) ? n : null;
}

/** Query parameters become an object schema; path params stay out (routes here use query only). */
function schemaFromParameters(params: unknown): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  if (!Array.isArray(params)) return { type: "object", properties };
  for (const p of params) {
    if (!isRecord(p) || p["in"] !== "query" || typeof p["name"] !== "string") continue;
    const schema = isRecord(p["schema"]) ? p["schema"] : { type: "string" };
    properties[p["name"]] = schema;
    if (p["required"] === true) required.push(p["name"]);
  }
  const out: Record<string, unknown> = { type: "object", properties };
  if (required.length > 0) out["required"] = required;
  return out;
}

function schemaFromRequestBody(body: unknown): Record<string, unknown> | null {
  if (!isRecord(body)) return null;
  const content = body["content"];
  if (!isRecord(content)) return null;
  const json = content["application/json"];
  if (!isRecord(json)) return null;
  const schema = json["schema"];
  return isRecord(schema) ? schema : null;
}

function routeFromOperation(method: string, path: string, op: unknown): RouteInfo | null {
  if (!isRecord(op)) return null;
  if (!("x-payment-info" in op)) return null;
  const upper = method.toUpperCase();
  if (upper !== "GET" && upper !== "POST") return null;
  const summary = typeof op["summary"] === "string" ? op["summary"] : "";
  const description = typeof op["description"] === "string" ? op["description"] : "";
  const operationId = typeof op["operationId"] === "string" && op["operationId"].length > 0 ? op["operationId"] : null;
  const inputSchema =
    upper === "GET" ? schemaFromParameters(op["parameters"]) : (schemaFromRequestBody(op["requestBody"]) ?? { type: "object" });
  return {
    key: operationId ?? slugFor(upper, path),
    method: upper,
    path,
    summary,
    description,
    priceUsd: priceFromPaymentInfo(op),
    inputSchema,
  };
}

/**
 * Pure extraction of the paid routes from an OpenAPI document. Skips `GET /health`
 * and any operation without `x-payment-info`; a malformed operation is skipped,
 * never thrown on.
 */
export function routesFromOpenApi(doc: unknown): RouteInfo[] {
  if (!isRecord(doc)) return [];
  const paths = doc["paths"];
  if (!isRecord(paths)) return [];
  const routes: RouteInfo[] = [];
  for (const [path, item] of Object.entries(paths)) {
    if (!isRecord(item)) continue;
    for (const [method, op] of Object.entries(item)) {
      if (method.toLowerCase() !== "get" && method.toLowerCase() !== "post") continue;
      if (method.toLowerCase() === "get" && path === "/health") continue;
      const route = routeFromOperation(method, path, op);
      if (route) routes.push(route);
    }
  }
  return routes;
}

/** Fetches the live catalogue and extracts the paid routes. */
export async function fetchCatalog(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<RouteInfo[]> {
  const res = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/openapi.json`);
  if (!res.ok) throw new Error(`catalog fetch failed: http ${res.status}`);
  return routesFromOpenApi((await res.json()) as unknown);
}
