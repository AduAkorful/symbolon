import { redirect } from "next/navigation";

/** The new-invoice screen lives at /vendor/new; this path is what people try first (plan 05zj G, SYM-48) */
export default function NewInvoiceRedirect() {
  redirect("/vendor/new");
}
