import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const here = path.dirname(new URL(import.meta.url).pathname);
const STEAMUI = process.env.STEAMUI ?? path.join(here, "..", "..", ".steamui");
const ORIGIN = "https://steamloopback.host";
const GLYPHS = process.env.GLYPHS ?? path.join(process.env.HOME, ".local/share/Steam/controller_base/images/api/light");
const types = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

export async function openSim({
  headless = true,
  width = Number(process.env.SIM_W ?? 854),
  height = Number(process.env.SIM_H ?? 534),
  scale = Number(process.env.SIM_DPR ?? 1.5),
  port,
  browser: shared,
  backdrop = !!process.env.SIM_BACKDROP,
  args = [],
} = {}) {
  const browser =
    shared ??
    (await puppeteer.launch({
      executablePath: process.env.CHROME ?? "/usr/bin/chromium",
      headless,
      args: ["--no-sandbox", `--window-size=${width},${height}`, ...args, ...(port ? [`--remote-debugging-port=${port}`] : [])],
    }));
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: scale });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.stack ?? e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.origin !== ORIGIN) return r.respond({ status: 404, body: "" });
    const rel = decodeURIComponent(u.pathname);
    const file =
      rel === "/"
        ? path.join(here, "harness.html")
        : rel.startsWith("/__sim/")
          ? path.join(here, rel.slice(7))
          : rel.startsWith("/steaminputglyphs/")
            ? path.join(GLYPHS, rel.slice(18))
            : path.join(STEAMUI, rel);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      errors.push(`404 ${rel}`);
      return r.respond({ status: 404, body: "" });
    }
    let body = fs.readFileSync(file);
    if (rel === "/library.js") {
      const src = body.toString("utf8");
      const entry = /var (\w+)=(\w+)\.O\(void 0,\[[\d,]+\],\(\)=>\2\(\d+\)\);\1=\2\.O\(\1\)/;
      if (!entry.test(src)) throw new Error("library.js entry call not found");
      body = src.replace(entry, (_, v, req) => `self.__steamRequire=${req}`);
    }
    r.respond({ status: 200, contentType: types[path.extname(file)] ?? "application/octet-stream", body });
  });
  await page.goto(`${ORIGIN}/`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__simReady && document.querySelector("[data-key]"), { timeout: 20000, polling: 20 });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForFunction(
    () => {
      const n = document.querySelectorAll("[data-key]").length;
      const same = window.__simKeys === n;
      window.__simKeys = n;
      return same && n > 40;
    },
    { timeout: 10000, polling: 50 },
  );
  await page.evaluate(async () => {
    let last = "",
      same = 0;
    for (let i = 0; i < 400 && same < 4; i++) {
      await new Promise((r) => setTimeout(r, 25));
      const r = document.querySelector('[data-key="a"]')?.getBoundingClientRect();
      const k = r && r.bottom <= innerHeight ? `${r.left},${r.top}` : "";
      same = k && k === last ? same + 1 : 0;
      last = k;
    }
  });
  if (backdrop) await page.evaluate(addBackdrop);
  return { browser, page, errors };
}

export async function inject(page, src, { consent = true } = {}) {
  if (consent) {
    await page.evaluate(() => {
      if (window.__oskSettings || window.__oskUserWords?.settings) return;
      let s = {};
      try {
        s = JSON.parse(localStorage.getItem("oskSwipeSettings") ?? "{}") ?? {};
      } catch (e) {}
      if (!("consent" in s)) localStorage.setItem("oskSwipeSettings", JSON.stringify({ ...s, consent: true }));
    });
  }
  const status = await page.evaluate(src);
  await page.waitForFunction(
    () => {
      const st = window.__oskTrackpadFix?.status?.() ?? "";
      return /unsupported|keyboard=patched/.test(st) && (/unsupported/.test(st) || document.querySelector('[data-key="Escape"]'));
    },
    { timeout: 10000, polling: 20 },
  );
  await settle(page);
  return status;
}

export async function waitKeyboard(page) {
  await page.waitForSelector('[data-key="Escape"]', { timeout: 5000 });
  await page.evaluate(() => window.__oskTrackpadFix?.tickNow?.());
  await page.evaluate(async () => {
    const raf = () =>
      new Promise((r) => {
        requestAnimationFrame(() => r());
        setTimeout(r, 34);
      });
    let last = "",
      same = 0;
    for (let i = 0; i < 300 && same < 4; i++) {
      await raf();
      const el = document.querySelector('[data-key=" "]') ?? document.querySelector("[data-key]");
      const r = el?.getBoundingClientRect();
      const k = r ? `${r.left},${r.top},${r.width},${r.height}` : "";
      same = k && k === last ? same + 1 : 0;
      last = k;
    }
  });
  await settle(page);
}

export async function settle(page, { quiet = 40, max = 4000, join = true } = {}) {
  return page.evaluate(
    async (quiet, max, join) => {
      const t0 = performance.now();
      const raf = () =>
        new Promise((r) => {
          requestAnimationFrame(() => r());
          setTimeout(r, 34);
        });
      let n = -1,
        since = performance.now();
      for (;;) {
        await raf();
        const F = window.__oskTrackpadFix;
        const busy = F?.idle ? !F.idle(join) : false;
        const len = window.__keyLog?.length ?? 0;
        if (busy || len !== n) {
          n = len;
          since = performance.now();
        }
        if (performance.now() - since >= quiet) return performance.now() - t0;
        if (performance.now() - t0 > max) return -1;
      }
    },
    quiet,
    max,
    join,
  );
}

function addBackdrop() {
  const d = document.createElement("div");
  d.id = "sim-backdrop";
  d.style.cssText =
    "position:fixed;inset:0;z-index:0;overflow:hidden;padding:18px 26px;background:linear-gradient(160deg,#2b3a4f,#1b2433 60%,#3a2d43);color:#e8edf3;font:17px/1.55 Arial,Helvetica,sans-serif";
  const lines = [
    "[Chat] Moonlight stream: Tyr, ranked lobby",
    "kestrel: anyone up for one more round before the patch drops?",
    "you: yes, give me a minute to grab a drink",
    "kestrel: cool, I'll queue us up. bring the sniper loadout this time",
    "you: ok, and remind me to swap the ammo binds after this match",
    "mira: GG last game, that final push through the canyon was perfect",
    "kestrel: next map is the harbour, watch the left flank early on",
    "you: I'll take high ground and call targets, you two hold the bridge",
    "mira: sounds good. also who keeps leaving the drone parked on the roof",
    "kestrel: lol that was me, I forgot to recall it before the timer ran out",
    "you: typing this on the deck keyboard right now, it is getting better",
    "mira: the swipe thing actually works? send a long sentence and prove it",
    "you: the quick brown fox jumps over the lazy dog while we wait in queue",
  ];
  for (const l of lines) {
    const p = document.createElement("div");
    p.textContent = l;
    p.style.margin = "0 0 6px";
    d.appendChild(p);
  }
  document.body.insertBefore(d, document.body.firstChild);
  const root = document.getElementById("root");
  root.style.zIndex = "1";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { browser, page, errors } = await openSim();
  const keys = await page.$$eval("[data-key]", (els) => els.map((e) => e.getAttribute("data-key")));
  console.log("keys", keys.length, JSON.stringify(keys));
  console.log("errors", errors.slice(0, 10).join("\n---\n"));
  await page.screenshot({ path: process.argv[2], fullPage: true });
  await browser.close();
}
