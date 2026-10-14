import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { getAddress } from "viem";

import { businesses, invoices, seals, type Database } from "@symbolon/db";

export interface SubjectRef {
  label: string;
  href: string | null;
}

const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * What a decision's subject is called to a person (plan 05zj E, SYM-29). Decisions have subjects of several kinds: an invoice's
 * fingerprint, a vendor's Seal, the business itself, a treasury action, a purchase-order reference. Writing "Invoice 0x1234…" for
 * all of them and linking each to the inbox was wrong for every kind but the first. Anything unrecognised is said as what it is,
 * never as an invoice.
 */
export async function subjectRefs(db: Database, businessId: string, subjects: (string | null)[]): Promise<Map<string, SubjectRef>> {
  const wanted = [...new Set(subjects.filter((s): s is string => Boolean(s)))];
  const out = new Map<string, SubjectRef>();
  const hashes = wanted.filter((s) => HASH.test(s)).map((s) => s.toLowerCase());
  const addresses = wanted.filter((s) => ADDRESS.test(s)).map((s) => s.toLowerCase());

  const [invoiceRows, sealRows, [business]] = await Promise.all([
    hashes.length
      ? db
          .select({ fingerprint: invoices.fingerprint, number: invoices.invoiceNumber, seal: invoices.seal })
          .from(invoices)
          .where(and(eq(invoices.businessId, businessId), inArray(invoices.fingerprint, hashes)))
      : Promise.resolve([]),
    addresses.length ? db.select({ address: seals.address, displayName: seals.displayName, handle: seals.handle }).from(seals).where(inArray(seals.address, addresses)) : Promise.resolve([]),
    db.select({ vault: businesses.vault }).from(businesses).where(eq(businesses.id, businessId)).limit(1),
  ]);

  // an invoice names its vendor by Seal; those Seals are not among the subjects, so they are read here (QA payment retest: the
  // list said "from a vendor" for every invoice)
  const known = new Set(sealRows.map((s) => s.address.toLowerCase()));
  const invoiceSeals = [...new Set(invoiceRows.map((r) => r.seal.toLowerCase()))].filter((a) => !known.has(a));
  const moreSeals = invoiceSeals.length
    ? await db.select({ address: seals.address, displayName: seals.displayName, handle: seals.handle }).from(seals).where(inArray(seals.address, invoiceSeals))
    : [];
  const vendorOf = new Map([...sealRows, ...moreSeals].map((s) => [s.address.toLowerCase(), s.displayName || s.handle || s.address]));
  const invoiceBy = new Map(invoiceRows.map((r) => [r.fingerprint.toLowerCase(), r]));

  for (const subject of wanted) {
    const key = subject.toLowerCase();
    if (HASH.test(subject)) {
      const inv = invoiceBy.get(key);
      out.set(
        subject,
        inv
          ? { label: `Invoice ${inv.number} from ${vendorOf.get(inv.seal.toLowerCase()) ?? "a vendor"}`, href: `/business/inbox/${inv.fingerprint}` }
          : { label: `Reference ${subject.slice(0, 10)}…`, href: null },
      );
    } else if (ADDRESS.test(subject)) {
      const vendor = vendorOf.get(key);
      if (vendor) out.set(subject, { label: vendor, href: `/business/vendors/${key}` });
      else if (business?.vault && business.vault.toLowerCase() === key) out.set(subject, { label: "This business's Vault", href: null });
      else out.set(subject, { label: getAddress(subject), href: null });
    } else if (UUID.test(subject)) {
      out.set(subject, subject === businessId ? { label: "This business", href: null } : { label: "A record", href: null });
    } else if (subject.startsWith("treasury")) {
      out.set(subject, { label: "Treasury", href: "/business/treasury" });
    } else {
      out.set(subject, { label: subject.length <= 40 ? subject : `${subject.slice(0, 40)}…`, href: null });
    }
  }
  return out;
}
