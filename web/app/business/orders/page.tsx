import { Suspense } from "react";
import { Shell } from "@/components/shell/Shell";
import { OrdersClient } from "@/components/orders/OrdersClient";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { requirePageSession, type CurrentSession } from "@/lib/server/http";
import { loadSpaces } from "@/lib/server/space";
import { listOrders } from "@/lib/server/orders";
import { listKnownVendors } from "@/lib/server/vendors";
import { PageLoading } from "@/components/ui/PageLoading";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const session = await requirePageSession("/business/orders");
  const where = await loadSpaces(session);
  const business = where.business;

  if (!business) {
    return (
      <Shell where={where} current={{ kind: "business", id: "" }}>
        <p>You don't belong to a business yet.</p>
      </Shell>
    );
  }

  return (
    <Shell where={where} current={{ kind: "business", id: business.id }}>
      <Suspense fallback={<PageLoading title="Orders" shape="list" />}>
        <OrdersContent session={session} businessId={business.id} />
      </Suspense>
    </Shell>
  );
}

async function OrdersContent({ session, businessId }: { session: CurrentSession; businessId: string }) {
  const cfg = getConfig();
  const db = await getDb();
  const [orders, vendors] = await Promise.all([
    listOrders(db, getClient(), cfg.deployment, session.user, businessId),
    listKnownVendors(db, businessId),
  ]);

  // Serialise BigInt fields to strings for client hydration
  const serialised = orders.map((o) => ({
    ...o,
    amount: String(o.amount),
    invoicedTotal: String(o.invoicedTotal),
    paidTotal: String(o.paidTotal),
    releaseAfter: o.releaseAfter?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
    closedAt: o.closedAt?.toISOString() ?? null,
    live: o.live,
  }));

  return <OrdersClient businessId={businessId} initial={serialised} vendors={vendors} explorer={cfg.deployment.explorer} />;
}
