import "server-only";

/** Telegram delivery of notices (plan 05zr). Off unless all three settings are present. */
export interface TelegramConfig {
  token: string;
  username: string;
  secret: string;
}

let warned = false;
export function telegramConfig(env: NodeJS.ProcessEnv = process.env): TelegramConfig | null {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const username = env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");
  const secret = env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (token && username && secret) return { token, username, secret };
  if ((token || username || secret) && !warned) {
    warned = true;
    console.error("Telegram notices are off: set TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME and TELEGRAM_WEBHOOK_SECRET together.");
  }
  return null;
}

export type SendResult = { ok: true } | { ok: false; blocked: boolean };

/** Plain text only (no Markdown or HTML), so nothing in a notice can be read as markup. The token never appears in a log. */
export async function sendTelegramMessage(cfg: TelegramConfig, chatId: string, text: string): Promise<SendResult> {
  const post = () =>
    fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(5000),
    });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await post();
      if (res.ok) return { ok: true };
      // 403: the person blocked the bot or deleted the chat; 400 "chat not found" is the same to us
      if (res.status === 403 || res.status === 400) return { ok: false, blocked: true };
      if (res.status < 500 && res.status !== 429) return { ok: false, blocked: false };
    } catch {
      /* network error: one more try */
    }
  }
  return { ok: false, blocked: false };
}


export {
  consumeLinkCode,
  createLinkCode,
  handleUpdate,
  linkedChat,
  secretMatches,
  unlinkChat,
  type TelegramUpdate,
} from "@symbolon/core";
