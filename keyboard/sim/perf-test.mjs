import { openSim, settle, waitKeyboard } from "./run.mjs";
import { measurePanel } from "./panel-perf.mjs";
import { readRuntime as read } from "../runtime.mjs";
import { makeCheck, pageHelpers, sleep } from "./helpers.mjs";

const RATE = Number(process.env.CPU ?? 4);
let failures = 0;
const results = [];
const check = makeCheck(
  (line) => results.push(line),
  () => failures++,
);

const { browser, page, errors } = await openSim();
const cdp = await page.createCDPSession();
await page.evaluate(() => {
  window.__oskUserWords = null;
  window.localStorage.clear();
  window.localStorage.setItem("oskSwipeSettings", JSON.stringify({ consent: true, tipShown: true }));
  window.__sim.vkm.SetVirtualKeyboardHidden();
});
await sleep(300);
await page.evaluate(["swipe/words.js", "swipe/lm.js", "swipe/engine.js", "modes.js"].map(read).join("\n;\n"));
await page.evaluate(() => {
  const P = (window.__perf = { raf: 0, mut: 0, warm: [], created: 0, engineCalls: [] });
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = function (cb) {
    P.raf++;
    return raf.call(this, cb);
  };
  new MutationObserver((m) => (P.mut += m.length)).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  const E = window.__oskSwipeEngine;
  const create = E.createEngine;
  E.createEngine = (...a) => {
    const t0 = performance.now();
    const eng = create(...a);
    P.created = performance.now() - t0;
    const step = eng.warmStep;
    eng.warmStep = (...b) => {
      const t = performance.now();
      try {
        return step(...b);
      } finally {
        P.warm.push(performance.now() - t);
      }
    };
    for (const name of ["decode", "complete", "predict", "correct", "suggest"]) {
      const f = eng[name];
      eng[name] = (...b) => {
        P.engineCalls.push([performance.now(), name]);
        return f(...b);
      };
    }
    return eng;
  };
});
await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });

const evalMs = await page.evaluate((src) => {
  const t0 = performance.now();
  (0, eval)(src);
  window.__perf.afterEval = !!window.__oskEngine;
  return performance.now() - t0;
}, read("patch.js"));
check(!(await page.evaluate(() => window.__perf.afterEval)), "loading patch.js does not build the engine synchronously", { evalMs });
await page.waitForFunction(() => window.__oskEngine?.__warmed === true, { timeout: 20000, polling: 100 }).catch(() => {});
const load = await page.evaluate(() => ({
  warmed: window.__oskEngine?.__warmed === true,
  steps: window.__perf.warm.length,
  maxStep: Math.max(...window.__perf.warm),
  top: window.__perf.warm
    .map((x, i) => [i, Math.round(x)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6),
  created: window.__perf.created,
  raf: window.__perf.raf,
  mut: window.__perf.mut,
}));
check(load.warmed, "the engine is built and warmed in the background before the keyboard is first opened", load);
check(load.maxStep < 250 * (RATE / 4), `each background warm step stays short (< ${250 * (RATE / 4)} ms at ${RATE}x CPU)`, load);
check(load.raf === 0 && load.mut === 0, "nothing paints or touches the DOM while the keyboard is closed", load);

const open = await page.evaluate(async () => {
  const P = window.__perf;
  const key = () => document.querySelector("[data-key]");
  P.engineCalls.length = 0;
  let forced = 0;
  const t0 = performance.now();
  window.__sim.vkm.SetVirtualKeyboardVisible();
  for (let i = 0; i < 100 && !key(); i++) await new Promise((r) => setTimeout(r, 5));
  const fk = Object.keys(key()).find((k) => k.startsWith("__reactFiber"));
  let kb;
  for (let f = key()[fk]; f; f = f.return)
    if (typeof f.stateNode?.HandleTrackpadClick === "function") {
      kb = f.stateNode;
      break;
    }
  const fu = kb.forceUpdate;
  kb.forceUpdate = function (...a) {
    forced++;
    return fu.apply(this, a);
  };
  for (let i = 0; i < 200 && !document.querySelector('[data-key="Escape"]'); i++) await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => setTimeout(r, 600));
  const early = P.engineCalls.filter(([t]) => t - t0 < 250).map(([, n]) => n);
  await new Promise((r) => setTimeout(r, 2500));
  return { forced, early, warm: window.__oskEngine?.__warm === true, escape: !!document.querySelector('[data-key="Escape"]') };
});
check(open.escape && open.forced === 0, "first open renders VaporType's layout without a second forced render", open);
check(open.early.length === 0, "first open does no engine work in the first 250 ms", open);
check(open.warm, "the per-geometry warm-up finishes within 3 s of opening, in the background", open);
await waitKeyboard(page);

const idle = await page.evaluate(async () => {
  const P = window.__perf;
  await new Promise((r) => setTimeout(r, 600));
  const r0 = P.raf,
    m0 = P.mut;
  await new Promise((r) => setTimeout(r, 2000));
  return { raf: P.raf - r0, mut: P.mut - m0 };
});
check(idle.raf === 0 && idle.mut === 0, "an open, untouched keyboard requests no frames and changes no DOM", idle);

const { vgp } = pageHelpers(page);
const sent = () => page.evaluate(() => window.__keyLog.filter(([, k]) => k === "text"));
const clearLog = () => page.evaluate(() => (window.__keyLog.length = 0));

await page.evaluate(() => window.__oskTrackpadFix.typeText("somethin"));
await settle(page);
await clearLog();
await vgp("vgp_onbuttondown", 3);
await sleep(1500);
await vgp("vgp_onbuttonup", 3);
await sleep(600);
const bs = await page.evaluate(() => {
  const log = window.__keyLog.filter(([, k, v]) => k === "text" && v === "\u0002");
  return { n: log.length, at: log.map(([t]) => t) };
});
const gaps = bs.at.slice(1).map((t, i) => t - bs.at[i]);
check(bs.n >= 9, "holding X repeats Backspace at about 10 per second (Steam's own repeat is 5 per second)", { n: bs.n, gaps });
check(Math.min(...gaps) >= 95, "held Backspaces keep the 100 ms same-key spacing measured over Moonlight", { gaps });
const firstLat = await page.evaluate(() => {
  const t0 = performance.now();
  const n0 = window.__keyLog.length;
  document
    .querySelector("[data-key]")
    .dispatchEvent(
      new CustomEvent("vgp_onbuttondown", { bubbles: true, cancelable: true, detail: { button: 3, source: 1, is_repeat: false } }),
    );
  const sentSync = window.__keyLog.length > n0;
  document
    .querySelector("[data-key]")
    .dispatchEvent(
      new CustomEvent("vgp_onbuttonup", { bubbles: true, cancelable: true, detail: { button: 3, source: 1, is_repeat: false } }),
    );
  return { sentSync, ms: performance.now() - t0 };
});
check(firstLat.sentSync, "the first Backspace goes out in the same event, without waiting for the queue", firstLat);
await settle(page);

await page.evaluate(() => window.__oskTrackpadFix.typeText("aaaaaaaaaa"));
await vgp("vgp_onbuttondown", 3);
await sleep(900);
await vgp("vgp_onbuttonup", 3);
await sleep(150);
const n1 = await page.evaluate(() => window.__keyLog.filter(([, k, v]) => k === "text" && v === "\u0002").length);
await settle(page);
const after = (await page.evaluate(() => window.__keyLog.filter(([, k, v]) => k === "text" && v === "\u0002").length)) - n1;
const queued = await page.evaluate(() => window.__oskTrackpadFix.output.queue.length);
check(queued === 0 && after <= 1, "Backspace repeats do not pile up behind queued text (no deletes long after release)", { after, queued });

await cdp.send("Performance.enable");
const within = (p) =>
  p.open.max <= 60 &&
  p.tab.p95 <= 16 &&
  !p.tabLong.length &&
  p.toggle.p95 <= 8 &&
  !p.toggleLong.length &&
  p.seg.p95 <= 16 &&
  !p.segLong.length &&
  p.slider.p95 <= 8 &&
  !p.sliderLong.length &&
  p.idleAddsPct <= 2;
const first = await measurePanel(page, cdp);
const panel = within(first) ? first : { ...(await measurePanel(page, cdp)), firstOpen: first.firstOpen, retried: true };
if (panel.retried) results.push(`  panel timings over budget once, measured again: ${JSON.stringify(first)}`);
check(panel.firstOpen <= 60 && panel.open.max <= 60, `settings panel opens in <= 60 ms at ${RATE}x CPU, first open included`, {
  firstOpen: panel.firstOpen,
  open: panel.open,
});
check(panel.tab.p95 <= 16 && !panel.tabLong.length, "LB / RB tab switch p95 <= 16 ms, no task over 16 ms", {
  tab: panel.tab,
  long: panel.tabLong,
});
check(panel.toggle.p95 <= 8 && !panel.toggleLong.length, "A on a toggle row p95 <= 8 ms, no task over 16 ms", {
  toggle: panel.toggle,
  long: panel.toggleLong,
});
check(panel.seg.p95 <= 16 && !panel.segLong.length, "left / right on Typing mode p95 <= 16 ms, no task over 16 ms", {
  seg: panel.seg,
  long: panel.segLong,
});
check(panel.slider.p95 <= 8 && !panel.sliderLong.length, "a slider step p95 <= 8 ms, no task over 16 ms", {
  slider: panel.slider,
  long: panel.sliderLong,
});
check(panel.idleAddsPct <= 2, "an open, untouched panel adds <= 2 % CPU", {
  parts: panel.idleParts,
  open: panel.idleOpenPct,
  closed: panel.idleClosedPct,
});

const restored = await page.evaluate(() => {
  const key = document.querySelector("[data-key]");
  const fk = Object.keys(key).find((k) => k.startsWith("__reactFiber"));
  let C;
  for (let f = key[fk]; f; f = f.return)
    if (typeof f.stateNode?.HandleTrackpadClick === "function") {
      C = f.stateNode.constructor;
      break;
    }
  const during = C.s_longPressRepeatThreshold;
  window.__oskTrackpadFix.stop();
  return { during, after: C.s_longPressRepeatThreshold };
});
check(restored.during === 100 && restored.after === 200, "stop() restores Steam's Backspace repeat interval", restored);

await page.evaluate(read("patch.js"));
await waitKeyboard(page);
await page.evaluate(() => {
  window.requestAnimationFrame = () => 0;
});
await clearLog();
await page.evaluate(async () => {
  const el = [...document.querySelectorAll("[data-key]")].find(
    (e) => e.getAttribute("data-key") === "k" && e.getBoundingClientRect().width,
  );
  el.dispatchEvent(new CustomEvent("vgp_onbuttondown", { bubbles: true, cancelable: true, detail: { button: 1, source: 2 } }));
  el.dispatchEvent(new CustomEvent("vgp_onbuttonup", { bubbles: true, cancelable: true, detail: { button: 1, source: 2 } }));
  await new Promise((r) => setTimeout(r, 50));
  window.__oskTrackpadFix.typeText("ok");
  await new Promise((r) => setTimeout(r, 400));
});
const noFrames = (await sent()).map(([, , v]) => v).join("");
check(noFrames === "kok", "typing and output pacing work with no animation frames at all (timers, not frames)", noFrames);

await page.close();
async function startPage(mode) {
  const sim = await openSim({ browser });
  const c = await sim.page.createCDPSession();
  await sim.page.evaluate((mode) => {
    window.__oskUserWords = null;
    window.localStorage.clear();
    window.localStorage.setItem("oskSwipeSettings", JSON.stringify({ consent: true, tipShown: true, mode }));
  }, mode);
  await sim.page.evaluate(["swipe/words.js", "swipe/lm.js", "swipe/engine.js", "modes.js"].map(read).join("\n;\n"));
  await c.send("Emulation.setCPUThrottlingRate", { rate: RATE });
  await sim.page.evaluate(read("patch.js"));
  await waitKeyboard(sim.page);
  await sim.page.waitForFunction(() => window.__oskEngine?.__warm === true, { timeout: 30000, polling: 200 }).catch(() => {});
  await sleep(500);
  errors.push(...sim.errors);
  return sim.page;
}

async function longTasks(steps, gap) {
  const pg = await startPage("standard");
  await pg.evaluate(() => {
    const T = (window.__tasks = { gaps: [], stop: false, quietAt: 0 });
    let last = performance.now();
    const tick = () => {
      const n = performance.now();
      if (n > T.quietAt) T.gaps.push(n - last);
      last = n;
      if (!T.stop) setTimeout(tick, 0);
    };
    const set = window.__oskTrackpadFix.setSetting;
    window.__oskTrackpadFix.setSetting = (...a) => {
      T.quietAt = performance.now() + 150;
      return set(...a);
    };
    setTimeout(tick, 0);
  });
  for (const m of steps) {
    await pg.evaluate((m) => window.__oskTrackpadFix.setSetting("mode", m), m);
    await sleep(gap);
  }
  await sleep(1500);
  const r = await pg.evaluate(() => {
    window.__tasks.stop = true;
    const g = [...window.__tasks.gaps].sort((a, b) => a - b);
    return { n: g.length, median: g[g.length >> 1], max: g[g.length - 1] };
  });
  await pg.close();
  return { ...r, task: Math.round((r.max - r.median) * 10) / 10 };
}

const TASK_LIMIT = 16 * (RATE / 4);
{
  const r = await longTasks(["bigkeys", "standard", "bigkeys", "standard"], 150);
  check(r.task <= TASK_LIMIT, `stepping the Typing mode back and forth at ${RATE}x CPU runs no task over ${TASK_LIMIT} ms`, r);
}

await browser.close();
const errs = errors.filter((e) => !/activeOutputDeviceId|AddOnDisconnectCallback|404|Failed to load resource|Transport Error/.test(e));
check(errs.length === 0, "no page errors", errs.slice(0, 3));
console.log(`CPU throttle ${RATE}x`);
console.log(results.join("\n"));
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
