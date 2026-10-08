import Link from "next/link";
import { notFound } from "next/navigation";
import { AcceptTeamInvitation } from "@/components/team/AcceptTeamInvitation";
import { getDb } from "@/lib/server/db";
import { getSession } from "@/lib/server/http";
import { getInvitationByToken } from "@/lib/server/team-invitations";
import { buttonClass } from "@/components/ui/button";
import { Eyebrow, PageTitle } from "@/components/ui/Type";

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
      <Eyebrow>
        Symbolon · Team invitation
      </Eyebrow>

      <PageTitle className="mt-8">
        Join {invite.businessName}
      </PageTitle>

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
            className={buttonClass()}
            href={`/signin?next=${encodeURIComponent(`/join/${token}`)}`}
          >
            Sign in to continue
          </Link>
        </div>
      ) : !hasWallet ? (
        <div className="mt-8 rounded-doc border border-warn/40 bg-warn-wash p-4 text-xs text-warn ">
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
