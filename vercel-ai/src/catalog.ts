// Paid-route table derived from the edge's public OpenAPI catalogue.
// Pure functions only: fetching lives in fetchCatalog, paying in payer.ts,
// tool construction in tools.ts.

export interface RouteInfo {
  key: string;
  method: "GET" | "POST";
  path: string;
  summary: string;
  description: string;
  priceUsd: number | null;
  inputSchema: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Lowercase, non-alphanumerics collapse to one underscore, edges trimmed, so
// `POST /v1/polymarket/backtest` becomes `post_v1_polymarket_backtest`.
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function priceOf(operation: Record<string, unknown>): number | null {
  const info = operation["x-payment-info"];
  if (!isRecord(info)) return null;
  const price = info["price"];
  if (!isRecord(price)) return null;
  const amount = price["amount"];
  const parsed = typeof amount === "number" ? amount : typeof amount === "string" ? Number(amount) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

// POST takes the JSON request-body schema; GET synthesises an object schema
// from its query parameters. Anything missing degrades to an empty schema.
function inputSchemaOf(method: "GET" | "POST", operation: Record<string, unknown>): Record<string, unknown> {
  if (method === "GET") {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    const parameters = operation["parameters"];
    if (Array.isArray(parameters)) {
      for (const parameter of parameters) {
        if (!isRecord(parameter) || parameter["in"] !== "query") continue;
        const name = parameter["name"];
        if (typeof name !== "string" || name === "") continue;
        properties[name] = isRecord(parameter["schema"]) ? parameter["schema"] : {};
        if (parameter["required"] === true) required.push(name);
      }
    }
    const schema: Record<string, unknown> = { type: "object", properties };
    if (required.length > 0) schema["required"] = required;
    return schema;
  }
  const body = operation["requestBody"];
  if (!isRecord(body)) return {};
  const content = body["content"];
  if (!isRecord(content)) return {};
  const json = content["application/json"];
  if (!isRecord(json)) return {};
  return isRecord(json["schema"]) ? json["schema"] : {};
}

// One operation → one RouteInfo, or null when the operation is free (no
// x-payment-info) or unusable. Never throws: callers skip nulls.
function routeFromOperation(method: "GET" | "POST", path: string, operation: unknown): RouteInfo | null {
  if (!isRecord(operation)) return null;
  if (!isRecord(operation["x-payment-info"])) return null;
  const operationId = operation["operationId"];
  const key =
    typeof operationId === "string" && operationId !== "" ? operationId : slugify(`${method}_${path}`);
  if (key === "") return null;
  return {
    key,
    method,
    path,
    summary: typeof operation["summary"] === "string" ? operation["summary"] : "",
    description: typeof operation["description"] === "string" ? operation["description"] : "",
    priceUsd: priceOf(operation),
    inputSchema: inputSchemaOf(method, operation),
  };
}

// Whole document → paid routes. Skips GET /health, non-GET/POST methods and
// anything malformed; never throws on a malformed operation (skips it).
export function routesFromOpenApi(doc: unknown): RouteInfo[] {
  const routes: RouteInfo[] = [];
  if (!isRecord(doc)) return routes;
  if (!isRecord(doc["paths"])) return routes;
  for (const [path, item] of Object.entries(doc["paths"])) {
    if (!isRecord(item)) continue;
    for (const [rawMethod, operation] of Object.entries(item)) {
      const method = rawMethod.toUpperCase();
      if (method !== "GET" && method !== "POST") continue;
      if (method === "GET" && path === "/health") continue;
      try {
        const route = routeFromOperation(method, path, operation);
        if (route) routes.push(route);
      } catch {
        continue;
      }
    }
  }
  return routes;
}

// The catalogue endpoints are free, so this uses a plain fetch.
export async function fetchCatalog(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<RouteInfo[]> {
  const response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/openapi.json`);
  return routesFromOpenApi((await response.json()) as unknown);
}
