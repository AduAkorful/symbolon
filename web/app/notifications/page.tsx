import { NotificationList } from "@/components/notifications/NotificationList";
import { Shell } from "@/components/shell/Shell";
import { getDb } from "@/lib/server/db";
import { requirePageSession } from "@/lib/server/http";
import { listNotifications } from "@/lib/server/notifications";
import { loadSpaces } from "@/lib/server/space";
import { PageContainer } from "@/components/PageContainer";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const session = await requirePageSession("/notifications");
  const where = await loadSpaces(session);
  const db = await getDb();

  const { items, unreadCount } = await listNotifications(db, session.user.id);

  const current = where.business
    ? { kind: "business" as const, id: where.business.id }
    : { kind: "vendor" as const };

  return (
    <Shell where={where} current={current} unreadCount={unreadCount}>
      <PageContainer width="narrow">
        <NotificationList initialItems={items} initialUnreadCount={unreadCount} />
      </PageContainer>
    </Shell>
  );
}
