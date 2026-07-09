import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);
  console.log(`[${topic}] webhook from ${shop}`);

  const orderId = (payload as any)?.admin_graphql_api_id as string;
  if (!orderId) {
    console.error("[orders/fulfilled] No order ID in payload");
    return new Response();
  }

  console.log(`[orders/fulfilled] Order ${orderId} fulfilled, checking for deferred payment...`);

  try {
    // Step 1: Query order for payment mandates and payment schedule
    const orderRes = await admin.graphql(
      `#graphql
      query getOrderPaymentInfo($id: ID!) {
        order(id: $id) {
          id
          name
          totalPriceSet {
            shopMoney { amount currencyCode }
          }
          paymentCollectionDetails {
            vaultedPaymentMethods {
              id
            }
          }
          paymentTerms {
            paymentSchedules(first: 10) {
              edges {
                node {
                  id
                  due
                  dueAt
                  issuedAt
                  completedAt
                  totalBalance {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
      }`,
      { variables: { id: orderId } }
    );

    const orderData = await orderRes.json();
    const order = orderData?.data?.order;

    if (!order) {
      console.log(`[orders/fulfilled] Order ${orderId} not found or no payment info`);
      return new Response();
    }

    console.log(
      `[orders/fulfilled] Order ${order.name} - paymentCollectionDetails:`,
      JSON.stringify(order.paymentCollectionDetails, null, 2)
    );
    console.log(
      `[orders/fulfilled] Order ${order.name} - paymentTerms:`,
      JSON.stringify(order.paymentTerms, null, 2)
    );

    // Step 2: Get the PaymentMandate ID
    const mandateId = order.paymentCollectionDetails?.vaultedPaymentMethods?.[0]?.id;
    if (!mandateId) {
      console.log(`[orders/fulfilled] No PaymentMandate found for order ${order.name}. Not a deferred payment order.`);
      return new Response();
    }

    // Step 3: Find pending payment schedule (remaining balance to collect)
    // completedAt is null when not yet paid, due=true means it's ready to charge
    const schedules = order.paymentTerms?.paymentSchedules?.edges?.map((e: any) => e.node) ?? [];
    const pendingSchedule = schedules.find((s: any) => !s.completedAt);

    if (!pendingSchedule) {
      console.log(`[orders/fulfilled] No pending payment schedule for order ${order.name}. Already fully paid.`);
      return new Response();
    }

    const remainingAmount = pendingSchedule.totalBalance?.amount;
    const currencyCode = pendingSchedule.totalBalance?.currencyCode;

    if (!remainingAmount || parseFloat(remainingAmount) <= 0) {
      console.log(`[orders/fulfilled] No remaining balance for order ${order.name}. Nothing to charge.`);
      return new Response();
    }

    console.log(
      `[orders/fulfilled] Charging remaining ${remainingAmount} ${currencyCode} for order ${order.name} using mandate ${mandateId}`
    );

    // Step 4: Trigger mandate payment for the remaining balance
    // Uses idempotencyKey based on orderId + scheduleId to prevent duplicate charges
    // Idempotency key max 32 chars. Use numeric IDs only.
    const orderNum = orderId.split("/").pop()!;
    const scheduleNum = pendingSchedule.id.split("/").pop()!;
    const idempotencyKey = `${orderNum}-${scheduleNum}`;

    const chargeRes = await admin.graphql(
      `#graphql
      mutation chargeRemainingBalance(
        $id: ID!
        $mandateId: ID!
        $idempotencyKey: String!
        $paymentScheduleId: ID
      ) {
        orderCreateMandatePayment(
          id: $id
          mandateId: $mandateId
          idempotencyKey: $idempotencyKey
          paymentScheduleId: $paymentScheduleId
          autoCapture: true
        ) {
          job {
            id
            done
          }
          paymentReferenceId
          userErrors {
            field
            message
            code
          }
        }
      }`,
      {
        variables: {
          id: orderId,
          mandateId,
          idempotencyKey,
          paymentScheduleId: pendingSchedule.id,
        },
      }
    );

    const chargeData = await chargeRes.json();
    const result = chargeData?.data?.orderCreateMandatePayment;

    if (result?.userErrors?.length > 0) {
      console.error(
        `[orders/fulfilled] ❌ Failed to auto-charge remaining balance for ${order.name}:`,
        JSON.stringify(result.userErrors, null, 2)
      );
      // The order remains with unpaid balance - merchant can collect manually from Admin
      return new Response();
    }

    console.log(
      `[orders/fulfilled] ✅ Auto-charged remaining balance for order ${order.name}`,
      `| job: ${result?.job?.id}`,
      `| paymentRef: ${result?.paymentReferenceId}`
    );
  } catch (error) {
    console.error("[orders/fulfilled] Error processing deferred payment:", error);
  }

  return new Response();
};
