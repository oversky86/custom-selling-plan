import { createHmac, timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";
import { chargeRemainingBalance } from "../utils/charge-balance.server";

const MAX_SKEW_SEC = 300;
const ALLOWED_SHOPS = new Set([
  "e-commerce-dev-v6yidmlw.myshopify.com",
  "6hcr01-9t.myshopify.com",
]);

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function verifySignature(timestamp: string, rawBody: string, signature: string, secret: string) {
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const secret = process.env.BALANCE_CHARGE_SECRET?.trim();
  if (!secret) {
    console.error("[balance-charge] BALANCE_CHARGE_SECRET is not set");
    return json({ ok: false, error: "Balance charge is not configured" }, 503);
  }

  const rawBody = await request.text();
  const timestamp = request.headers.get("X-Balance-Timestamp") || "";
  const signature = request.headers.get("X-Balance-Signature") || "";
  const ts = Number(timestamp);
  if (
    !timestamp ||
    !signature ||
    !Number.isFinite(ts) ||
    Math.abs(Math.floor(Date.now() / 1000) - ts) > MAX_SKEW_SEC ||
    !verifySignature(timestamp, rawBody, signature, secret)
  ) {
    return json({ ok: false, error: "Invalid signature" }, 401);
  }

  let body: { shop?: string; orderId?: string };
  try {
    body = JSON.parse(rawBody) as { shop?: string; orderId?: string };
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const shop = (body.shop || "").trim().toLowerCase();
  const orderId = (body.orderId || "").trim();
  if (!ALLOWED_SHOPS.has(shop) || !orderId.startsWith("gid://shopify/Order/")) {
    return json({ ok: false, error: "Shop or order is not allowed" }, 403);
  }

  try {
    const { admin } = await unauthenticated.admin(shop);
    const result = await chargeRemainingBalance(admin, orderId, "balance-charge");
    if (!result.ok) return json(result, 502);
    return json(result);
  } catch (error) {
    console.error("[balance-charge] admin call failed", error);
    return json({ ok: false, error: "Could not collect the remaining balance" }, 502);
  }
};
