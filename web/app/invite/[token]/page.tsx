import Link from "next/link";
import { notFound } from "next/navigation";
import { AcceptInvitation } from "@/components/vendor/AcceptInvitation";
import { getDb } from "@/lib/server/db";
import { loadInvitation } from "@/lib/server/invitations";
import { getSession } from "@/lib/server/http";
import { mySeal } from "@/lib/server/vendor";
import { buttonClass } from "@/components/ui/button";
import { Eyebrow, PageTitle } from "@/components/ui/Type";

export const dynamic = "force-dynamic";

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = await getDb();
  const [inviteResult, session] = await Promise.all([
    loadInvitation(db, token).then((invite) => ({ ok: true as const, invite }), () => ({ ok: false as const })),
    getSession(),
  ]);
  if (!inviteResult.ok) notFound();
  const invite = inviteResult.invite;
  const hasSeal = session?.user ? Boolean(await mySeal(db, session.user.id)) : false;
  return <main className="mx-auto min-h-screen max-w-[720px] px-6 py-16 md:px-10">
    <Eyebrow>Symbolon · vendor invitation</Eyebrow>
    <PageTitle className="mt-8">{invite.vendorName}</PageTitle>
    <p className="mt-4 text-graphite">{invite.businessName} invited this vendor to connect its Seal. The business says it will send this link through a channel it already trusts.</p>
    <p className="mt-6 border-l-2 border-rule pl-4 text-sm">This link is a secret and can be used once. Only accept if you expected this invitation from {invite.businessName}.</p>
    {session?.user ? hasSeal ? <AcceptInvitation token={token} businessName={invite.businessName} /> : <Link className={buttonClass({ className: "mt-8" })} href={`/vendor/start?next=${encodeURIComponent(`/invite/${token}`)}`}>Create your Seal to continue</Link> : <Link className={buttonClass({ className: "mt-8" })} href={`/signin?next=${encodeURIComponent(`/invite/${token}`)}`}>Sign in to continue</Link>}
  </main>;
}
