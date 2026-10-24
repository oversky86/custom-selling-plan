import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { FileSessionStorage } from "./file-session-storage";
import prisma from "./db.server";
import { ScopedSessionStorage } from "./scoped-session-storage.server";

const isDev = process.env.NODE_ENV !== "production";

const DEV_API_KEY = process.env.SHOPIFY_API_KEY || "";
const DEV_API_SECRET = process.env.SHOPIFY_API_SECRET || "";
const LIVE_API_KEY =
  process.env.SHOPIFY_API_KEY_LIVE || "4461215dd99f906f4b139604cd88eebb";
const LIVE_API_SECRET = process.env.SHOPIFY_API_SECRET_LIVE || "";

const LIVE_SHOP = "6hcr01-9t.myshopify.com";
const LIVE_HOSTS = new Set([
  LIVE_SHOP,
  "view-brush.myshopify.com",
  "viewbrush.com",
  "www.viewbrush.com",
]);
const LIVE_SESSION_SHOPS = [LIVE_SHOP, "view-brush.myshopify.com"];

function normalizeHost(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .split("/")[0];
}

function isLiveShop(input: string): boolean {
  return LIVE_HOSTS.has(normalizeHost(input));
}

function createShopify(apiKey: string, apiSecret: string, live: boolean) {
  return shopifyApp({
    apiKey,
    apiSecretKey: apiSecret,
    apiVersion: ApiVersion.October25,
    scopes: process.env.SCOPES?.split(","),
    appUrl: process.env.SHOPIFY_APP_URL || "",
    authPathPrefix: "/auth",
    sessionStorage: new ScopedSessionStorage(
      isDev
        ? new FileSessionStorage("app/.shopify-sessions.json")
        : new PrismaSessionStorage(prisma),
      apiKey || "selling-plan",
    ),
    distribution: AppDistribution.AppStore,
    future: {
      expiringOfflineAccessTokens: true,
    },
    ...(live
      ? { customShopDomains: ["viewbrush.com", "www.viewbrush.com"] }
      : process.env.SHOP_CUSTOM_DOMAIN
        ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
        : {}),
  });
}

type Shopify = ReturnType<typeof createShopify>;

const devShopify = createShopify(DEV_API_KEY, DEV_API_SECRET, false);
const liveShopify = LIVE_API_SECRET
  ? createShopify(LIVE_API_KEY, LIVE_API_SECRET, true)
  : null;

function clientIdFromToken(token: string): string {
  const part = token.split(".")[1];
  if (!part) return "";
  try {
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as {
      aud?: string | string[];
    };
    const aud = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud;
    return typeof aud === "string" ? aud : "";
  } catch {
    return "";
  }
}

function clientIdFromRequest(request: Request): string {
  const url = new URL(request.url);
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const token = bearer || url.searchParams.get("id_token") || "";
  return token ? clientIdFromToken(token) : "";
}

function shopFromHostParam(host: string): string {
  if (!host) return "";
  try {
    const decoded = Buffer.from(host, "base64").toString("utf8");
    if (
      decoded.includes("/store/view-brush") ||
      decoded.includes("6hcr01-9t") ||
      decoded.includes("viewbrush.com")
    ) {
      return "6hcr01-9t.myshopify.com";
    }
  } catch {
    return "";
  }
  return "";
}

function shopFromRequest(request: Request): string {
  const url = new URL(request.url);
  return normalizeHost(
    url.searchParams.get("shop") ||
      request.headers.get("x-shopify-shop-domain") ||
      shopFromHostParam(url.searchParams.get("host") || "") ||
      "",
  );
}

function appsForRequest(request: Request): { apps: Shopify[]; certain: boolean } {
  const clientId = clientIdFromRequest(request);
  if (clientId === LIVE_API_KEY && liveShopify) return { apps: [liveShopify], certain: true };
  if (clientId === DEV_API_KEY) return { apps: [devShopify], certain: true };
  const shop = shopFromRequest(request);
  if (isLiveShop(shop)) return { apps: liveShopify ? [liveShopify] : [devShopify], certain: true };
  if (shop) return { apps: [devShopify], certain: true };
  return { apps: liveShopify ? [devShopify, liveShopify] : [devShopify], certain: false };
}

async function replay(request: Request): Promise<() => Request> {
  if (request.method === "GET" || request.method === "HEAD") {
    return () => request;
  }
  // Clone first. Route actions still need the original body after auth.
  const body = await request.clone().arrayBuffer();
  return () =>
    new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body,
    });
}

async function withApp<T>(
  request: Request,
  apps: Shopify[],
  certain: boolean,
  run: (app: Shopify, request: Request) => Promise<T>,
): Promise<T> {
  const next = await replay(request);
  let last: unknown;
  for (let i = 0; i < apps.length; i++) {
    try {
      return await run(apps[i], next());
    } catch (err) {
      last = err;
      const redirect = err instanceof Response && err.status >= 300 && err.status < 400;
      if (certain || redirect || i === apps.length - 1) throw err;
    }
  }
  throw last;
}

export function apiKeyForRequest(request: Request): string {
  const clientId = clientIdFromRequest(request);
  if (clientId === LIVE_API_KEY) return LIVE_API_KEY;
  if (isLiveShop(shopFromRequest(request))) return LIVE_API_KEY;
  return DEV_API_KEY;
}

async function authenticateAdmin(request: Request) {
  const { apps, certain } = appsForRequest(request);
  return withApp(request, apps, certain, (app, req) => app.authenticate.admin(req));
}

async function authenticateWebhook(request: Request) {
  const shop = request.headers.get("x-shopify-shop-domain") || "";
  const preferred = isLiveShop(shop) && liveShopify ? liveShopify : devShopify;
  const rest = [devShopify, liveShopify].filter(
    (app): app is Shopify => Boolean(app) && app !== preferred,
  );
  return withApp(request, [preferred, ...rest], false, (app, req) =>
    app.authenticate.webhook(req),
  );
}

async function loginFor(request: Request) {
  let shop = shopFromRequest(request);
  if (!shop && request.method === "POST") {
    const form = await request.clone().formData().catch(() => null);
    const posted = form?.get("shop");
    if (typeof posted === "string") shop = normalizeHost(posted);
  }
  const app = isLiveShop(shop) && liveShopify ? liveShopify : devShopify;
  return app.login(request);
}

async function adminForShop(shop: string) {
  const host = isLiveShop(shop) ? LIVE_SHOP : normalizeHost(shop);
  const app = isLiveShop(host) && liveShopify ? liveShopify : devShopify;
  if (isLiveShop(host) && !liveShopify) {
    console.error("[shopify] SHOPIFY_API_SECRET_LIVE is not set");
  }
  const candidates = isLiveShop(host)
    ? [host, ...LIVE_SESSION_SHOPS.filter((item) => item !== host)]
    : [host];
  let last: unknown;
  for (const candidate of candidates) {
    try {
      return await app.unauthenticated.admin(candidate);
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

const shopify = devShopify;

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = {
  admin: authenticateAdmin,
  webhook: authenticateWebhook,
};
export const unauthenticated = {
  admin: adminForShop,
};
export const login = loginFor;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
