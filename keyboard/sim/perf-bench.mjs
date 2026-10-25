import fs from "node:fs";
import { openSim } from "./run.mjs";
import { readRuntime as read } from "../runtime.mjs";
import { sleep } from "./helpers.mjs";

const RATE = Number(process.env.CPU ?? 6);
const FPS = Number(process.env.FPS ?? 0);
const PROFILE = process.env.PROFILE;
const patchSrc = process.env.PATCH ? fs.readFileSync(process.env.PATCH, "utf8") : read("patch.js");

const { browser, page, errors } = await openSim();
const cdp = await page.createCDPSession();
await page.evaluate(() => {
  window.localStorage.clear();
  window.localStorage.setItem("oskSwipeSettings", JSON.stringify({ consent: true, tipShown: true }));
  window.__sim.vkm.SetVirtualKeyboardHidden();
});
await sleep(400);
await page.evaluate((fps) => {
  window.__perf = { raf: 0, mut: 0, tasks: [] };
  const raf = window.requestAnimationFrame.bind(window);
  if (fps) {
    const step = 1000 / fps;
    let next = performance.now();
    window.requestAnimationFrame = (cb) => {
      const now = performance.now();
      next = Math.max(next + step, now);
      return setTimeout(() => raf((t) => cb(t)), next - now);
    };
    window.cancelAnimationFrame = (id) => clearTimeout(id);
  }
  const wrapped = window.requestAnimationFrame;
  window.requestAnimationFrame = (cb) => {
    window.__perf.raf++;
    return wrapped(cb);
  };
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__perf.tasks.push([e.startTime, e.duration]);
  }).observe({ type: "longtask", buffered: false });
  new MutationObserver((m) => (window.__perf.mut += m.length)).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
}, FPS);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });
const profStart = async () => {
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
};
const WINDOW = process.env.WINDOW ?? "all";
if (PROFILE && WINDOW === "all") await profStart();

let prof = null;
const rows = [];
const STOCK = !!process.env.STOCK;
const timeEval = async (name, src) => {
  const ms = await page.evaluate((src) => {
    const t0 = performance.now();
    (0, eval)(src);
    return performance.now() - t0;
  }, src);
  rows.push([name, ms]);
};
const busy = async (name, fn) => {
  const t0 = await page.evaluate(() => performance.now());
  await fn();
  const r = await page.evaluate((t0) => {
    const tasks = window.__perf.tasks.filter(([s]) => s >= t0);
    return { long: tasks.reduce((a, [, d]) => a + d, 0), max: Math.max(0, ...tasks.map(([, d]) => d)), wall: performance.now() - t0 };
  }, t0);
  rows.push([name, r.long, r.max, r.wall]);
  return r;
};

if (!STOCK) {
  for (const f of ["swipe/words.js", "swipe/lm.js", "swipe/engine.js", "modes.js"]) await timeEval(`eval ${f}`, read(f));
  await timeEval("eval patch.js (sync part)", patchSrc);
}
await busy("plugin load: first 3 s, keyboard closed", () => sleep(3000));
const closed = await page.evaluate(async () => {
  const p = window.__perf;
  const r0 = p.raf,
    m0 = p.mut;
  const t0 = performance.now();
  await new Promise((r) => setTimeout(r, 2000));
  return { raf: p.raf - r0, mut: p.mut - m0, s: (performance.now() - t0) / 1000 };
});
if (PROFILE && WINDOW === "open") await profStart();
const open = await busy("first open: show -> 1.5 s", async () => {
  await page.evaluate(() => window.__sim.vkm.SetVirtualKeyboardVisible());
  await sleep(1500);
});
if (PROFILE && WINDOW === "open") await stopProf();
const firstKey = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(200);
  const out = {};
  const sendAt = (window.__sendAt = []);
  const inp = SteamClient.Input;
  const orig = inp.ControllerKeyboardSendText;
  inp.ControllerKeyboardSendText = function (t) {
    sendAt.push([performance.now(), t]);
    return orig.call(this, t);
  };
  const vgp = (type, button) =>
    document
      .querySelector("[data-key]")
      .dispatchEvent(new CustomEvent(type, { bubbles: true, cancelable: true, detail: { button, source: 1, is_repeat: false } }));
  const press = async (k) => {
    const el = [...document.querySelectorAll("[data-key]")].find(
      (e) => e.getAttribute("data-key") === k && e.getBoundingClientRect().width,
    );
    const t0 = performance.now();
    el.dispatchEvent(new CustomEvent("vgp_onbuttondown", { bubbles: true, cancelable: true, detail: { button: 1, source: 2 } }));
    const h = performance.now() - t0;
    el.dispatchEvent(new CustomEvent("vgp_onbuttonup", { bubbles: true, cancelable: true, detail: { button: 1, source: 2 } }));
    return [t0, h];
  };
  for (const k of "somethin") {
    const [t0, h] = await press(k);
    await wait(150);
    out[`tap ${k}`] = [sendAt.find(([t]) => t >= t0)?.[0] - t0, h];
  }
  sendAt.length = 0;
  const t0 = performance.now();
  vgp("vgp_onbuttondown", 3);
  const h = performance.now() - t0;
  out["X Backspace: press -> send"] = [sendAt[0]?.[0] - t0, h];
  await wait(1500);
  vgp("vgp_onbuttonup", 3);
  const bs = sendAt.filter(([, t]) => t === undefined || true).map(([t]) => t - t0);
  out["X held 1.5 s: Backspaces"] = [bs.length, 0];
  out["X held: gaps ms"] = bs.slice(1).map((t, i) => Math.round(t - bs[i]));
  return out;
});
const pads = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const key = document.querySelector("[data-key]");
  const fk = Object.keys(key).find((k) => k.startsWith("__reactFiber"));
  let kb;
  for (let f = key[fk]; f; f = f.return)
    if (typeof f.stateNode?.HandleTrackpadClick === "function") {
      kb = f.stateNode;
      break;
    }
  const vgp = (type, button) =>
    key.dispatchEvent(new CustomEvent(type, { bubbles: true, cancelable: true, detail: { button, source: 1, is_repeat: false } }));
  const run = async (click) => {
    const ts = [];
    if (click) vgp("vgp_onbuttondown", 22);
    for (let i = 0; i < 100; i++) {
      const a = (i / 100) * Math.PI * 2;
      const t0 = performance.now();
      kb.m_trackpadInput.m_AnalogCallbacks.Dispatch(21, 0, 0.4 * Math.cos(a), 0.3 * Math.sin(a));
      ts.push(performance.now() - t0);
      await wait(8);
    }
    if (click) vgp("vgp_onbuttonup", 22);
    await wait(400);
    ts.sort((x, y) => x - y);
    return [ts.reduce((x, y) => x + y, 0), ts[50], ts[95]];
  };
  return { hover: await run(false), swipe: await run(true) };
});
const idle = await page.evaluate(async () => {
  const p = window.__perf;
  await new Promise((r) => setTimeout(r, 500));
  const r0 = p.raf,
    m0 = p.mut,
    t0 = performance.now();
  const n0 = p.tasks.length;
  await new Promise((r) => setTimeout(r, 3000));
  return { raf: p.raf - r0, mut: p.mut - m0, long: p.tasks.slice(n0).reduce((a, [, d]) => a + d, 0), s: (performance.now() - t0) / 1000 };
});
const reopen = await busy("second open: hide, show -> 1 s", async () => {
  await page.evaluate(() => window.__sim.vkm.SetVirtualKeyboardHidden());
  await sleep(600);
  await page.evaluate(() => window.__sim.vkm.SetVirtualKeyboardVisible());
  await sleep(1000);
});
const tickCost = await page.evaluate(async () => {
  const F = window.__oskTrackpadFix;
  if (!F) return NaN;
  const ts = [];
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    F.tickNow();
    ts.push(performance.now() - t0);
    await new Promise((r) => setTimeout(r, 20));
  }
  ts.sort((a, b) => a - b);
  return ts[10];
});

async function stopProf() {
  const { profile } = await cdp.send("Profiler.stop");
  fs.writeFileSync(PROFILE, JSON.stringify(profile));
  const self = new Map();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const dt = profile.timeDeltas;
  const name = (n) =>
    `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop().split("?")[0]}:${n.callFrame.lineNumber + 1}`;
  for (let i = 0; i < profile.samples.length; i++) {
    const seen = new Set();
    for (let id = profile.samples[i]; id !== undefined; id = parent.get(id)) {
      const k = (id === profile.samples[i] ? "self " : "incl ") + name(byId.get(id));
      if (seen.has(k)) continue;
      seen.add(k);
      self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0) / 1000);
    }
  }
  prof = [...self]
    .filter(([k]) => !/\((root|idle|program)\)/.test(k))
    .sort((a, b) => b[1] - a[1])
    .slice(0, Number(process.env.TOP ?? 30));
}
if (PROFILE && WINDOW === "all") await stopProf();

console.log(`${STOCK ? "STOCK Steam, no patch; " : ""}CPU throttle ${RATE}x, rAF ${FPS ? `${FPS} fps` : "native"}`);
for (const [n, ms, max, wall] of rows)
  console.log(
    `${n.padEnd(44)} ${ms.toFixed(1).padStart(8)} ms${max !== undefined ? `  max task ${max.toFixed(1)} ms  wall ${wall.toFixed(0)} ms` : ""}`,
  );
console.log(`keyboard closed 2 s: rAF ${closed.raf}, mutations ${closed.mut}`);
console.log(`keyboard open idle 3 s: rAF ${idle.raf}, mutations ${idle.mut}, long tasks ${idle.long.toFixed(1)} ms`);
console.log(`tick() with keyboard open: ${tickCost.toFixed(2)} ms (median)`);
for (const [k, v] of Object.entries(firstKey))
  console.log(
    `${k.padEnd(44)} ${Array.isArray(v) && v.length === 2 ? `${Number(v[0]).toFixed(1)} ms (handler ${Number(v[1]).toFixed(1)} ms)` : JSON.stringify(v)}`,
  );
for (const [k, [sum, p50, p95]] of Object.entries(pads))
  console.log(`pad ${k} 100 samples: total ${sum.toFixed(1)} ms, p50 ${p50.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms`);
console.log(`first open long tasks ${open.long.toFixed(1)} ms, second open ${reopen.long.toFixed(1)} ms`);
if (prof) for (const [k, ms] of prof) console.log(`  ${ms.toFixed(1).padStart(8)} ms  ${k}`);
if (errors.length) console.log("errors:", errors.slice(0, 5).join("\n"));
await browser.close();
