import type { ReactNode } from "react";
import { chainParams } from "@/lib/server/signer-plan";
import { getConfig } from "@/lib/server/config";
import { PrivyRoot } from "./PrivyRoot";

/** Wraps only the screens that sign in or sign for someone. Public pages (the verify page above all) never load Privy. */
export function PrivyBoundary({ children }: { children: ReactNode }) {
  const config = getConfig();
  if (!config.privy) return <>{children}</>;
  return (
    <PrivyRoot appId={config.privy.appId} chain={chainParams(config.chainId)}>
      {children}
    </PrivyRoot>
  );
}
