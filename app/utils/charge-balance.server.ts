type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type ChargeBalanceResult =
  | { ok: true; charged: boolean; reason?: "no_mandate" | "already_paid" }
  | { ok: false; error: string };

/**
 * Captures the unpaid deferred balance on a deposit order.
 * A due-on-fulfillment schedule can already look completed while the order
 * still has an outstanding balance, so the order total is the signal.
 * The same order idempotency key is shared by approval and the fulfillment
 * fallback, so a second call does not create another payment.
 */
export async function chargeRemainingBalance(
  admin: AdminGraphql,
  orderId: string,
  source: string,
): Promise<ChargeBalanceResult> {
  const orderRes = await admin.graphql(
    `#graphql
    query BalanceChargeOrder($id: ID!) {
      order(id: $id) {
        id
        name
        totalOutstandingSet { shopMoney { amount currencyCode } }
        paymentCollectionDetails {
          vaultedPaymentMethods { id }
        }
      }
    }`,
    { variables: { id: orderId } },
  );
  const orderData = await orderRes.json();
  const order = orderData?.data?.order;
  if (!order) {
    console.error(`[${source}] order ${orderId} was not found`);
    return { ok: false, error: "Order was not found" };
  }

  const mandateId = order.paymentCollectionDetails?.vaultedPaymentMethods?.[0]?.id as
    | string
    | undefined;
  if (!mandateId) {
    console.log(`[${source}] ${order.name} has no vaulted payment. Skipping balance charge.`);
    return { ok: true, charged: false, reason: "no_mandate" };
  }

  const outstanding = order.totalOutstandingSet?.shopMoney;
  const remainingAmount = outstanding?.amount as string | undefined;
  const currencyCode = outstanding?.currencyCode as string | undefined;
  if (!remainingAmount || Number.parseFloat(remainingAmount) <= 0) {
    console.log(`[${source}] ${order.name} has no unpaid balance.`);
    return { ok: true, charged: false, reason: "already_paid" };
  }

  const orderNum = orderId.split("/").pop() || orderId;
  const idempotencyKey = `${orderNum}-balance`.slice(0, 32);

  console.log(
    `[${source}] charging ${remainingAmount} ${currencyCode} on ${order.name}`,
  );

  const chargeRes = await admin.graphql(
    `#graphql
    mutation ChargeRemainingBalance(
      $id: ID!
      $mandateId: ID!
      $idempotencyKey: String!
    ) {
      orderCreateMandatePayment(
        id: $id
        mandateId: $mandateId
        idempotencyKey: $idempotencyKey
        autoCapture: true
      ) {
        paymentReferenceId
        userErrors { field message }
      }
    }`,
    {
      variables: {
        id: orderId,
        mandateId,
        idempotencyKey,
      },
    },
  );
  const chargeData = await chargeRes.json();
  const result = chargeData?.data?.orderCreateMandatePayment;
  const errors = result?.userErrors as Array<{ message?: string }> | undefined;
  if (!result || errors?.length) {
    console.error(
      `[${source}] balance charge failed for ${order.name}`,
      JSON.stringify(errors || chargeData?.errors || chargeData),
    );
    return { ok: false, error: "Could not collect the remaining balance" };
  }

  console.log(
    `[${source}] collected remaining balance for ${order.name}`,
    result.paymentReferenceId,
  );
  return { ok: true, charged: true };
}
