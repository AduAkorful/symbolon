import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { loadAvatar } from "@/lib/server/avatar";
import { requireSession, routeWith } from "@/lib/server/http";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A picture, only to people who may see it. Not allowed and not set both answer 404, so existence isn't leaked (plan 05zs). */
export const GET = routeWith<{ params: Promise<{ userId: string }> }>(async (_request, ctx) => {
  const session = await requireSession();
  const { userId } = await ctx.params;
  if (!UUID.test(userId)) return new NextResponse(null, { status: 404 });
  const found = await loadAvatar(await getDb(), session.user.id, userId);
  if (!found) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(found.bytes), {
    headers: {
      "Content-Type": found.type,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
      "Cache-Control": "private, max-age=300",
      ETag: `"${found.version}"`,
    },
  });
});
