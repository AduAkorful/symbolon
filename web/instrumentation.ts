// Runs once when the server starts: a wrong or missing chain setting stops the app here, with a named error.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getConfig } = await import("@/lib/server/config");
    getConfig();
    // off-app mirrors of notices (Telegram, push; plan 05zr); each is a no-op until its settings are present
    const { registerNoticeDelivery } = await import("@/lib/server/notice-delivery");
    registerNoticeDelivery();
  }
}
