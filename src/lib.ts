// Pure helpers, kept out of index.ts: a Worker's main module may only export handlers.

/** Distinct visitors one IP may add per month (people sharing Wi-Fi, an office, a carrier). */
export const MAX_VISITORS_PER_IP = 20;
/** Cities with fewer visitors stay off the public stats so nobody can be singled out. */
export const MIN_CITY_VISITORS = 3;
const BOT_UA = /bot|crawl|spider|slurp|headless|preview|lighthouse|monitor|curl|wget|python|httpclient|java\/|go-http/i;

/** Canonical page path, or null if it isn't one we'd count. "/x/index.html" → "/x/". */
export function normalizePage(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 200) return null;
  if (!/^\/[A-Za-z0-9/._~%-]*$/.test(value) || value.includes("//") || value.includes("..")) return null;
  return value.replace(/(^|\/)index\.html$/, "$1");
}

export function isBot(ua: string): boolean {
  return ua.length < 10 || BOT_UA.test(ua);
}

/** The last `n` months, oldest first, ending with the current one: ["2025-12", …, "2026-11"]. */
export function lastMonths(n: number, now = new Date()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

export type Device = "mobile" | "desktop";

/**
 * Phones and tablets are "mobile". iPads that ask for the desktop site look like a Mac
 * and count as desktop; that's the best the User-Agent can tell.
 */
export function deviceType(ua: string): Device {
  return /Mobi|Android|iPhone|iPad|iPod|Windows Phone|webOS|BlackBerry|Opera Mini|IEMobile|Silk/i.test(ua)
    ? "mobile"
    : "desktop";
}
