import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Counts } from "../src/index";
import { deviceType, isBot, lastMonths, MAX_VISITORS_PER_IP, normalizePage } from "../src/lib";

const SITE = "https://daplein.github.io";
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1";
const ANDROID_TABLET = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";

interface Visit {
  page?: string;
  ip?: string;
  ua?: string;
  origin?: string;
  where?: { country?: string; region?: string; city?: string };
}

async function hit({ page = "/", ip = "203.0.113.1", ua = CHROME, origin = SITE, where = {} }: Visit = {}) {
  const req = new Request("https://api.test/hit", {
    method: "POST",
    headers: { Origin: origin, "User-Agent": ua, "CF-Connecting-IP": ip, "Content-Type": "application/json" },
    body: JSON.stringify({ page }),
    cf: { country: "IE", region: "Leinster", city: "Dublin", ...where },
  } as RequestInit);
  return worker.fetch(req, env);
}

async function counts(visit: Visit = {}): Promise<Counts> {
  const res = await hit(visit);
  expect(res.status).toBe(200);
  return res.json();
}

async function stats() {
  const res = await worker.fetch(new Request("https://api.test/stats"), env);
  expect(res.status).toBe(200);
  return res.json<any>();
}

beforeEach(async () => {
  const tables = ["visitors", "site_months", "page_visitors", "page_months", "counters"];
  await env.DB.batch(tables.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
});

describe("POST /hit", () => {
  it("counts a visitor once, however often they come back", async () => {
    expect(await counts()).toEqual({ site: { total: 1, month: 1 }, page: { total: 1, month: 1 }, counted: true });
    expect(await counts()).toEqual({ site: { total: 1, month: 1 }, page: { total: 1, month: 1 }, counted: true });
  });

  it("counts site and page separately", async () => {
    await counts({ page: "/" });
    const c = await counts({ page: "/pickleball-training.html" });
    expect(c.site).toEqual({ total: 1, month: 1 });
    expect(c.page).toEqual({ total: 1, month: 1 });

    const other = await counts({ page: "/pickleball-training.html", ip: "198.51.100.7" });
    expect(other.site.total).toBe(2);
    expect(other.page.total).toBe(2);
  });

  it("tells apart two browsers behind one IP", async () => {
    await counts({ ua: CHROME });
    const c = await counts({ ua: CHROME.replace("Chrome/131", "Chrome/132") });
    expect(c.site.total).toBe(2);
  });

  it("treats /x/index.html and /x/ as the same page", async () => {
    await counts({ page: "/apps/index.html" });
    const c = await counts({ page: "/apps/", ip: "198.51.100.7" });
    expect(c.page.total).toBe(2);
  });

  it("doesn't count bots, but still answers", async () => {
    const c = await counts({ ua: "Mozilla/5.0 (compatible; Googlebot/2.1)" });
    expect(c).toMatchObject({ site: { total: 0 }, counted: false });
  });

  it("caps how many visitors one IP can add per month", async () => {
    for (let i = 0; i < MAX_VISITORS_PER_IP; i++) await counts({ ua: `${CHROME} v${i}` });
    const extra = await counts({ ua: `${CHROME} one-too-many` });
    expect(extra).toMatchObject({ site: { total: MAX_VISITORS_PER_IP }, counted: false });

    // Someone already counted from that IP can still open new pages.
    const known = await counts({ ua: `${CHROME} v0`, page: "/game-plan.html" });
    expect(known).toMatchObject({ page: { total: 1 }, counted: true });
  });

  it("only accepts the site's origin", async () => {
    const res = await hit({ origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect((await stats()).total).toBe(0);
  });

  it("rejects bad page paths", async () => {
    for (const page of ["", "pickleball", "/../etc", "//evil", "/a?b=1", "/" + "x".repeat(300)]) {
      expect((await hit({ page })).status, page).toBe(400);
    }
  });

  it("answers CORS preflight for the site only", async () => {
    const pre = (origin: string) =>
      worker.fetch(new Request("https://api.test/hit", { method: "OPTIONS", headers: { Origin: origin } }), env);
    const ok = await pre(SITE);
    expect(ok.status).toBe(204);
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe(SITE);
    expect((await pre("https://evil.example")).status).toBe(403);
  });

  it("never stores the raw IP", async () => {
    await counts({ ip: "203.0.113.99" });
    const tables = ["visitors", "site_months", "page_visitors", "page_months", "counters"];
    for (const t of tables) {
      const { results } = await env.DB.prepare(`SELECT * FROM ${t}`).all();
      expect(JSON.stringify(results), t).not.toContain("203.0.113.99");
    }
  });
});

describe("GET /count", () => {
  it("reads without counting", async () => {
    await counts();
    const res = await worker.fetch(new Request("https://api.test/count?page=/"), env);
    expect(await res.json()).toEqual({ site: { total: 1, month: 1 }, page: { total: 1, month: 1 }, counted: false });
    expect((await stats()).total).toBe(1);
  });
});

describe("GET /stats", () => {
  it("adds up countries, cities and pages", async () => {
    const dublin = { country: "IE", region: "Leinster", city: "Dublin" };
    const cork = { country: "IE", region: "Munster", city: "Cork" };
    const paris = { country: "FR", region: "Île-de-France", city: "Paris" };
    for (let i = 1; i <= 3; i++) await counts({ ip: `10.0.0.${i}`, where: dublin });
    await counts({ ip: "10.0.1.1", where: cork, page: "/game-plan.html" });
    await counts({ ip: "10.0.2.1", where: paris });

    const s = await stats();
    const month = lastMonths(1)[0];
    expect(s.total).toBe(5);
    expect(s.month).toBe(5);
    expect(s.months).toHaveLength(12);
    expect(s.months.at(-1)).toEqual({ month, visitors: 5 });
    expect(s.months.slice(0, -1).every((m: any) => m.visitors === 0)).toBe(true);
    expect(s.countries).toEqual([
      { country: "IE", visitors: 4, month: 4 },
      { country: "FR", visitors: 1, month: 1 },
    ]);
    // Cork and Paris have fewer than 3 visitors, so they stay private.
    expect(s.cities).toEqual([{ city: "Dublin", region: "Leinster", country: "IE", visitors: 3 }]);
    expect(s.pages).toEqual([
      { page: "/", visitors: 4, month: 4 },
      { page: "/game-plan.html", visitors: 1, month: 1 },
    ]);
  });

  it("splits visitors into mobile and desktop", async () => {
    await counts({ ip: "10.0.0.1", ua: IPHONE });
    await counts({ ip: "10.0.0.2", ua: ANDROID_TABLET });
    await counts({ ip: "10.0.0.3", ua: CHROME });
    await counts({ ip: "10.0.0.1", ua: IPHONE, page: "/game-plan.html" }); // same visitor again

    expect((await stats()).devices).toEqual([
      { device: "mobile", visitors: 2, month: 2 },
      { device: "desktop", visitors: 1, month: 1 },
    ]);
  });

  it("always lists both devices, even with no visitors", async () => {
    expect((await stats()).devices).toEqual([
      { device: "mobile", visitors: 0, month: 0 },
      { device: "desktop", visitors: 0, month: 0 },
    ]);
  });

  it("files visitors with no location under XX", async () => {
    await counts({ where: { country: undefined, region: undefined, city: undefined } });
    expect((await stats()).countries).toEqual([{ country: "XX", visitors: 1, month: 1 }]);
  });
});

describe("helpers", () => {
  it("normalizes pages", () => {
    expect(normalizePage("/")).toBe("/");
    expect(normalizePage("/index.html")).toBe("/");
    expect(normalizePage("/apps/tiny-racers/index.html")).toBe("/apps/tiny-racers/");
    expect(normalizePage("/stats.html")).toBe("/stats.html");
    expect(normalizePage("/myindex.html")).toBe("/myindex.html");
    expect(normalizePage(42)).toBeNull();
  });

  it("spots bots", () => {
    expect(isBot(CHROME)).toBe(false);
    expect(isBot("")).toBe(true);
    expect(isBot("curl/8.4.0")).toBe(true);
    expect(isBot("Mozilla/5.0 (compatible; bingbot/2.0)")).toBe(true);
  });

  it("tells mobile from desktop", () => {
    expect(deviceType(IPHONE)).toBe("mobile");
    expect(deviceType(ANDROID_TABLET)).toBe("mobile");
    expect(deviceType("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36")).toBe("mobile");
    expect(deviceType(CHROME)).toBe("desktop");
    expect(deviceType("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36")).toBe("desktop");
  });

  it("lists the last months across a year boundary", () => {
    expect(lastMonths(3, new Date("2026-02-15T00:00:00Z"))).toEqual(["2025-12", "2026-01", "2026-02"]);
  });
});
