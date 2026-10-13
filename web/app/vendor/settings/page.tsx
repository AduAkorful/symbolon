import { ChangePayoutAddressSection } from "@/components/vendor/ChangePayoutAddressSection";
import { PayoutForm } from "@/components/vendor/PayoutForm";
import { ProfileForm } from "@/components/vendor/ProfileForm";
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
          <div className="grid gap-1 py-3.5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
            <dt className="text-graphite">Seal (your wallet)</dt>
            <dd className="min-w-0 break-words"><Address value={seal.address} full copy /></dd>
          </div>
        </dl>
        <SectionTitle className="mt-12">Your profile</SectionTitle>
        <ProfileForm initialName={seal.displayName} initialWebsite={seal.website} handle={seal.handle} />
        <SectionTitle className="mt-12">Default payout address</SectionTitle>
        <PayoutForm initial={seal.payoutAddress} sealAddress={seal.address} />

        <ChangePayoutAddressSection currentPayout={seal.payoutAddress} sealAddress={seal.address} signer={signer} />
      </div>
    </Shell>
  );
}
