import { useEffect, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function Index() {
  const shopify = useAppBridge();
  const groupsFetcher = useFetcher();
  const productsFetcher = useFetcher();
  const actionFetcher = useFetcher();

  const [depositPct, setDepositPct] = useState("20");
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [planName, setPlanName] = useState("Deposit Purchase");

  // Load existing selling plan groups and products on mount
  useEffect(() => {
    groupsFetcher.submit(
      { action: "query" },
      { method: "POST", action: "/api/selling-plans", encType: "application/json" }
    );
    productsFetcher.submit(
      { action: "queryProducts" },
      { method: "POST", action: "/api/selling-plans", encType: "application/json" }
    );
  }, []);

  // Refresh groups after create/delete
  useEffect(() => {
    const data = actionFetcher.data;
    if (!data) return;

    if (data.success && data.sellingPlanGroup) {
      shopify.toast.show(`Selling Plan "${data.sellingPlanGroup.name}" created!`);
      groupsFetcher.submit(
        { action: "query" },
        { method: "POST", action: "/api/selling-plans", encType: "application/json" }
      );
      productsFetcher.submit(
        { action: "queryProducts" },
        { method: "POST", action: "/api/selling-plans", encType: "application/json" }
      );
      setSelectedProducts([]);
    } else if (data.success && data.deletedId) {
      shopify.toast.show("Selling Plan deleted!");
      groupsFetcher.submit(
        { action: "query" },
        { method: "POST", action: "/api/selling-plans", encType: "application/json" }
      );
      productsFetcher.submit(
        { action: "queryProducts" },
        { method: "POST", action: "/api/selling-plans", encType: "application/json" }
      );
    } else if (data.errors) {
      const msg = data.errors.map((e: any) => e.message).join(", ");
      shopify.toast.show(`Error: ${msg}`, { isError: true });
    }
  }, [actionFetcher.data, shopify]);

  const handleCreate = () => {
    actionFetcher.submit(
      {
        action: "create",
        name: planName,
        depositPercentage: parseInt(depositPct),
        productIds: selectedProducts,
      },
      { method: "POST", action: "/api/selling-plans", encType: "application/json" }
    );
  };

  const handleDelete = (groupId: string) => {
    actionFetcher.submit(
      { action: "delete", sellingPlanGroupId: groupId },
      { method: "POST", action: "/api/selling-plans", encType: "application/json" }
    );
  };

  const toggleProduct = (productId: string) => {
    setSelectedProducts((prev) =>
      prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId]
    );
  };

  const groups = groupsFetcher.data?.sellingPlanGroups || [];
  const products = productsFetcher.data?.products || [];
  const isCreating = actionFetcher.state === "submitting";

  return (
    <s-page heading="Selling Plan Manager">
      {/* Create New Plan */}
      <s-section heading="Create Deposit Plan">
        <s-paragraph>
          Create a selling plan where customers pay a deposit now and the rest on shipment.
        </s-paragraph>

        <s-stack direction="block" gap="base">
          <s-text-field
            label="Plan Name"
            value={planName}
            onChange={(e: any) => setPlanName(e.target.value)}
          />

          <s-text-field
            label="Deposit Percentage (%)"
            type="number"
            value={depositPct}
            onChange={(e: any) => setDepositPct(e.target.value)}
          />

          <s-heading>Select Products</s-heading>
          {products.length === 0 ? (
            <s-paragraph>No products found in the store.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="small">
              {products.map((product: any) => {
                const isSelected = selectedProducts.includes(product.id);
                return (
                  <s-box
                    key={product.id}
                    padding="base"
                    borderWidth="base"
                    borderRadius="base"
                    background={isSelected ? "subdued" : undefined}
                  >
                    <s-stack direction="inline" gap="base" blockAlign="center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleProduct(product.id)}
                        style={{ width: "18px", height: "18px", cursor: "pointer" }}
                      />
                      <span onClick={() => toggleProduct(product.id)} style={{ cursor: "pointer" }}>
                        <strong>{product.title}</strong>
                        {product.sellingPlanGroups?.edges?.length > 0 && (
                          <span style={{ color: "#666", marginLeft: "8px" }}>
                            ({product.sellingPlanGroups.edges.length} plan)
                          </span>
                        )}
                      </span>
                    </s-stack>
                  </s-box>
                );
              })}
            </s-stack>
          )}

          <s-button
            onClick={handleCreate}
            {...(isCreating ? { loading: true } : {})}
          >
            Create Plan ({depositPct}% deposit, {100 - parseInt(depositPct)}% on shipment)
          </s-button>
        </s-stack>
      </s-section>

      {/* Existing Plans */}
      <s-section heading="Existing Selling Plans">
        {groups.length === 0 ? (
          <s-paragraph>No selling plans yet. Create one above!</s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {groups.map((group: any) => (
              <s-box
                key={group.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack direction="block" gap="small">
                  <s-stack direction="inline" gap="base" blockAlign="center">
                    <s-heading>{group.name}</s-heading>
                    <span style={{ color: "#666" }}>({group.merchantCode})</span>
                  </s-stack>

                  {group.sellingPlans?.edges?.map((planEdge: any) => (
                    <s-paragraph key={planEdge.node.id}>
                      Plan: <strong>{planEdge.node.name}</strong> ({planEdge.node.category})
                    </s-paragraph>
                  ))}

                  {group.products?.edges?.length > 0 && (
                    <s-paragraph>
                      Products: {group.products.edges.map((pe: any) => pe.node.title).join(", ")}
                    </s-paragraph>
                  )}

                  <s-button
                    onClick={() => handleDelete(group.id)}
                    variant="tertiary"
                  >
                    Delete
                  </s-button>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
