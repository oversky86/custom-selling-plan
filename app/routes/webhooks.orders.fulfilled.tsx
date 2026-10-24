import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { chargeRemainingBalance } from "../utils/charge-balance.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);
  console.log(`[${topic}] webhook from ${shop}`);

  const orderId = (payload as { admin_graphql_api_id?: string })?.admin_graphql_api_id;
  if (!orderId) {
    console.error("[orders/fulfilled] No order ID in payload");
    return new Response();
  }

  if (!admin) {
    console.error("[orders/fulfilled] No admin session");
    return new Response("No admin session", { status: 500 });
  }

  // The remaining balance is collected when the customer approves the portrait.
  // This call only covers an order whose approval charge did not complete.
  // It uses the same idempotency key, so a finished approval charge is not repeated.
  try {
    const result = await chargeRemainingBalance(admin, orderId, "orders/fulfilled");
    if (!result.ok) {
      console.error(`[orders/fulfilled] balance still unpaid for ${orderId}: ${result.error}`);
    }
  } catch (error) {
    console.error("[orders/fulfilled] Error processing deferred payment:", error);
  }

  return new Response();
};
