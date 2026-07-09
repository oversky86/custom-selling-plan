import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { login } from "../../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  return (
    <div style={{ padding: "40px", textAlign: "center" }}>
      <h1>Custom Selling Plan</h1>
      <p>This app helps you create deposit-based selling plans for your products.</p>
    </div>
  );
}
