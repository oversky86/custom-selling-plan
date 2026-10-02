import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

const CREATE_CONFIRM_MODAL_ID = "create-plan-modal";
const DELETE_CONFIRM_MODAL_ID = "delete-plan-modal";

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
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const createLockedRef = useRef(false);
  const deleteLockedRef = useRef(false);

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

  const isCreating = actionFetcher.state === "submitting";

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

  const openCreateConfirm = () => {
    if (isCreating || createLockedRef.current) return;
    shopify.modal.show(CREATE_CONFIRM_MODAL_ID);
  };

  const confirmCreate = () => {
    if (isCreating || createLockedRef.current) return;
    createLockedRef.current = true;
    shopify.modal.hide(CREATE_CONFIRM_MODAL_ID);
    handleCreate();
  };

  useEffect(() => {
    if (actionFetcher.state === "idle") {
      createLockedRef.current = false;
      deleteLockedRef.current = false;
    }
  }, [actionFetcher.state]);

  const handleDelete = (groupId: string) => {
    actionFetcher.submit(
      { action: "delete", sellingPlanGroupId: groupId },
      { method: "POST", action: "/api/selling-plans", encType: "application/json" }
    );
  };

  const openDeleteConfirm = (groupId: string, groupName: string) => {
    if (isCreating || deleteLockedRef.current) return;
    flushSync(() => {
      setPendingDelete({ id: groupId, name: groupName });
    });
    shopify.modal.show(DELETE_CONFIRM_MODAL_ID);
  };

  const confirmDelete = () => {
    if (isCreating || deleteLockedRef.current || !pendingDelete) return;
    deleteLockedRef.current = true;
    const groupId = pendingDelete.id;
    shopify.modal.hide(DELETE_CONFIRM_MODAL_ID);
    handleDelete(groupId);
  };

  const toggleProduct = (productId: string) => {
    setSelectedProducts((prev) =>
      prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId]
    );
  };

  const groups = groupsFetcher.data?.sellingPlanGroups || [];
  const products = productsFetcher.data?.products || [];

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
            type="button"
            onClick={openCreateConfirm}
            {...(isCreating ? { loading: true } : {})}
          >
            Create Plan ({depositPct}% deposit, {100 - parseInt(depositPct)}% on shipment)
          </s-button>
        </s-stack>
      </s-section>

      <s-modal id={CREATE_CONFIRM_MODAL_ID} heading="Create plan?" size="small-100">
        <s-paragraph>This will update the store configuration.</s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          onClick={confirmCreate}
          {...(isCreating ? { loading: true } : {})}
        >
          Create Plan
        </s-button>
        <s-button
          slot="secondary-actions"
          variant="secondary"
          commandFor={CREATE_CONFIRM_MODAL_ID}
          command="--hide"
        >
          Cancel
        </s-button>
      </s-modal>

      <s-modal id={DELETE_CONFIRM_MODAL_ID} heading="Delete plan?" size="small-100">
        <s-paragraph>
          {pendingDelete?.name
            ? `This will remove "${pendingDelete.name}" from the store.`
            : "This will remove the plan from the store."}
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          onClick={confirmDelete}
          {...(isCreating ? { loading: true } : {})}
        >
          Delete
        </s-button>
        <s-button
          slot="secondary-actions"
          variant="secondary"
          commandFor={DELETE_CONFIRM_MODAL_ID}
          command="--hide"
        >
          Cancel
        </s-button>
      </s-modal>

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
                    onClick={() => openDeleteConfirm(group.id, group.name ?? "")}
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
