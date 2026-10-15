// Registers (or removes) the bot's webhook with Telegram (plan 05zr). Run once after the first deploy, from the repo root:
//   pnpm --filter @symbolon/app exec tsx scripts/telegram-webhook.mts https://symbolon-app.vercel.app
//   pnpm --filter @symbolon/app exec tsx scripts/telegram-webhook.mts --remove
// Reads TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET from the root .env; never prints either.
import { resolve } from "node:path";

process.loadEnvFile(resolve(process.cwd(), "../.env"));
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!token || !secret) throw new Error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in the root .env first.");

const remove = process.argv.includes("--remove");
const origin = process.argv.find((a) => a.startsWith("https://"));
if (!remove && !origin) throw new Error("Pass the app's https origin, e.g. https://symbolon-app.vercel.app");

const call = async (method: string, body: Record<string, unknown>) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json()) as { ok: boolean; description?: string };
  if (!json.ok) throw new Error(`${method} failed: ${json.description ?? res.status}`);
  return json;
};

if (remove) {
  await call("deleteWebhook", {});
  console.log("Webhook removed.");
} else {
  await call("setWebhook", { url: `${origin}/api/telegram/webhook`, secret_token: secret, allowed_updates: ["message"] });
  console.log(`Webhook set to ${origin}/api/telegram/webhook`);
}
