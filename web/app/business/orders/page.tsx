import { Shell } from "@/components/shell/Shell";
import { OrdersClient } from "@/components/orders/OrdersClient";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { requirePageSession } from "@/lib/server/http";
import { loadSpaces } from "@/lib/server/space";
import { listOrders } from "@/lib/server/orders";
import { listKnownVendors } from "@/lib/server/vendors";

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

  const cfg = getConfig();
  const db = await getDb();
  const [orders, vendors] = await Promise.all([
    listOrders(db, getClient(), cfg.deployment, session.user, business.id),
    listKnownVendors(db, business.id),
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

  return (
    <Shell where={where} current={{ kind: "business", id: business.id }}>
      <OrdersClient businessId={business.id} initial={serialised} vendors={vendors} />
    </Shell>
  );
}
