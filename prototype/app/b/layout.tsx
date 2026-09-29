import type { ReactNode } from "react";
import { AppShell } from "@/components/app/AppShell";
import { PauseProvider } from "@/components/app/pause";
import { ReleaseProvider } from "@/components/app/release";

export default function BusinessLayout({ children }: { children: ReactNode }) {
  return (
    <PauseProvider>
      <ReleaseProvider>
        <AppShell>{children}</AppShell>
      </ReleaseProvider>
    </PauseProvider>
  );
}
