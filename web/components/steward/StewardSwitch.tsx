"use client";

import { type SignerPlan } from "@/components/setup/owner-signer";
import { Address } from "@/components/Address";
import { PauseControl } from "./PauseControl";

export function StewardSwitch(props: {
  businessId: string;
  state: "paused" | "active";
  block: string;
  steward: string;
  signer: SignerPlan | null;
  explorer: string;
}) {
  const paused = props.state === "paused";

  return (
    <>
      <p>
        <span className={`font-medium ${paused ? "text-red" : "text-ink"}`}>{paused ? "Paused" : "Active"}</span>
        <span className="ml-2 text-graphite">
          {paused ? "It can’t pay anything until you resume it. " : "It can act within the Vault’s rules. "}
          Checked with Arc just now.
        </span>
      </p>
      <div className="mt-2">
        <Address value={props.steward} full explorer={props.explorer} copy />
      </div>
      <PauseControl
        businessId={props.businessId}
        paused={paused}
        block={props.block}
        signer={props.signer}
        explorer={props.explorer}
      />
    </>
  );
}
