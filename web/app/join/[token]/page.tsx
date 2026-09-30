import Link from "next/link";
import { notFound } from "next/navigation";
import { AcceptTeamInvitation } from "@/components/team/AcceptTeamInvitation";
import { getDb } from "@/lib/server/db";
import { getSession } from "@/lib/server/http";
import { getInvitationByToken } from "@/lib/server/team-invitations";

export const dynamic = "force-dynamic";

export default async function JoinTeamPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const db = await getDb();

  let invite;
  try {
    invite = await getInvitationByToken(db, token);
  } catch {
    notFound();
  }

  const session = await getSession();
  const hasWallet = Boolean(session?.user?.wallet);

  return (
    <main className="mx-auto min-h-screen max-w-[720px] px-6 py-16 md:px-10">
      <p className="font-mono text-xs uppercase tracking-[0.16em] text-graphite">
        Symbolon · Team invitation
      </p>

      <h1 className="mt-8 font-display text-4xl leading-tight font-medium text-ink">
        Join {invite.businessName}
      </h1>

      <p className="mt-4 text-graphite text-sm leading-relaxed">
        You have been invited to join <span className="text-ink font-medium">{invite.businessName}</span> with the role of{" "}
        <span className="capitalize text-ink font-medium font-mono">{invite.role}</span>.
      </p>

      <p className="mt-6 border-l-2 border-rule pl-4 text-xs text-graphite leading-relaxed">
        This link is a bearer secret and can only be used once. Only accept if you expected this invitation from {invite.businessName}.
      </p>

      {!session?.user ? (
        <div className="mt-8">
          <Link
            className="inline-block rounded-doc bg-ink px-6 py-3 text-sm font-medium text-paper hover:bg-ink/90 transition-colors"
            href={`/signin?next=${encodeURIComponent(`/join/${token}`)}`}
          >
            Sign in to continue
          </Link>
        </div>
      ) : !hasWallet ? (
        <div className="mt-8 rounded-doc border border-amber-500/30 bg-amber-500/5 p-4 text-xs text-amber-700 dark:text-amber-300">
          <p className="font-medium">Wallet required</p>
          <p className="mt-1">
            Your account must have an active wallet to join a Symbolon business team. Please link a wallet to your account.
          </p>
        </div>
      ) : (
        <AcceptTeamInvitation token={token} />
      )}
    </main>
  );
}
