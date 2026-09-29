// Runs once when the server starts: a wrong or missing chain setting stops the app here, with a named error.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getConfig } = await import("@/lib/server/config");
    getConfig();
  }
}
