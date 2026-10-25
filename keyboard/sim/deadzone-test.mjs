import fs from "node:fs";
import { openSim, inject, settle } from "./run.mjs";
import { readRuntime as read } from "../runtime.mjs";
import { sleep } from "./helpers.mjs";

const bench = !!process.env.DEADZONE_BENCH;
const stock = !!process.env.STOCK;
const patchSrc = process.env.PATCH_SRC ? fs.readFileSync(process.env.PATCH_SRC, "utf8") : null;
const COUNT = Number(process.env.DRIFTS ?? (bench ? 120 : 10));

const opened = await openSim();
const { browser, errors } = opened;
let page = opened.page;
let popups = 0;
let failures = 0;
const results = [];
const check = (ok, title, detail = "") => {
  if (!ok) failures++;
  results.push(`${ok ? "PASS" : "FAIL"} ${title}${detail ? `\n      ${detail}` : ""}`);
};

if (!stock) {
  await page.evaluate(["swipe/words.js", "swipe/lm.js", "swipe/engine.js"].map(read).join("\n;\n"));
  await page.evaluate(() => {
    window.__oskUserWords = null;
    window.localStorage.clear();
  });
  results.push(`inject: ${await inject(page, patchSrc ?? read("patch.js"))}`);
  if (process.env.DEADZONE) await page.evaluate((v) => window.__oskTrackpadFix.setSetting("deadzone", v), Number(process.env.DEADZONE));
}

function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}
const gauss = (r) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());

function driftPath(r, kind) {
  const D = 0.6 + 0.6 * r(),
    T = 300 + 500 * r(),
    ang = 2 * Math.PI * r(),
    J = 0.4 * r(),
    ja = 2 * Math.PI * r();
  const pts = [];
  let wx = 0,
    wy = 0,
    t = 0;
  while (t <= T) {
    const f = t / T;
    const prof = kind === "walk" ? f : f * f * (3 - 2 * f);
    const jt = Math.min(1, t / 40);
    wx += gauss(r) * 0.025;
    wy += gauss(r) * 0.025;
    pts.push([t, D * prof * Math.cos(ang) + J * jt * Math.cos(ja) + wx, D * prof * Math.sin(ang) + J * jt * Math.sin(ja) + wy]);
    t += 6 + 6 * r();
  }
  return { pts, D, T };
}

const play = (fn, ...args) =>
  page.evaluate(
    async (src, args) => {
      const key = document.querySelector("[data-key]");
      const fk = Object.keys(key).find((k) => k.startsWith("__reactFiber"));
      let kb;
      for (let f = key[fk]; f; f = f.return)
        if (typeof f.stateNode?.HandleTrackpadClick === "function") {
          kb = f.stateNode;
          break;
        }
      return new Function("kb", "args", `return (${src})(kb, ...args)`)(kb, args);
    },
    fn.toString(),
    args,
  );

async function stroke(side, startKey, samples, { rest = 30 } = {}) {
  await play(
    async (kb, side, startKey, samples, rest) => {
      const F = window.__oskTrackpadFix;
      const span = F?.modeApi?.spans?.()[side] ?? 0.55;
      const r = kb.m_keyboardDiv.getBoundingClientRect();
      const widths = [...document.querySelectorAll("[data-key]")]
        .filter((e) => /^[a-z]$/.test(e.getAttribute("data-key")))
        .map((e) => e.getBoundingClientRect().width)
        .filter((w) => w > 0)
        .sort((a, b) => a - b);
      const kw = widths[Math.floor(widths.length / 2)];
      const el = [...document.querySelectorAll("[data-key]")].find(
        (e) => e.getAttribute("data-key") === startKey && e.getBoundingClientRect().width > 0,
      );
      const c = el.getBoundingClientRect();
      const cx = c.left + c.width / 2,
        cy = c.top + c.height / 2;
      const x0 = side === "L" ? r.left : r.right - r.width * span;
      const raw = (x, y) => [
        Math.max(-1, Math.min(1, (2 * (x - x0)) / (r.width * span) - 1)),
        Math.max(-1, Math.min(1, 1 - (2 * (y - r.top)) / r.height)),
      ];
      const pad = side === "L" ? kb.m_leftTrackpad : kb.m_rightTrackpad;
      const put = (x, y) => {
        pad.active = true;
        pad.x = x;
        pad.y = y;
      };
      const dispatch = (ux, uy) => kb.m_trackpadInput.m_AnalogCallbacks.Dispatch(side === "L" ? 19 : 21, 0, ux, uy);
      const btn = (type) =>
        (document.querySelector("[data-key]") ?? document.body).dispatchEvent(
          new CustomEvent(type, {
            bubbles: true,
            cancelable: true,
            detail: { button: side === "L" ? 20 : 22, source: 1, is_repeat: false },
          }),
        );
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      const move = F ? (x, y) => dispatch(...raw(x, y)) : put;
      move(cx, cy);
      await wait(rest);
      move(cx, cy);
      btn("vgp_onbuttondown");
      const t0 = performance.now();
      for (const [t, dx, dy] of samples) {
        const d = t0 + t - performance.now();
        if (d > 0) await wait(d);
        move(cx + dx * kw, cy + dy * kw);
      }
      btn("vgp_onbuttonup");
      kb[side === "L" ? "m_leftTrackpad" : "m_rightTrackpad"].active = false;
    },
    side,
    startKey,
    samples,
    rest,
  );
  if (stock) await sleep(80);
  await settle(page);
}

async function trial(side, startKey, samples) {
  await page.evaluate(() => {
    window.__keyLog.length = 0;
  });
  await page.evaluate(() => {
    if (window.__oskSwipeLog) window.__oskSwipeLog.length = 0;
  });
  const n0 = 0;
  await stroke(side, startKey, samples);
  const log = await page.evaluate(() => window.__keyLog.slice());
  const n1 = await page.evaluate(() => window.__oskSwipeLog?.length ?? 0);
  if (stock && !(await page.evaluate(() => document.querySelectorAll("[data-key]").length))) {
    popups++;
    await page.close();
    page = (await openSim({ browser })).page;
  }
  let text = "";
  for (const [, kind, v] of log) if (kind === "text") text = v === "\u0002" ? text.slice(0, -1) : text + v;
  return { text, swiped: n1 > n0 };
}

const L_KEYS = [..."qwertasdfgzxcvb"];
const R_KEYS = [..."yuiophjklnm"];

async function driftCorpus(kind, seed, n) {
  const r = rng(seed);
  let swiped = 0,
    wrongKey = 0;
  const fast = [];
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? "L" : "R";
    const keys = side === "L" ? L_KEYS : R_KEYS;
    const startKey = keys[Math.floor(r() * keys.length)];
    const d = driftPath(r, kind);
    const res = await trial(side, startKey, d.pts);
    if (res.swiped || res.text.replace(/\s/g, "").length > 1) {
      swiped++;
      fast.push(`${startKey} D=${d.D.toFixed(2)} T=${d.T.toFixed(0)}ms -> ${JSON.stringify(res.text)}`);
    } else if (res.text.trim() !== startKey) wrongKey++;
  }
  return { n, swiped, wrongKey, fast };
}

const WORDS = [
  ["we", 55],
  ["hi", 55],
  ["at", 55],
  ["be", 55],
  ["up", 55],
  ["on", 55],
  ["in", 55],
  ["oh", 55],
  ["to", 75],
  ["it", 75],
  ["of", 75],
  ["is", 75],
];
const SPEEDS = [6, 10, 16];
const OVERSHOOT = 0.4;

async function wordTrial(word, speed, reach) {
  const geo = await play((kb) => {
    const r = kb.m_keyboardDiv.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width };
  });
  const pts = [];
  for (const ch of word) {
    const c = await page.evaluate((k) => {
      const e = [...document.querySelectorAll("[data-key]")].find(
        (x) => x.getAttribute("data-key") === k && x.getBoundingClientRect().width > 0,
      );
      const r = e.getBoundingClientRect();
      const kws = [...document.querySelectorAll("[data-key]")]
        .filter((x) => /^[a-z]$/.test(x.getAttribute("data-key")))
        .map((x) => x.getBoundingClientRect().width)
        .sort((a, b) => a - b);
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, kw: kws[Math.floor(kws.length / 2)] };
    }, ch);
    pts.push(c);
  }
  const first = word[0];
  const samples = [[0, 0, 0]];
  let t = 0,
    off = { x: 0, y: 0 };
  for (let i = 1; i < pts.length; i++) {
    let dx = (pts[i].x - pts[i - 1].x) / pts[i].kw,
      dy = (pts[i].y - pts[i - 1].y) / pts[i].kw;
    if (i === pts.length - 1) {
      const l = Math.hypot(dx, dy);
      dx += (dx / l) * OVERSHOOT;
      dy += (dy / l) * OVERSHOOT;
    }
    const len = Math.hypot(dx, dy);
    const dur = (len / speed) * 1000;
    const steps = Math.max(2, Math.round(dur / 8));
    for (let s = 1; s <= steps; s++) {
      t += dur / steps;
      samples.push([t, off.x + (dx * s) / steps, off.y + (dy * s) / steps]);
    }
    off = { x: off.x + dx, y: off.y + dy };
  }
  const span = reach / 100;
  const side = pts.every((p) => p.x < geo.left + geo.width * span) ? "L" : "R";
  if (!stock) await page.evaluate((v) => window.__oskTrackpadFix.setSetting("reach", v), reach);
  return trial(side, first, samples).then((r) => ({ ...r, word }));
}

async function shortWords() {
  const out = {};
  for (const speed of SPEEDS) {
    let ok = 0,
      started = 0;
    const bad = [];
    for (const [w, reach] of WORDS) {
      const r = await wordTrial(w, speed, reach);
      if (r.swiped) started++;
      if (r.text.trim() === w) ok++;
      else bad.push(`${w}:${JSON.stringify(r.text)}`);
    }
    out[speed] = { ok, started, n: WORDS.length, bad };
  }
  return out;
}

const RED = [
  [0, 0, 0],
  [86, -0.02, 0.02],
  [106, -0.07, 0.04],
  [114, -0.11, 0.06],
  [118, -0.15, 0.08],
  [122, -0.21, 0.1],
  [126, -0.28, 0.14],
  [130, -0.37, 0.18],
  [132, -0.48, 0.23],
  [138, -0.59, 0.28],
  [154, -0.71, 0.34],
];
const ACCIDENTS = [
  { name: "as 12 samples 131 ms 66 px", n: 12, dur: 131, px: 66, key: "a", side: "L", dir: [1, 0.15] },
  { name: "as 11 samples 175 ms 56 px", n: 11, dur: 175, px: 56, key: "a", side: "L", dir: [1, -0.3] },
  { name: "as 11 samples 131 ms 46 px", n: 11, dur: 131, px: 46, key: "s", side: "L", dir: [-1, 0.2] },
  { name: "hmm 9 samples 139 ms 49 px", n: 9, dur: 139, px: 49, key: "h", side: "R", dir: [1, 0.4] },
  { name: "tree 9 samples 140 ms 49 px", n: 9, dur: 140, px: 49, key: "t", side: "L", dir: [-1, 0.5] },
  { name: "oh 50 samples 487 ms 193 px path", n: 50, dur: 487, px: 193, key: "o", side: "R", dir: [-0.3, 1], wander: true },
];
const PROFILES = {
  linear: (f) => f,
  early: (f) => Math.min(1, f / 0.5) ** 0.7,
  late: (f) => Math.max(0, (f - 0.5) / 0.5) ** 1.5,
};

function accidentSamples(a, prof, r) {
  const kwPx = 60.6;
  const l = Math.hypot(...a.dir);
  const ux = a.dir[0] / l,
    uy = a.dir[1] / l;
  const D = a.px / kwPx;
  const out = [];
  for (let i = 0; i < a.n; i++) {
    const f = i / (a.n - 1);
    if (a.wander) {
      out.push([f * a.dur, Math.sin(Math.PI * f) * 0.6 + (r() - 0.5) * 0.5, f * 1.0 + (r() - 0.5) * 0.5]);
    } else {
      const g = PROFILES[prof](f) * D;
      out.push([f * a.dur, g * ux, g * uy]);
    }
  }
  return out;
}

async function accidents() {
  const r = rng(21);
  const res = [];
  const run = async (name, side, key, samples) => {
    const out = await trial(side, key, samples);
    res.push({ name, swiped: out.swiped, text: out.text });
  };
  await run("red (replayed from the Deck's log)", "L", "r", RED);
  for (const a of ACCIDENTS)
    for (const prof of a.wander ? ["wander"] : Object.keys(PROFILES))
      await run(`${a.name} ${prof}`, a.side, a.key, accidentSamples(a, prof, r));
  return res;
}

const e0 = errors.length;
const walk = await driftCorpus("walk", 11, COUNT);
const roll = await driftCorpus("roll", 12, COUNT);
const sw = bench && !stock ? await shortWords() : null;
const acc = bench || !stock ? await accidents() : null;

if (bench) {
  console.log(
    JSON.stringify(
      {
        variant: stock ? "stock" : (process.env.VARIANT ?? "patch"),
        walk,
        roll,
        stockHoldPopups: stock ? popups : undefined,
        shortWords: sw,
        accidents: {
          n: acc.length,
          swiped: acc.filter((x) => x.swiped).length,
          list: acc.filter((x) => x.swiped).map((x) => `${x.name} -> ${JSON.stringify(x.text)}`),
        },
      },
      null,
      1,
    ),
  );
} else {
  check(
    walk.swiped === 0,
    `slow resting-thumb drift (${walk.n} random walks, 0.6-1.2 keys over 300-800 ms) never starts a swipe`,
    walk.fast.join(" | "),
  );
  check(roll.swiped <= Math.ceil(roll.n * 0.1), `smoothstep thumb rolls start at most 10% swipes (${roll.swiped}/${roll.n})`);
  const wrong = acc.filter((x) => x.swiped);
  check(
    wrong.length === 0,
    `the Deck's accidental swipes (replayed "red", synthesized "as", "hmm", "tree", "oh": ${acc.length} strokes) all stay taps`,
    wrong.map((x) => `${x.name} -> ${JSON.stringify(x.text)}`).join(" | "),
  );
  check(walk.wrongKey === 0, `drifted presses still type the key they started on (${walk.wrongKey} wrong of ${walk.n})`);
}

if (!bench && !stock) {
  for (const [w, reach] of [
    ["to", 75],
    ["it", 75],
    ["we", 55],
    ["hi", 55],
  ]) {
    const fastRes = await wordTrial(w, 14, reach);
    check(fastRes.swiped && fastRes.text.trim() === w, `fast short swipe "${w}" (14 keys/s) still decodes`, JSON.stringify(fastRes));
  }
  const tapRes = await trial("R", "j", [[0, 0, 0]]);
  check(!tapRes.swiped && tapRes.text.trim() === "j", "a plain press with no movement is still a tap", JSON.stringify(tapRes));
  const jolt = await trial("R", "k", [
    [0, 0, 0],
    [15, 0.3, 0.1],
    [30, 0.45, 0.15],
    [60, 0.5, 0.15],
    [200, 0.5, 0.15],
  ]);
  check(!jolt.swiped && jolt.text.trim() === "k", "a half-key jolt at touch-down is absorbed by the settle time", JSON.stringify(jolt));
  const slow = await trial(
    "R",
    "k",
    Array.from({ length: 40 }, (_, i) => [i * 15, (i / 39) * 1.2, 0]),
  );
  check(!slow.swiped, "a slow 1.2-key creep over 600 ms stays a tap", JSON.stringify(slow));
}

const bad = errors.slice(e0).filter((e) => !/404|Failed to load|Transport|passive event listener/.test(e));
if (bad.length) {
  failures++;
  results.push(`errors ${bad.join(" | ")}`);
}
if (!bench) {
  console.log(results.join("\n"));
  console.log(failures ? `${failures} FAILED` : "ALL PASS");
}
await browser.close();
process.exit(failures ? 1 : 0);
