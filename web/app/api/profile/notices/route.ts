import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { AuthError } from "@/lib/server/errors";
import { readBody, requireSession, route } from "@/lib/server/http";
import { removeSubscription, saveSubscription } from "@/lib/server/push";
import { loadNoticeSettings, setNoticePref, startTelegramLink, stopTelegram } from "@/lib/server/notice-settings";

/** Notices outside the app (plan 05zr): connect or disconnect Telegram, and choose which notices go to which channel */
export const GET = route(async () => {
  const session = await requireSession();
  return NextResponse.json(await loadNoticeSettings(await getDb(), session.user.id));
});

export const POST = route(async (request) => {
  const session = await requireSession();
  const body = await readBody(request);
  const db = await getDb();
  const userId = session.user.id;
  switch (body.action) {
    case "telegram-connect":
      return NextResponse.json({ url: await startTelegramLink(db, userId) });
    case "telegram-disconnect":
      await stopTelegram(db, userId);
      return NextResponse.json(await loadNoticeSettings(db, userId));
    case "push-subscribe":
      await saveSubscription(db, userId, body.subscription, body.label);
      return NextResponse.json(await loadNoticeSettings(db, userId));
    case "push-remove":
      if (typeof body.id !== "string") throw new AuthError(400, "Which device?");
      await removeSubscription(db, userId, body.id);
      return NextResponse.json(await loadNoticeSettings(db, userId));
    case "set": {
      if (body.channel !== "telegram" && body.channel !== "push") throw new AuthError(400, "Unknown channel.");
      if (typeof body.value !== "boolean") throw new AuthError(400, "A switch is on or off.");
      await setNoticePref(
        db,
        userId,
        body.channel,
        typeof body.kind === "string" ? { kind: body.kind, value: body.value } : { master: body.value },
      );
      return NextResponse.json(await loadNoticeSettings(db, userId));
    }
    default:
      throw new AuthError(400, "Unknown action.");
  }
});
