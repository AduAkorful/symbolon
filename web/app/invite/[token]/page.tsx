import Link from "next/link";
import { notFound } from "next/navigation";
import { AcceptInvitation } from "@/components/vendor/AcceptInvitation";
import { getDb } from "@/lib/server/db";
import { loadInvitation } from "@/lib/server/invitations";
import { getSession } from "@/lib/server/http";
import { mySeal } from "@/lib/server/vendor";

export const dynamic = "force-dynamic";

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let invite;
  try { invite = await loadInvitation(await getDb(), token); } catch { notFound(); }
  const session = await getSession();
  const hasSeal = session?.user ? Boolean(await mySeal(await getDb(), session.user.id)) : false;
  return <main className="mx-auto min-h-screen max-w-[720px] px-6 py-16 md:px-10">
    <p className="font-mono text-xs uppercase tracking-[0.16em] text-graphite">Symbolon · vendor invitation</p>
    <h1 className="mt-8 font-display text-4xl leading-tight">{invite.vendorName}</h1>
    <p className="mt-4 text-graphite">{invite.businessName} invited this vendor to connect its Seal. The business says it will send this link through a channel it already trusts.</p>
    <p className="mt-6 border-l-2 border-rule pl-4 text-sm">This link is a secret and can be used once. Only accept if you expected this invitation from {invite.businessName}.</p>
    {session?.user ? hasSeal ? <AcceptInvitation token={token} /> : <Link className="mt-8 inline-block rounded-doc bg-ink px-5 py-3 font-medium text-paper" href={`/vendor/start?next=${encodeURIComponent(`/invite/${token}`)}`}>Create your Seal to continue</Link> : <Link className="mt-8 inline-block rounded-doc bg-ink px-5 py-3 font-medium text-paper" href={`/signin?next=${encodeURIComponent(`/invite/${token}`)}`}>Sign in to continue</Link>}
  </main>;
}
