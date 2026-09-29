import { Composer } from "@/components/vendor/Composer";

export default async function NewInvoice({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  const prefill =
    from === "upload"
      ? {
          client: "Kite & Co",
          lines: [
            { description: "Illustration set, 12 spot illustrations", qty: "12", price: "150" },
            { description: "Usage licence, 2 years", qty: "1", price: "600" },
          ],
        }
      : undefined;
  return <Composer prefill={prefill} />;
}
