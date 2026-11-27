# site-visitors

Unique-visitor counter and public stats for [daplein.github.io](https://daplein.github.io): a Cloudflare Worker, a D1 database and a few static files.

- Shows a small badge on every page: "👋 1,234 visitors · 56 on this page · where from?"
- Public stats page with a world bubble map, visitors per month, countries, cities and pages.
- Raw IPs are never stored. Visitors are identified by a salted hash, and only country, region and city are kept. No cookies.

See [SPEC.md](SPEC.md) for the design.

## Run locally

```bash
npm install --legacy-peer-deps
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev                                                   # API on :8787
python3 -m http.server 8080 --bind 127.0.0.1 --directory site # site on :8080
```

Open http://localhost:8080/stats.html. To see the page with plenty of data:

```bash
node scripts/seed-demo.mjs > /tmp/seed.sql
npx wrangler d1 execute site-visitors --local --file /tmp/seed.sql
```

## Test

```bash
npm test         # Worker tests, run in workerd against a local D1
npm run check    # typecheck
```

## Deploy

```bash
npx wrangler login
npx wrangler d1 create site-visitors      # paste the id into wrangler.jsonc
npm run db:migrate
openssl rand -hex 32 | npx wrangler secret put VISITOR_SALT
npm run deploy
```

Deployed at `https://site-visitors.game-scores.workers.dev` (D1 database `site-visitors`, Western Europe). For later changes, `npm run deploy` again, after `npm run db:migrate` if there's a new migration.

## Publish the site files

```bash
npm run publish-site    # copies site/* into ~/personal/daplein.github.io (or $PAGES_DIR)
```

Then commit and push `daplein.github.io`. GitHub Pages publishes it a minute later.

Where the badge (`<script src="/visitors.js" defer></script>`) lives on the site:

| Page | Badge comes from |
|---|---|
| `index.html`, `apps/index.html`, `apps/*/index.html` | the templates in `release-tools/render.py` (re-rendered on every app release) |
| `circus-2026/`, `pickleball-training.html` | added by hand |
| `game-plan.html` | added by hand, **but GamePlan's CI overwrites this file on every deploy**. The badge needs adding to the GamePlan source too. |
| `search/*` | none: those are crawl test fixtures |

Use `data-badge="off"` on the script tag to count a page without showing the badge.

Visit `https://daplein.github.io/stats.html?me` on your own devices so you're not counted (`?me=off` undoes it).

## Map

`site/world.svg` is generated from Natural Earth (public domain) by `npm run map`. You only need to rerun it if you change the look.
