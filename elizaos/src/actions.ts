// Paid routes → ElizaOS actions. One action per route, paying over x402 with
// the buyer's wallet through the paying fetch, mirroring tools.ts in
// examples/vercel-ai (same request building, price cap and error contract,
// different interface: validate/handler instead of execute).
//
// Where the arguments come from, and only from: `options.args` (an explicit bag
// a caller hands the handler) or the message text as a JSON object. Never the
// raw ElizaOS options bag — in a real runtime it carries context and prior
// responses, and sending that on the wire would leak the conversation and pay
// for a request that can only fail. Arguments the schema rejects mean no
// request at all (nothing paid), never a guess.
import { fetchCatalog, resolvePath, type RouteInfo } from "./catalog.js";
import { createPayingFetch, settlementOf } from "./payer.js";
import { zodFromJsonSchema } from "./schema.js";
import type {
  ElizaAction,
  ElizaActionResult,
  ElizaHandlerCallback,
  ElizaMemory,
  ElizaPlugin,
  ElizaRuntime,
  ElizaState,
} from "./eliza-types.js";

export const DEFAULT_BASE_URL = "https://aiworker.duckdns.org";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// `post_v1_polymarket_backtest` → `AIWORKER_POST_V1_POLYMARKET_BACKTEST`;
// the live catalogue names operations by key (`token_info` → `AIWORKER_TOKEN_INFO`).
// Non-alphanumerics collapse to one underscore, so the name always matches
// `^[A-Z0-9_]+$`, which ElizaOS action names require.
export function actionNameFor(key: string): string {
  const safe = key
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `AIWORKER_${safe.length > 0 ? safe : "ROUTE"}`;
}

// `post_v1_polymarket_backtest` → `POST V1 POLYMARKET BACKTEST`.
function simileFor(key: string): string {
  return key.replace(/_+/g, " ").toUpperCase();
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

// Error bodies stay small and structured: parsed JSON when the server sent
// JSON, else plain text cut at 500 characters.
function errorBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text.slice(0, 500);
  }
}

function parsedBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

// Message text must be a JSON object string; anything else yields null.
function messageArgs(message: ElizaMemory): Record<string, unknown> | null {
  const text = message.content.text;
  if (typeof text !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// The explicit bag only: `options.args`.
function optionArgs(options: Record<string, unknown> | undefined): Record<string, unknown> | null {
  const args = options?.["args"];
  return isRecord(args) ? args : null;
}

/** A setting as a string: ElizaOS 1.x's `getSetting` may answer a number or a boolean; an absent one is undefined. */
function settingString(runtime: ElizaRuntime, key: string): string | undefined {
  const v = runtime.getSetting(key);
  if (v === undefined || v === null || v === "") return undefined;
  return String(v);
}

export function actionsFromRoutes(
  routes: RouteInfo[],
  o: { baseUrl: string; fetchImpl: typeof fetch; maxPriceUsd?: number },
): ElizaAction[] {
  const baseUrl = o.baseUrl.replace(/\/+$/, "");
  const actions: ElizaAction[] = [];
  for (const route of routes) {
    if (o.maxPriceUsd !== undefined && route.priceUsd !== null && route.priceUsd > o.maxPriceUsd) continue;
    const name = actionNameFor(route.key);
    const price = route.priceUsd === null ? "unknown" : String(route.priceUsd);
    const description =
      `${route.summary} (price $${price} per call, paid over x402)` +
      (route.description ? ` ${route.description.slice(0, 300)}` : "");
    const schema = zodFromJsonSchema(route.inputSchema);
    const { method, path } = route;
    const fetchImpl = o.fetchImpl;

    // The validated, schema-stripped arguments, or null when neither source is acceptable.
    // `options.args` wins over the message text when both validate.
    const resolveArgs = (options: Record<string, unknown> | undefined, message: ElizaMemory): Record<string, unknown> | null => {
      for (const candidate of [optionArgs(options), messageArgs(message)]) {
        if (candidate === null) continue;
        const r = schema.safeParse(candidate);
        if (r.success && isRecord(r.data)) return r.data;
      }
      return null;
    };

    const send = async (validated: Record<string, unknown>, callback?: ElizaHandlerCallback): Promise<ElizaActionResult> => {
      // `{slug}`-style path parameters are filled from the arguments first; the rest is the query or the body.
      const resolved = resolvePath(path, validated);
      const input = resolved.rest;
      const target = `${baseUrl}${resolved.path}`;
      let response: Response;
      if (method === "GET") {
        const query = new URLSearchParams();
        for (const [field, value] of Object.entries(input)) {
          if (value === undefined || value === null) continue;
          if (Array.isArray(value)) for (const entry of value) query.append(field, String(entry));
          else query.set(field, typeof value === "object" ? JSON.stringify(value) : String(value));
        }
        const suffix = query.toString();
        response = await fetchImpl(suffix ? `${target}?${suffix}` : target, { method: "GET" });
      } else {
        response = await fetchImpl(target, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      }
      const text = await response.text();
      const settlement = settlementOf(response);
      if (!response.ok) {
        return {
          success: false,
          error: String(response.status),
          text: JSON.stringify({ error: response.status, body: errorBody(text) }),
          data: { status: response.status, settlement },
        };
      }
      const out = okBody(text);
      const result: ElizaActionResult = { success: true, text: out, data: { status: response.status, settlement, body: parsedBody(text) } };
      if (callback) {
        // The callback is the host's code: its failure must not void a paid, answered call.
        try { await callback({ text: out, actions: [name], source: "aiworker" }); } catch { /* the result below still carries the body */ }
      }
      return result;
    };

    actions.push({
      name,
      similes: [simileFor(route.key)],
      description,
      // One example per action so ElizaOS's action selection has a shape to match: the route's own example input as the message.
      examples: [[{ name: "user", content: { text: JSON.stringify(route.inputSchema["example"] ?? {}) } }, { name: "agent", content: { text: `Calling ${name}.`, actions: [name] } }]],
      // ElizaOS 1.x calls validate(runtime, message, state): true when the message text is a JSON object the
      // route's schema accepts. A handler invoked with `options.args` is validated again there.
      validate: async (_runtime: ElizaRuntime, message: ElizaMemory, _state?: ElizaState): Promise<boolean> => {
        const parsed = messageArgs(message);
        return parsed !== null && schema.safeParse(parsed).success;
      },
      handler: async (
        _runtime: ElizaRuntime,
        message: ElizaMemory,
        _state?: ElizaState,
        options?: Record<string, unknown>,
        callback?: ElizaHandlerCallback,
      ): Promise<ElizaActionResult> => {
        const input = resolveArgs(options, message);
        if (input === null) return { success: false, error: "invalid_arguments", text: JSON.stringify({ error: "invalid_arguments", body: "no arguments the route's schema accepts (options.args or a JSON message)" }) };
        try {
          return await send(input, callback);
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    });
  }
  return actions;
}

// Catalogue (free endpoint, plain fetch) + paying fetch + actions.
export async function aiworkerPlugin(o: {
  baseUrl?: string;
  privateKey: `0x${string}`;
  chain?: "base" | "baseSepolia";
  maxPriceUsd?: number;
  fetchImpl?: typeof fetch;
}): Promise<ElizaPlugin> {
  const baseUrl = o.baseUrl ?? DEFAULT_BASE_URL;
  const lowLevel = o.fetchImpl ?? fetch;
  const routes = await fetchCatalog(baseUrl, lowLevel);
  const paying = createPayingFetch({ privateKey: o.privateKey, chain: o.chain, fetchImpl: lowLevel, maxPriceUsd: o.maxPriceUsd });
  const actions = actionsFromRoutes(routes, { baseUrl, fetchImpl: paying, maxPriceUsd: o.maxPriceUsd });
  return {
    name: "aiworker",
    description: `Paid aiworker data routes (x402, USDC on Base): ${actions.length} paid routes from the aiworker catalogue.`,
    actions,
  };
}

/**
 * The plugin object an ElizaOS 1.x character lists in `plugins: [...]` (or that the runtime loads by package name):
 * empty until `init`, which reads the runtime's settings — `AIWORKER_BUYER_KEY`, optional `AIWORKER_BASE_URL`,
 * `AIWORKER_CHAIN` and `AIWORKER_MAX_PRICE_USD` (default 0.05) — and fills `actions` in place. Without a key the
 * plugin stays empty and the agent still starts; the missing setting is the agent operator's to add.
 */
export const DEFAULT_MAX_PRICE_USD = 0.05;
export const aiworkerElizaPlugin: ElizaPlugin & { actions: ElizaAction[] } = {
  name: "aiworker",
  description: "Paid aiworker data routes (x402, USDC on Base): DeFi yields, page-to-Markdown, Base token and wallet checks, Polymarket resolution, odds, history, screener and backtests, fact checks, briefs, headline search. Each call pays its own price from the configured wallet.",
  actions: [],
  init: async (_config: Record<string, string>, runtime: ElizaRuntime): Promise<void> => {
    const key = settingString(runtime, "AIWORKER_BUYER_KEY");
    if (key === undefined) return;
    const capRaw = settingString(runtime, "AIWORKER_MAX_PRICE_USD");
    const cap = capRaw === undefined ? DEFAULT_MAX_PRICE_USD : Number(capRaw);
    const built = await aiworkerPluginFromSettings(runtime, { maxPriceUsd: Number.isFinite(cap) && cap > 0 ? cap : DEFAULT_MAX_PRICE_USD });
    aiworkerElizaPlugin.actions.splice(0, aiworkerElizaPlugin.actions.length, ...(built.actions ?? []));
  },
};

const PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/;

// Settings-driven constructor for agents: the key comes from the ElizaOS
// runtime's settings, never from process.env here, and is never echoed.
export async function aiworkerPluginFromSettings(
  runtime: ElizaRuntime,
  o?: { maxPriceUsd?: number; fetchImpl?: typeof fetch },
): Promise<ElizaPlugin> {
  const key = settingString(runtime, "AIWORKER_BUYER_KEY");
  if (key === undefined) throw new Error("AIWORKER_BUYER_KEY is not set");
  if (!PRIVATE_KEY_RE.test(key)) throw new Error("AIWORKER_BUYER_KEY is not a 0x-prefixed 64-hex private key");
  const baseUrl = settingString(runtime, "AIWORKER_BASE_URL");
  const chainRaw = settingString(runtime, "AIWORKER_CHAIN");
  const chain = chainRaw === "baseSepolia" ? "baseSepolia" : chainRaw === "base" ? "base" : undefined;
  return aiworkerPlugin({
    baseUrl,
    privateKey: key as `0x${string}`,
    chain,
    maxPriceUsd: o?.maxPriceUsd,
    fetchImpl: o?.fetchImpl,
  });
}
