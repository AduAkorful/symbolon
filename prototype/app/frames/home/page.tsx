import { HomeView } from "@/components/app/HomeView";
import { Shell } from "@/components/Shell";

export default function HomeFrame() {
  return (
    <Shell active="Home">
      <HomeView linked={false} />
    </Shell>
  );
}
