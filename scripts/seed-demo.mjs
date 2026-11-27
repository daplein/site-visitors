// Fake numbers for trying the stats page locally. Writes counters only, never touches remote.
//   node scripts/seed-demo.mjs > /tmp/seed.sql && npx wrangler d1 execute site-visitors --local --file /tmp/seed.sql
const countries = { IE: 610, GB: 180, US: 140, FR: 45, DE: 38, ES: 22, NL: 17, CA: 15, AU: 12, IN: 9, PL: 8, BR: 6, IT: 6, JP: 4, MT: 3, SG: 2, ZA: 2, NZ: 1, AR: 1, KE: 1 };
const cities = [["IE|Leinster|Dublin", 240], ["IE|Leinster|Wicklow", 95], ["IE|Munster|Cork", 60], ["GB|England|London", 70], ["US|California|San Francisco", 14], ["FR|Île-de-France|Paris", 11], ["DE|Berlin|Berlin", 4]];
const pages = { "/": 820, "/pickleball-training.html": 230, "/apps/": 190, "/apps/raining-bricks/": 120, "/apps/tiny-racers/": 95, "/game-plan.html": 60, "/stats.html": 40 };
const months = [];
for (let i = 11; i >= 0; i--) {
  const d = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - i, 1));
  months.push(d.toISOString().slice(0, 7));
}
const total = Object.values(countries).reduce((a, b) => a + b, 0);
const sql = ["DELETE FROM counters;"];
const row = (kind, key, period, n) => sql.push(`INSERT INTO counters VALUES ('${kind}', '${key.replace(/'/g, "''")}', '${period}', ${n});`);
row("site", "", "all", total);
months.forEach((m, i) => row("site", "", m, Math.round(20 + (i / 11) ** 1.6 * 180 + (i % 3) * 9)));
const thisMonth = months.at(-1);
for (const [cc, n] of Object.entries(countries)) { row("country", cc, "all", n); row("country", cc, thisMonth, Math.ceil(n * 0.18)); }
for (const [k, n] of cities) row("city", k, "all", n);
for (const [p, n] of Object.entries(pages)) { row("page", p, "all", n); row("page", p, thisMonth, Math.ceil(n * 0.2)); }
console.log(sql.join("\n"));
