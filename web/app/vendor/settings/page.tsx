import { ChangePayoutAddressSection } from "@/components/vendor/ChangePayoutAddressSection";
import { PayoutForm } from "@/components/vendor/PayoutForm";
import { Shell } from "@/components/shell/Shell";
import { getConfig } from "@/lib/server/config";
import { signerPlanFor } from "@/lib/server/signer-plan";
import { requireVendorPage } from "@/lib/server/vendor-page";

export const dynamic = "force-dynamic";

export default async function VendorSettings() {
  const { session, seal, where } = await requireVendorPage("/vendor/settings");
  const config = getConfig();
  const signer = signerPlanFor(session, config);

  return (
    <Shell where={where} current={{ kind: "vendor" }}>
      <div className="max-w-[760px]">
        <h1 className="font-display text-4xl leading-tight">Settings</h1>
        <dl className="mt-6 border-t border-rule text-sm">
          {[
            ["Name on invoices", seal.displayName],
            ["Handle", `@${seal.handle}`],
            ["Seal (your wallet)", seal.address],
            ["Website", seal.website ?? "—"],
          ].map(([k, v]) => (
            <div key={k} className="grid grid-cols-[10rem_1fr] gap-3 border-b border-rule-soft py-3">
              <dt className="text-graphite">{k}</dt>
              <dd className="break-all">{v}</dd>
            </div>
          ))}
        </dl>
        <h2 className="mt-10 font-display text-2xl">Default payout address</h2>
        <PayoutForm initial={seal.payoutAddress} sealAddress={seal.address} />

        <ChangePayoutAddressSection
          currentPayout={seal.payoutAddress}
          sealAddress={seal.address}
          signer={signer}
        />
      </div>
    </Shell>
  );
}
