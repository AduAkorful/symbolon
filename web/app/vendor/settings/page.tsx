import { ChangePayoutAddressSection } from "@/components/vendor/ChangePayoutAddressSection";
import { PayoutForm } from "@/components/vendor/PayoutForm";
import { Shell } from "@/components/shell/Shell";
import { getConfig } from "@/lib/server/config";
import { signerPlanFor } from "@/lib/server/signer-plan";
import { requireVendorPage } from "@/lib/server/vendor-page";
import { Address } from "@/components/Address";
import { PageTitle, SectionTitle } from "@/components/ui/Type";

export const dynamic = "force-dynamic";

export default async function VendorSettings() {
  const { session, seal, where } = await requireVendorPage("/vendor/settings");
  const config = getConfig();
  const signer = signerPlanFor(session, config);

  return (
    <Shell where={where} current={{ kind: "vendor" }}>
      <div>
        <PageTitle>Settings</PageTitle>
        <dl className="mt-8 divide-y divide-rule-soft rounded-doc border border-rule px-5 text-sm">
          {([
            ["Name on invoices", seal.displayName],
            ["Handle", `@${seal.handle}`],
            ["Seal (your wallet)", <Address key="a" value={seal.address} full copy />],
            ["Website", seal.website ?? "—"],
          ] as [string, React.ReactNode][]).map(([label, v]) => (
            <div key={label} className="grid gap-1 py-3.5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
              <dt className="text-graphite">{label}</dt>
              <dd className="min-w-0 break-words">{v}</dd>
            </div>
          ))}
        </dl>
        <SectionTitle className="mt-12">Default payout address</SectionTitle>
        <PayoutForm initial={seal.payoutAddress} sealAddress={seal.address} />

        <ChangePayoutAddressSection currentPayout={seal.payoutAddress} sealAddress={seal.address} signer={signer} />
      </div>
    </Shell>
  );
}
