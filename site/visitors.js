// Visitor counter badge for daplein.github.io. https://github.com/daplein/site-visitors
//
// Add to a page, just before </body>:
//   <script src="/visitors.js" defer></script>
// Options on the script tag:
//   data-badge="off"   count the visit but show no badge (full-screen games, etc.)
// The badge goes into <div id="site-visitors"> if the page has one, else at the end of <body>.
//
// Counting happens in a Cloudflare Worker. It stores a salted hash instead of your IP,
// plus country/region/city. No cookies. Browsers that opted out (stats.html?me) are not counted.
(() => {
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const API = local ? "http://localhost:8787" : "https://site-visitors.game-scores.workers.dev";
  const IGNORE_KEY = "site-visitors:ignore";

  const script = document.currentScript;
  const showBadge = script?.dataset.badge !== "off";
  const page = location.pathname.replace(/(^|\/)index\.html$/, "$1");

  let ignored = false;
  try {
    ignored = localStorage.getItem(IGNORE_KEY) === "1";
  } catch {
    // Storage blocked: count as normal.
  }

  window.siteVisitors = { api: API, ignoreKey: IGNORE_KEY, page };
  if (location.protocol === "file:") return;

  const request = ignored
    ? fetch(`${API}/count?page=${encodeURIComponent(page)}`)
    : fetch(`${API}/hit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page }),
      });

  request
    .then((res) => (res.ok ? res.json() : null))
    .then((counts) => {
      if (counts && showBadge) render(counts);
      document.dispatchEvent(new CustomEvent("site-visitors", { detail: counts }));
    })
    .catch(() => {
      // The counter must never break a page.
      document.dispatchEvent(new CustomEvent("site-visitors", { detail: null }));
    });

  function render(counts) {
    const n = (x) => new Intl.NumberFormat().format(x);
    const plural = (x, word) => `${n(x)} ${word}${x === 1 ? "" : "s"}`;
    const onStats = /\/stats\.html$/.test(page);

    const el = document.getElementById("site-visitors") || document.createElement("p");
    if (!el.id) {
      el.id = "site-visitors";
      el.style.cssText = "text-align:center;font-size:14px;color:#666;margin:18px 0 24px;";
      (document.querySelector("main") || document.body).appendChild(el);
    }
    el.textContent = `👋 ${plural(counts.site.total, "visitor")}`;
    if (!onStats && counts.page.total !== counts.site.total) {
      el.append(` · ${n(counts.page.total)} on this page`);
    }
    if (!onStats) {
      el.append(" · ");
      const a = document.createElement("a");
      a.href = "/stats.html";
      a.textContent = "where from?";
      a.style.color = "inherit";
      el.append(a);
    }
  }
})();
