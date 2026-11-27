// Unique-visitor counter for daplein.github.io.
//
//   POST /hit           {page}   count this visitor on this page, return badge numbers
//   GET  /count?page=/x          badge numbers without counting (opted-out browsers)
//   GET  /stats                  everything the public stats page shows
//
// A visitor is sha256(VISITOR_SALT + IP + User-Agent). The raw IP is never stored or logged.
// Location comes from request.cf (Cloudflare's own geo data), so there's no IP lookup service.
// See SPEC.md for the design and migrations/ for the tables and counting triggers.

import { isBot, lastMonths, MAX_VISITORS_PER_IP, MIN_CITY_VISITORS, normalizePage } from "./lib";

interface Env {
  DB: D1Database;
  VISITOR_SALT: string;
  ALLOWED_ORIGINS: string;
  SITE_ORIGIN: string;
  CHECK_PAGES: string;
}

export interface Counts {
  site: { total: number; month: number };
  page: { total: number; month: number };
  counted: boolean;
}

const MONTHS_SHOWN = 12;
const MAX_BODY = 1024;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin");

    if (req.method === "OPTIONS") return preflight(origin, env);

    try {
      if (url.pathname === "/hit" && req.method === "POST") return await hit(req, env, origin);
      if (url.pathname === "/count" && req.method === "GET") return await count(url, env);
      if (url.pathname === "/stats" && req.method === "GET") return await stats(env);
    } catch (err) {
      console.error("request failed", url.pathname, err instanceof Error ? err.message : err);
      return json({ error: "internal error" }, 500, publicCors());
    }
    return json({ error: "not found" }, 404, publicCors());
  },
} satisfies ExportedHandler<Env>;

// ---------- routes ----------

async function hit(req: Request, env: Env, origin: string | null): Promise<Response> {
  const cors = privateCors(origin, env);
  if (!cors) return json({ error: "origin not allowed" }, 403);

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: "body too large" }, 413, cors);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "invalid json" }, 400, cors);
  }
  const page = normalizePage((body as { page?: unknown })?.page);
  if (!page) return json({ error: "invalid page" }, 400, cors);

  const month = currentMonth();
  const ua = req.headers.get("User-Agent") ?? "";
  const ip = req.headers.get("CF-Connecting-IP");

  const countable = ip !== null && !isBot(ua) && (await pageExists(page, env));
  if (!countable) return json(await readCounts(env.DB, page, month, false), 200, cors);

  const visitor = await sha256(`${env.VISITOR_SALT}|${ip}|${ua}`);
  const ipHash = await sha256(`${env.VISITOR_SALT}|${ip}`);

  // One IP can't add more than MAX_VISITORS_PER_IP visitors a month, so rotating
  // User-Agents from one machine doesn't inflate the count.
  const cap = await env.DB.prepare(
    "SELECT COUNT(*) AS n, COALESCE(SUM(visitor = ?1), 0) AS mine FROM site_months WHERE month = ?2 AND ip = ?3",
  )
    .bind(visitor, month, ipHash)
    .first<{ n: number; mine: number }>();
  if (cap && cap.n >= MAX_VISITORS_PER_IP && !cap.mine) {
    return json(await readCounts(env.DB, page, month, false), 200, cors);
  }

  const cf = (req.cf ?? {}) as { country?: string; region?: string; city?: string };
  const country = /^[A-Z]{2}$/.test(cf.country ?? "") ? cf.country! : "XX";
  const region = cf.region || null;
  const city = cf.city || null;
  const now = Math.floor(Date.now() / 1000);

  // ON CONFLICT DO NOTHING (not INSERT OR IGNORE): an OR-clause on the outer statement
  // would override the upserts inside the counting triggers.
  const db = env.DB;
  const [, , , , countsResult] = await db.batch([
    db
      .prepare("INSERT INTO visitors VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT DO NOTHING")
      .bind(visitor, country, region, city, now),
    db
      .prepare("INSERT INTO site_months VALUES (?1, ?2, ?3, ?4) ON CONFLICT DO NOTHING")
      .bind(month, visitor, ipHash, country),
    db.prepare("INSERT INTO page_visitors VALUES (?1, ?2) ON CONFLICT DO NOTHING").bind(page, visitor),
    db.prepare("INSERT INTO page_months VALUES (?1, ?2, ?3) ON CONFLICT DO NOTHING").bind(page, month, visitor),
    countsQuery(db, page, month),
  ]);
  return json(toCounts(countsResult.results as CounterRow[], month, true), 200, cors);
}

async function count(url: URL, env: Env): Promise<Response> {
  const page = normalizePage(url.searchParams.get("page"));
  if (!page) return json({ error: "invalid page" }, 400, publicCors());
  return json(await readCounts(env.DB, page, currentMonth(), false), 200, publicCors());
}

async function stats(env: Env): Promise<Response> {
  const months = lastMonths(MONTHS_SHOWN);
  const { results } = await env.DB.prepare(
    "SELECT kind, key, period, n FROM counters WHERE period = 'all' OR period >= ?1",
  )
    .bind(months[0])
    .all<CounterRow>();

  const month = months[months.length - 1];
  const perMonth = new Map<string, number>();
  const countries = new Map<string, { country: string; visitors: number; month: number }>();
  const pages = new Map<string, { page: string; visitors: number; month: number }>();
  const cities: { city: string; region: string | null; country: string; visitors: number }[] = [];
  let total = 0;

  for (const r of results) {
    if (r.kind === "site") {
      if (r.period === "all") total = r.n;
      else perMonth.set(r.period, r.n);
    } else if (r.kind === "country") {
      const c = countries.get(r.key) ?? { country: r.key, visitors: 0, month: 0 };
      if (r.period === "all") c.visitors = r.n;
      else if (r.period === month) c.month = r.n;
      countries.set(r.key, c);
    } else if (r.kind === "page") {
      const p = pages.get(r.key) ?? { page: r.key, visitors: 0, month: 0 };
      if (r.period === "all") p.visitors = r.n;
      else if (r.period === month) p.month = r.n;
      pages.set(r.key, p);
    } else if (r.kind === "city" && r.period === "all" && r.n >= MIN_CITY_VISITORS) {
      const [country, region, city] = r.key.split("|");
      cities.push({ city, region: region || null, country, visitors: r.n });
    }
  }

  const byVisitors = (a: { visitors: number }, b: { visitors: number }) => b.visitors - a.visitors;
  const body = {
    total,
    month: perMonth.get(month) ?? 0,
    months: months.map((m) => ({ month: m, visitors: perMonth.get(m) ?? 0 })),
    countries: [...countries.values()].filter((c) => c.visitors > 0).sort(byVisitors),
    cities: cities.sort(byVisitors),
    pages: [...pages.values()].filter((p) => p.visitors > 0).sort(byVisitors),
  };
  return json(body, 200, { ...publicCors(), "Cache-Control": "public, max-age=60" });
}

// ---------- counts ----------

interface CounterRow {
  kind: string;
  key: string;
  period: string;
  n: number;
}

function countsQuery(db: D1Database, page: string, month: string): D1PreparedStatement {
  return db
    .prepare(
      `SELECT kind, key, period, n FROM counters
       WHERE kind IN ('site', 'page') AND key IN ('', ?1) AND period IN ('all', ?2)`,
    )
    .bind(page, month);
}

async function readCounts(db: D1Database, page: string, month: string, counted: boolean): Promise<Counts> {
  const { results } = await countsQuery(db, page, month).all<CounterRow>();
  return toCounts(results, month, counted);
}

function toCounts(rows: CounterRow[], month: string, counted: boolean): Counts {
  const get = (kind: string, period: string) =>
    rows.find((r) => r.kind === kind && r.period === period && (kind === "site") === (r.key === ""))?.n ?? 0;
  return {
    site: { total: get("site", "all"), month: get("site", month) },
    page: { total: get("page", "all"), month: get("page", month) },
    counted,
  };
}

// ---------- checks ----------

/**
 * Only real pages get counted, so nobody can put made-up paths on the public stats page.
 * A page that's already in the counters is known; a new one must exist on the live site.
 */
async function pageExists(page: string, env: Env): Promise<boolean> {
  if (env.CHECK_PAGES !== "true") return true;
  const known = await env.DB.prepare("SELECT 1 FROM counters WHERE kind = 'page' AND key = ?1 LIMIT 1")
    .bind(page)
    .first();
  if (known) return true;
  const res = await fetch(env.SITE_ORIGIN + page, { method: "HEAD", redirect: "manual" });
  return res.ok;
}

// ---------- helpers ----------

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function allowedOrigins(env: Env): string[] {
  return env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
}

/** CORS headers for POST /hit, or null if the origin isn't the site. */
function privateCors(origin: string | null, env: Env): Record<string, string> | null {
  if (!origin || !allowedOrigins(env).includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** The stats are public: anyone may read them. */
function publicCors(): Record<string, string> {
  return { "Access-Control-Allow-Origin": "*" };
}

function preflight(origin: string | null, env: Env): Response {
  const cors = privateCors(origin, env);
  return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} });
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}
