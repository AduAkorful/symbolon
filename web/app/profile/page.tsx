import { ProfileView } from "@/components/profile/ProfileView";
import { Shell } from "@/components/shell/Shell";
import { getDb } from "@/lib/server/db";
import { requirePageSession } from "@/lib/server/http";
import { getProfile } from "@/lib/server/profile";
import { loadSpaces } from "@/lib/server/space";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await requirePageSession("/profile");
  const db = await getDb();
  const [where, profileData] = await Promise.all([
    loadSpaces(session),
    getProfile(db, session.user.id, session.sessionId),
  ]);

  const current = where.business
    ? { kind: "business" as const, id: where.business.id }
    : { kind: "vendor" as const };

  return (
    <Shell where={where} current={current}>
      <ProfileView initialData={profileData} />
    </Shell>
  );
}
