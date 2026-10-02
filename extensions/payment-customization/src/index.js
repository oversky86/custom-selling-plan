// @ts-check

/**
 * When the cart contains a deferred/deposit payment plan (selling plan),
 * only allow vault-supported payment methods (credit card, Shop Pay, Apple Pay, Google Pay).
 * Hide all other methods (PayPal, COD, bank transfer, etc.).
 *
 * When no selling plan is present, return no operations (all methods stay visible).
 */

// Keywords that identify vault-supported payment methods
const VAULT_SUPPORTED_KEYWORDS = ["card", "shop pay", "apple pay", "google pay"];

/**
 * @param {Object} input
 * @returns {Object}
 */
export function cartPaymentMethodsTransformRun(input) {
  const lines = input.cart?.lines || [];

  // Check if any cart line has a selling plan allocation (deferred/deposit payment)
  const hasDeferredPayment = lines.some(
    (line) => line.sellingPlanAllocation != null
  );

  // No selling plan in cart -> don't modify payment methods
  if (!hasDeferredPayment) {
    return { operations: [] };
  }

  // Cart has deferred payment -> hide non-vault payment methods
  const paymentMethods = input.paymentMethods || [];

  const operations = [];

  for (const method of paymentMethods) {
    const nameLower = (method.name || "").toLowerCase();
    const isVaultSupported = VAULT_SUPPORTED_KEYWORDS.some((keyword) =>
      nameLower.includes(keyword)
    );

    if (!isVaultSupported) {
      operations.push({
        paymentMethodHide: {
          paymentMethodId: method.id,
        },
      });
    }
  }

  return { operations };
}
