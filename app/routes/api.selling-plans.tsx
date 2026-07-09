import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

const jsonResponse = (data: any, init?: ResponseInit) =>
  new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  if (!admin) {
    return jsonResponse({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { action: op } = body;

  try {
    switch (op) {
      case "create":
        return await handleCreate(admin, body);
      case "delete":
        return await handleDelete(admin, body);
      case "addProducts":
        return await handleAddProducts(admin, body);
      case "removeProducts":
        return await handleRemoveProducts(admin, body);
      case "query":
        return await handleQuery(admin);
      case "queryProducts":
        return await handleQueryProducts(admin);
      default:
        return jsonResponse({ error: `Unknown action: ${op}` }, { status: 400 });
    }
  } catch (error) {
    console.error("[SellingPlans] Error:", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
};

async function handleCreate(admin: any, body: any) {
  const { depositPercentage = 20, productIds = [], name = "Deposit Purchase" } = body;

  const response = await admin.graphql(
    `#graphql
    mutation createSellingPlanGroup(
      $input: SellingPlanGroupInput!
      $resources: SellingPlanGroupResourceInput
    ) {
      sellingPlanGroupCreate(input: $input, resources: $resources) {
        sellingPlanGroup {
          id
          name
          sellingPlans(first: 1) {
            edges {
              node {
                id
                name
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        input: {
          name,
          merchantCode: `deposit-${depositPercentage}`,
          options: [`${depositPercentage}% Deposit`],
          sellingPlansToCreate: [
            {
              name: `Pay ${depositPercentage}% Now, ${100 - depositPercentage}% on Shipment`,
              options: `${depositPercentage}% Deposit`,
              category: "PRE_ORDER",
              billingPolicy: {
                fixed: {
                  checkoutCharge: {
                    type: "PERCENTAGE",
                    value: { percentage: parseFloat(depositPercentage) },
                  },
                  remainingBalanceChargeTrigger: "ON_FULFILLMENT",
                },
              },
              inventoryPolicy: { reserve: "ON_SALE" },
              deliveryPolicy: { fixed: { fulfillmentTrigger: "ASAP" } },
            },
          ],
        },
        resources: {
          productIds: productIds.length > 0 ? productIds : undefined,
          productVariantIds: [],
        },
      },
    }
  );

  const data = await response.json();
  const result = data.data?.sellingPlanGroupCreate;

  if (result?.userErrors?.length) {
    return jsonResponse({ success: false, errors: result.userErrors }, { status: 400 });
  }

  return jsonResponse({ success: true, sellingPlanGroup: result?.sellingPlanGroup });
}

async function handleDelete(admin: any, body: any) {
  const { sellingPlanGroupId } = body;

  const response = await admin.graphql(
    `#graphql
    mutation deleteSellingPlanGroup($id: ID!) {
      sellingPlanGroupDelete(id: $id) {
        deletedSellingPlanGroupId
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: { id: sellingPlanGroupId },
    }
  );

  const data = await response.json();
  const result = data.data?.sellingPlanGroupDelete;

  if (result?.userErrors?.length) {
    return jsonResponse({ success: false, errors: result.userErrors }, { status: 400 });
  }

  return jsonResponse({ success: true, deletedId: result?.deletedSellingPlanGroupId });
}

async function handleAddProducts(admin: any, body: any) {
  const { sellingPlanGroupId, productIds } = body;

  const response = await admin.graphql(
    `#graphql
    mutation addProducts($id: ID!, $productIds: [ID!]!) {
      sellingPlanGroupAddProducts(id: $id, productIds: $productIds) {
        sellingPlanGroup {
          id
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: { id: sellingPlanGroupId, productIds },
    }
  );

  const data = await response.json();
  const result = data.data?.sellingPlanGroupAddProducts;

  if (result?.userErrors?.length) {
    return jsonResponse({ success: false, errors: result.userErrors }, { status: 400 });
  }

  return jsonResponse({ success: true });
}

async function handleRemoveProducts(admin: any, body: any) {
  const { sellingPlanGroupId, productIds } = body;

  const response = await admin.graphql(
    `#graphql
    mutation removeProducts($id: ID!, $productIds: [ID!]!) {
      sellingPlanGroupRemoveProducts(id: $id, productIds: $productIds) {
        removedProductIds
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: { id: sellingPlanGroupId, productIds },
    }
  );

  const data = await response.json();
  const result = data.data?.sellingPlanGroupRemoveProducts;

  if (result?.userErrors?.length) {
    return jsonResponse({ success: false, errors: result.userErrors }, { status: 400 });
  }

  return jsonResponse({ success: true, removedProductIds: result?.removedProductIds });
}

async function handleQuery(admin: any) {
  const response = await admin.graphql(
    `#graphql
    query {
      sellingPlanGroups(first: 50) {
        edges {
          node {
            id
            name
            merchantCode
            options
            sellingPlans(first: 5) {
              edges {
                node {
                  id
                  name
                  options
                  category
                }
              }
            }
            products(first: 20) {
              edges {
                node {
                  id
                  title
                  handle
                  featuredImage {
                    url
                  }
                }
              }
            }
          }
        }
      }
    }`
  );

  const data = await response.json();
  const groups = data.data?.sellingPlanGroups?.edges?.map((e: any) => e.node) ?? [];

  return jsonResponse({ success: true, sellingPlanGroups: groups });
}

async function handleQueryProducts(admin: any) {
  const response = await admin.graphql(
    `#graphql
    query {
      products(first: 50) {
        edges {
          node {
            id
            title
            handle
            status
            featuredImage {
              url
            }
            sellingPlanGroups(first: 5) {
              edges {
                node {
                  id
                  name
                }
              }
            }
          }
        }
      }
    }`
  );

  const data = await response.json();
  const products = data.data?.products?.edges?.map((e: any) => e.node) ?? [];

  return jsonResponse({ success: true, products });
}
