import type { Metadata } from "next";
import { Landing } from "@/components/public/Landing";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Symbolon — Payables on Arc",
  description: "Invoices that prove who sent them. Payments that pay you back. Sealed by the vendor, paid from the business's own Vault on Arc.",
};

export default function HomePage() {
  return <Landing />;
}
