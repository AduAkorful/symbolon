import { RefusalView } from "@/components/app/RefusalView";
import { Shell } from "@/components/Shell";

export default function RefusalFrame() {
  return (
    <Shell active="Inbox">
      <RefusalView />
    </Shell>
  );
}
