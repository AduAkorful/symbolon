import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { avatarUrl, removeAvatar, saveAvatar } from "@/lib/server/avatar";
import { AuthError } from "@/lib/server/errors";
import { requireSession, route } from "@/lib/server/http";

/** Set or remove your own picture (plan 05zs). The body is the image's raw bytes; the server decides the type from them. */
export const POST = route(async (request) => {
  const session = await requireSession();
  const declared = request.headers.get("content-type") ?? "";
  if (!/^image\/(jpeg|png|webp)\b/.test(declared)) throw new AuthError(400, "Only JPEG, PNG or WebP pictures can be used.");
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 200 * 1024) throw new AuthError(400, "That picture is too big. Pictures can be up to 100 KB after resizing.");
  const bytes = new Uint8Array(await request.arrayBuffer());
  const { updatedAt } = await saveAvatar(await getDb(), session.user.id, bytes);
  return NextResponse.json({ url: avatarUrl(session.user.id, updatedAt.getTime()) });
});

export const DELETE = route(async () => {
  const session = await requireSession();
  await removeAvatar(await getDb(), session.user.id);
  return NextResponse.json({ url: null });
});
