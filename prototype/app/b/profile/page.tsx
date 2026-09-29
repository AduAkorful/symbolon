import { Reveal } from "@/components/app/Reveal";
import { ProfileView } from "@/components/ProfileView";

export default function Page() {
  return (
    <Reveal>
      <ProfileView side="business" />
    </Reveal>
  );
}
