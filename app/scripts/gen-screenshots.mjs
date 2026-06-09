// Generates README screenshots at 1440x900 (light mode, EN) with PII masking.
// Usage: node scripts/gen-screenshots.mjs
import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../../docs/screenshots");
const BASE = process.env.BASE_URL || "http://localhost:3000";

// Optional comma-separated allow-list (route or file name) to regenerate a
// subset without touching the other screenshots, e.g.
//   ONLY=/ai-credits,ai-adoption.png node scripts/gen-screenshots.mjs
const ONLY = process.env.ONLY
  ? new Set(process.env.ONLY.split(",").map((s) => s.trim()).filter(Boolean))
  : null;

const PAGES = [
  ["/", "landing.png"],
  ["/metrics", "copilot-usage.png"],
  ["/code-generation", "code-generation.png"],
  ["/pull-requests", "pr-autofix.png"],
  ["/agents", "agent-impact.png"],
  ["/ai-adoption", "ai-adoption.png"],
  ["/cli", "cli-impact.png"],
  ["/seats", "copilot-licensing.png"],
  ["/ai-credits", "ai-credits.png"],
  ["/premium-requests", "premium-requests.png"],
  ["/users", "users.png"],
  ["/enterprise-teams", "enterprise-teams.png"],
  ["/reference", "metrics-reference.png"],
  ["/settings", "settings.png"],
  ["/settings/data-sync", "data-sync.png"],
];

// Routes whose reports expose real aggregate spend / usage figures. On these
// pages the numeric values (and chart canvases) are blurred so real billing
// data is never published, while labels and structure stay crisp.
const FIGURE_MASK_ROUTES = new Set(["/ai-adoption", "/ai-credits"]);

// Injected into every page: masks PII (logins ending in _shldc and their
// associated full names) deterministically, without touching UI labels.
function maskPII() {
  const PHON = [
    "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel",
    "india", "juliet", "kilo", "lima", "mike", "november", "oscar", "papa",
    "quebec", "romeo", "sierra", "tango", "uniform", "victor", "whiskey",
    "xray", "yankee", "zulu",
  ];
  // Hide the Next.js dev-mode indicator badge so it doesn't overlap the footer.
  if (!document.getElementById("__screenshot_style")) {
    const style = document.createElement("style");
    style.id = "__screenshot_style";
    style.textContent =
      "nextjs-portal,[data-next-badge-root],[data-next-badge],[data-nextjs-toast],#__next-build-watcher{display:none !important;}";
    document.head.appendChild(style);
  }

  const map = (window.__maskMap = window.__maskMap || {});
  let next = Object.keys(map).length;
  const maskLogin = (login) => {
    if (!map[login]) {
      const p = PHON[next % PHON.length] + (next >= PHON.length ? Math.floor(next / PHON.length) : "");
      map[login] = p;
      next++;
    }
    return map[login];
  };
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  const nameLoginRe = /([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.'-]*(?:\s[A-Za-zÀ-ÿ.'-]+)*)\s\((\w*_shldc)\)/g;
  const bareLoginRe = /\b\w*_shldc\b/g;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  for (const node of nodes) {
    let text = node.nodeValue;
    if (!text || !text.includes("_shldc")) continue;
    text = text.replace(nameLoginRe, (_m, _name, login) => {
      const p = maskLogin(login);
      return `User ${cap(p)} (user-${p})`;
    });
    text = text.replace(bareLoginRe, (login) => `user-${maskLogin(login)}`);
    node.nodeValue = text;
  }

  // Mask values inside inputs (e.g. enterprise slug, search fields) if they
  // contain a real login pattern.
  for (const el of document.querySelectorAll("input, textarea")) {
    if (el.value && el.value.includes("_shldc")) {
      el.value = el.value
        .replace(nameLoginRe, (_m, _name, login) => `user-${maskLogin(login)}`)
        .replace(bareLoginRe, (login) => `user-${maskLogin(login)}`);
    }
  }
}

// Injected on billing/usage report pages: blurs sensitive numeric figures
// (credit counts, dollar amounts, usage counts) and chart canvases so real
// aggregate spend is never published, while keeping labels, headings, and
// model names crisp.
function maskFigures() {
  if (!document.getElementById("__figmask_style")) {
    const style = document.createElement("style");
    style.id = "__figmask_style";
    style.textContent =
      ".__figmask{filter:blur(8px) !important;-webkit-filter:blur(8px) !important;user-select:none !important;}" +
      "main canvas{filter:blur(7px) !important;-webkit-filter:blur(7px) !important;}";
    document.head.appendChild(style);
  }

  const main = document.querySelector("main") || document.body;
  // A leaf element whose entire text is a number / currency / percentage.
  const PURE = /^[+\-]?\$?\s?\d[\d,]*(\.\d+)?%?$/;
  // A "Label: 761,507.7" style value at the end of a text node.
  const TAIL = /([:\uFF1A]\s*)([+\-]?\$?\d[\d,]*(?:\.\d+)?%?)\s*$/;
  // Prose captions that embed activity counts (generations, PRs, etc.).
  const COUNTS = /\b(generations?|merged PRs?|reviewed PRs?|accepted)\b/i;

  // 1. Blur pure-number leaf elements (KPI values, table cells, legends).
  for (const el of main.querySelectorAll("*")) {
    if (el.children.length) continue;
    const t = (el.textContent || "").trim();
    if (!t) continue;
    if (PURE.test(t) || (COUNTS.test(t) && /\d/.test(t))) {
      el.classList.add("__figmask");
    }
  }

  // 2. Blur just the numeric tail of "Label: value" text, keeping the label.
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  const texts = [];
  let tn;
  while ((tn = walker.nextNode())) texts.push(tn);
  for (const node of texts) {
    const parent = node.parentElement;
    if (!parent || parent.classList.contains("__figmask")) continue;
    const m = (node.nodeValue || "").match(TAIL);
    if (!m) continue;
    const tail = m[2];
    const idx = node.nodeValue.lastIndexOf(tail);
    if (idx < 0) continue;
    const after = node.splitText(idx);
    const span = document.createElement("span");
    span.className = "__figmask";
    span.textContent = after.nodeValue;
    after.replaceWith(span);
  }

  // 3. Blur headcount figures embedded in scale captions (e.g. "of 167 engaged").
  const SCALE = /\b(engaged|active users?|seats?|members?|developers?|contributors?)\b/i;
  const TOKEN = /\d[\d,]*(?:\.\d+)?/g;
  const walker2 = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  const texts2 = [];
  let node2;
  while ((node2 = walker2.nextNode())) texts2.push(node2);
  for (const node of texts2) {
    const parent = node.parentElement;
    if (!parent || parent.classList.contains("__figmask")) continue;
    const val = node.nodeValue || "";
    if (!SCALE.test(val) || !/\d/.test(val)) continue;
    const frag = document.createDocumentFragment();
    let last = 0;
    let m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(val))) {
      if (m.index > last) frag.appendChild(document.createTextNode(val.slice(last, m.index)));
      const span = document.createElement("span");
      span.className = "__figmask";
      span.textContent = m[0];
      frag.appendChild(span);
      last = m.index + m[0].length;
    }
    if (last < val.length) frag.appendChild(document.createTextNode(val.slice(last)));
    node.replaceWith(frag);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(() => {
    localStorage.setItem("theme", "light");
    localStorage.setItem("locale", "en");
    // Bypass the client-side gate overlays; data still requires the cookie.
    sessionStorage.setItem("admin_authenticated", "true");
    sessionStorage.setItem("dashboard_authenticated", "true");
  });
  const page = await context.newPage();

  // Authenticate for the admin-gated Settings pages so their data loads.
  // Provide the password via the SCREENSHOT_ADMIN_PASSWORD env var.
  const adminReq = await (await context.request.get(BASE + "/api/auth/verify-admin")).json().catch(() => ({}));
  if (adminReq && adminReq.required) {
    const pw = process.env.SCREENSHOT_ADMIN_PASSWORD;
    if (!pw) {
      console.warn("ADMIN_PASSWORD is set on the server but SCREENSHOT_ADMIN_PASSWORD was not provided \u2014 Settings data will not load.");
    } else {
      const res = await context.request.post(BASE + "/api/auth/verify-admin", {
        data: { password: pw },
        headers: { "Content-Type": "application/json" },
      });
      console.log(res.ok() ? "Admin authenticated." : "Admin authentication failed.");
    }
  }

  // Authenticate for dashboard-gated report pages so their data loads.
  // Provide the password via the SCREENSHOT_DASHBOARD_PASSWORD env var.
  const dashReq = await (await context.request.get(BASE + "/api/auth/verify-dashboard")).json().catch(() => ({}));
  if (dashReq && dashReq.required) {
    const pw = process.env.SCREENSHOT_DASHBOARD_PASSWORD;
    if (!pw) {
      console.warn("DASHBOARD_PASSWORD is set on the server but SCREENSHOT_DASHBOARD_PASSWORD was not provided \u2014 dashboard data will not load.");
    } else {
      const res = await context.request.post(BASE + "/api/auth/verify-dashboard", {
        data: { password: pw },
        headers: { "Content-Type": "application/json" },
      });
      console.log(res.ok() ? "Dashboard authenticated." : "Dashboard authentication failed.");
    }
  }

  for (const [route, file] of PAGES) {
    if (ONLY && !ONLY.has(route) && !ONLY.has(file)) continue;
    const url = BASE + route;
    process.stdout.write(`-> ${route} ... `);
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    // Let charts render / data fetch settle.
    await sleep(3500);
    await page.evaluate(maskPII);
    if (FIGURE_MASK_ROUTES.has(route)) await page.evaluate(maskFigures);
    await sleep(300);
    await page.screenshot({ path: path.join(OUT_DIR, file) });
    console.log(file);
  }

  await browser.close();
  console.log("Done.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
