type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type PaymentSchedule = {
  id: string;
  completedAt?: string | null;
  totalBalance?: { amount?: string | null; currencyCode?: string | null } | null;
};

export type ChargeBalanceResult =
  | { ok: true; charged: boolean; reason?: "no_mandate" | "already_paid" | "no_balance" }
  | { ok: false; error: string };

/**
 * Captures the unpaid deferred balance on a deposit order.
 * The same order + schedule idempotency key is shared by the approval call and
 * the fulfillment fallback, so a second call does not create another payment.
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
        paymentCollectionDetails {
          vaultedPaymentMethods { id }
        }
        paymentTerms {
          paymentSchedules(first: 10) {
            edges {
              node {
                id
                completedAt
                totalBalance { amount currencyCode }
              }
            }
          }
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

  const schedules: PaymentSchedule[] =
    order.paymentTerms?.paymentSchedules?.edges?.map(
      (edge: { node: PaymentSchedule }) => edge.node,
    ) ?? [];
  const pending = schedules.find((schedule) => !schedule.completedAt);
  if (!pending) {
    console.log(`[${source}] ${order.name} has no unpaid balance.`);
    return { ok: true, charged: false, reason: "already_paid" };
  }

  const remainingAmount = pending.totalBalance?.amount;
  const currencyCode = pending.totalBalance?.currencyCode;
  if (!remainingAmount || Number.parseFloat(remainingAmount) <= 0) {
    console.log(`[${source}] ${order.name} remaining balance is empty.`);
    return { ok: true, charged: false, reason: "no_balance" };
  }

  const orderNum = orderId.split("/").pop() || orderId;
  const scheduleNum = pending.id.split("/").pop() || pending.id;
  const idempotencyKey = `${orderNum}-${scheduleNum}`.slice(0, 32);

  console.log(
    `[${source}] charging ${remainingAmount} ${currencyCode} on ${order.name}`,
  );

  const chargeRes = await admin.graphql(
    `#graphql
    mutation ChargeRemainingBalance(
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
        paymentReferenceId
        userErrors { field message }
      }
    }`,
    {
      variables: {
        id: orderId,
        mandateId,
        idempotencyKey,
        paymentScheduleId: pending.id,
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
