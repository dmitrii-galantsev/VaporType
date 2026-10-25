import fs from "node:fs";
import { openSim, inject, settle } from "./run.mjs";
import { readRuntime as read } from "../runtime.mjs";
import { sleep } from "./helpers.mjs";

const pct = (xs, p) => {
  const s = xs.slice().sort((a, b) => a - b);
  return +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2);
};
const stats = (xs) => ({ n: xs.length, median: pct(xs, 0.5), p95: pct(xs, 0.95), max: pct(xs, 1) });

async function longTasks(page, fn, gc) {
  await page.tracing.start({ categories: ["toplevel", "devtools.timeline", "v8"] });
  await fn();
  const trace = JSON.parse(Buffer.from(await page.tracing.stop()).toString("utf8"));
  const names = {};
  for (const e of trace.traceEvents) if (e.ph === "M" && e.name === "thread_name") names[`${e.pid}:${e.tid}`] = e.args.name;
  const main = trace.traceEvents.filter((e) => e.ph === "X" && names[`${e.pid}:${e.tid}`] === "CrRendererMain");
  const long = [];
  for (const t of main.filter((e) => /^(ThreadControllerImpl::RunTask|RunTask)$/.test(e.name) && e.dur > 16000)) {
    const inner = main.filter((e) => e.ts >= t.ts && e.ts + e.dur <= t.ts + t.dur);
    const gcMs = Math.max(0, ...inner.filter((e) => /^(MajorGC|MinorGC)$/.test(e.name)).map((e) => e.dur)) / 1000;
    const ms = +(t.dur / 1000).toFixed(1);
    if (ms - gcMs > 16) long.push(ms);
    else gc.push(ms);
  }
  return long;
}

const timed = (page, fn, ...args) =>
  page.evaluate(
    (src, args) => {
      const t0 = performance.now();
      new Function("args", `(${src})(...args)`)(args);
      document.querySelector(".osk-set")?.getBoundingClientRect();
      void document.documentElement.offsetHeight;
      return performance.now() - t0;
    },
    fn.toString(),
    args,
  );

const frame = (page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 20)))));

const press = (button) => {
  const t = document.querySelector("[data-key]");
  for (const type of ["vgp_onbuttondown", "vgp_onbuttonup"])
    t.dispatchEvent(new CustomEvent(type, { bubbles: true, cancelable: true, detail: { button, source: 1, is_repeat: false } }));
};

export async function measurePanel(page, cdp, { runs = 20 } = {}) {
  const out = { gcTasks: [] };
  const F = (fn, ...a) => page.evaluate(fn, ...a);
  await F(() => window.__oskTrackpadFix.closeSettings());
  await settle(page);
  const opens = [];
  for (let i = 0; i < 8; i++) {
    opens.push(await timed(page, () => window.__oskTrackpadFix.openSettings()));
    await frame(page);
    await F(() => window.__oskTrackpadFix.closeSettings());
    await frame(page);
  }
  out.firstOpen = +opens[0].toFixed(2);
  out.open = stats(opens);

  await F(() => window.__oskTrackpadFix.openSettings());
  await sleep(600);
  const tabs = [];
  out.tabLong = await longTasks(
    page,
    async () => {
      for (let i = 0; i < runs; i++) {
        tabs.push(await timed(page, press, i % 7 === 6 ? 5 : 6));
        await frame(page);
      }
    },
    out.gcTasks,
  );
  out.tab = stats(tabs);

  await F(() => window.__oskTrackpadFix.closeSettings());
  await F(() => window.__oskTrackpadFix.openSettings());
  await frame(page);
  const toggles = [];
  out.toggleLong = await longTasks(
    page,
    async () => {
      for (let i = 0; i < runs; i++) {
        await F(() => {
          window.__oskTrackpadFix.panel.focus = "OSKSet_t_autoSpace";
        });
        toggles.push(await timed(page, press, 1));
        await frame(page);
      }
    },
    out.gcTasks,
  );
  out.toggle = stats(toggles);

  const segs = [];
  out.segLong = await longTasks(
    page,
    async () => {
      for (let i = 0; i < runs; i++) {
        await F(() => {
          window.__oskTrackpadFix.panel.focus = "OSKSet_c_mode";
        });
        segs.push(await timed(page, press, i % 2 ? 11 : 12));
        await frame(page);
      }
    },
    out.gcTasks,
  );
  out.seg = { mode: await F(() => window.__oskTrackpadFix.settings.mode), ...stats(segs) };

  await F(() => window.__oskTrackpadFix.setSetting("keyAlpha", 50));
  await F(() => window.__oskTrackpadFix.closeSettings());
  await F(() => window.__oskTrackpadFix.openSettings());
  await frame(page);
  await timed(page, press, 6);
  await timed(page, press, 6);
  await frame(page);
  const tab = await F(() => window.__oskTrackpadFix.panel.tab);
  const steps = [];
  out.sliderLong = await longTasks(
    page,
    async () => {
      for (let i = 0; i < runs; i++) {
        await F(() => {
          window.__oskTrackpadFix.panel.focus = "OSKSet_s_keyAlpha";
        });
        steps.push(await timed(page, press, i % 2 ? 11 : 12));
        await frame(page);
      }
    },
    out.gcTasks,
  );
  await sleep(400);
  out.slider = { tab, ...stats(steps) };

  const busy = async () => {
    await sleep(500);
    const get = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
    const a = await get();
    await sleep(3000);
    const b = await get();
    const pct = (k) => +(((b[k] - a[k]) / 3) * 100).toFixed(2);
    out.idleParts = [
      ...(out.idleParts ?? []),
      { script: pct("ScriptDuration"), style: pct("RecalcStyleDuration"), layout: pct("LayoutDuration") },
    ];
    return pct("TaskDuration");
  };
  out.idleOpenPct = await busy();
  await F(() => window.__oskTrackpadFix.closeSettings());
  out.idleClosedPct = await busy();
  out.idleAddsPct = +(out.idleOpenPct - out.idleClosedPct).toFixed(2);
  await F(() => window.__oskTrackpadFix.setSetting("keyAlpha", 100));
  await settle(page);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rate = Number(process.env.CPU ?? 4);
  const patch = process.env.PATCH ? fs.readFileSync(process.env.PATCH, "utf8") : read("patch.js");
  const { browser, page } = await openSim();
  const cdp = await page.createCDPSession();
  await cdp.send("Performance.enable");
  await page.evaluate(() => {
    window.__oskUserWords = null;
    window.localStorage.clear();
    window.localStorage.setItem("oskSwipeSettings", JSON.stringify({ consent: true, tipShown: true }));
  });
  await page.evaluate(["swipe/words.js", "swipe/lm.js", "swipe/engine.js", "modes.js"].map(read).join("\n;\n"));
  await inject(page, patch);
  await page.waitForFunction(() => window.__oskEngine?.__warmed === true, { timeout: 20000, polling: 100 }).catch(() => {});
  await settle(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  const r = await measurePanel(page, cdp);
  console.log(JSON.stringify({ cpu: rate, patch: process.env.PATCH ?? "keyboard/src/patch.js", ...r }, null, 1));
  await browser.close();
}
