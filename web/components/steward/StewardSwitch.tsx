"use client";

import { type SignerPlan } from "@/components/setup/owner-signer";
import { TxLink } from "@/components/TxLink";
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
      <span className={paused ? "text-red" : "text-ink"}>{paused ? "Paused" : "Active"}</span>
      <span className="ml-2 text-xs text-graphite">
        {paused ? "It can’t pay anything until you resume it. " : "It can act within the Vault’s rules. "}
        Read from Arc at block {props.block}.
      </span>
      <span className="mt-1 block">
        <TxLink href={`${props.explorer}/address/${props.steward}`} label="View the Steward's wallet on the Arc explorer" className="break-all">
          {props.steward}
        </TxLink>
      </span>
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
