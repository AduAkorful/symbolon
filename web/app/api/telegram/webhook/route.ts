import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { handleUpdate, secretMatches, sendTelegramMessage, telegramConfig, type TelegramUpdate } from "@/lib/server/telegram";

export const dynamic = "force-dynamic";

/**
 * Telegram calls this with each message to the bot (plan 05zr 4.2). No session and no Origin: the shared secret header is the only
 * door, and a wrong one gets a 401 before anything is read. Message text and codes are never logged.
 */
export async function POST(request: Request) {
  const cfg = telegramConfig();
  if (!cfg) return new NextResponse(null, { status: 404 });
  if (!secretMatches(request.headers.get("x-telegram-bot-api-secret-token"), cfg.secret)) return new NextResponse(null, { status: 401 });
  const update = (await request.json().catch(() => null)) as TelegramUpdate | null;
  if (!update || typeof update !== "object") return NextResponse.json({ ok: true });
  try {
    const out = await handleUpdate(await getDb(), update);
    if (out) {
      await sendTelegramMessage(cfg, out.chatId, out.reply);
      if (out.also) await sendTelegramMessage(cfg, out.also.chatId, out.also.reply);
    }
  } catch (e) {
    console.error("telegram webhook failed", e instanceof Error ? e.message : "unknown");
  }
  // always 200: Telegram retries anything else, and a retried /start would only find a used code
  return NextResponse.json({ ok: true });
}
