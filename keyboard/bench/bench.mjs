import fs from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
require("../data/words.js");
try {
  require("../data/lm.js");
} catch {}
export const geo = require("./geometry.json");

export const MODES = ["touch", "onepad-ideal", "twopad-sequential", "twopad-overlap", "sloppy-onepad", "sloppy-twopad"];
const MODE_ALIAS = { "sloppy-onepad": ["onepad-ideal", "sloppy"], "sloppy-twopad": ["twopad-overlap", "sloppy"] };
export const SEEDS = { tune: 20261023, heldout: 777001 };

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
export const KEYS = Object.fromEntries([...LETTERS].map((c) => [c, geo.keys[c]]));
const KW = median(Object.values(KEYS).map((k) => k.w));
const KH = median(Object.values(KEYS).map((k) => k.h));
const KB = geo.keyboard;
const PADW = KB.width * geo.padWidthFraction;
export const PADS = { L: [KB.left, KB.left + PADW], R: [KB.left + KB.width - PADW, KB.left + KB.width] };

function median(v) {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export const low = (w) => w.toLowerCase();

export function makeRng(seed) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.u = (lo, hi) => lo + (hi - lo) * r();
  r.g = () => {
    let u = 0;
    while (u === 0) u = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
  };
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  return r;
}

const swipeLetters = (w) => [...w.toLowerCase()].filter((c) => c >= "a" && c <= "z");
const seqOf = (w) =>
  swipeLetters(w)
    .filter((c, i, a) => c !== a[i - 1])
    .join("");

export const SHORT =
  "i'm ok no yes the lol gg hi so go up we me my is it in on at to do be he us oh yo idk brb wp ty np hey yep omg bro and but for you not can get got see way now how who why too was are his her him has had did out man lol gj nah yea ya ur lmao it's i'd don't can't".split(
    " ",
  );

export function testSet(seed, nCommon = 400, nRare = 100) {
  const r = makeRng(seed ^ 0x5eed);
  const all = [];
  const src = process.env.OSK_TESTSET_WORDS
    ? fs.readFileSync(process.env.OSK_TESTSET_WORDS, "utf8").match(/text: (".*")\s*\};?\s*$/s)[1]
    : null;
  for (const line of (src ? JSON.parse(src) : globalThis.__oskWords.text).split("\n")) {
    const sp = line.lastIndexOf(" ");
    if (sp <= 0) continue;
    const d = line.slice(0, sp);
    if (!/^[A-Za-z]+(?:'[A-Za-z]+)?$/.test(d) || seqOf(d).length < 2) continue;
    all.push({ d, z: Number(line.slice(sp + 1)) / 10 });
  }
  const seen = new Set();
  const uniq = all.filter((w) => !seen.has(w.d.toLowerCase()) && seen.add(w.d.toLowerCase()));
  const common = uniq.slice(0, 5000);
  const rare = uniq.slice(5000, 40000);
  const pickWeighted = (pool, n, weight) => {
    const keyed = pool.map((w) => ({ w, k: Math.log(r()) / weight(w) }));
    keyed.sort((a, b) => b.k - a.k);
    return keyed.slice(0, n).map((x) => x.w);
  };
  const w = (x) => Math.pow(10, x.z / 2);
  const contractions = pickWeighted(
    common.filter((x) => x.d.includes("'")),
    25,
    w,
  );
  const doubles = pickWeighted(
    common.filter((x) => /(.)\1/.test(x.d.toLowerCase()) && !x.d.includes("'")),
    40,
    w,
  );
  const forced = new Set([...contractions, ...doubles]);
  const rest = pickWeighted(
    common.filter((x) => !forced.has(x)),
    nCommon - forced.size,
    w,
  );
  const rareSet = pickWeighted(rare, nRare, () => 1);
  const disp = new Map(uniq.map((x) => [x.d.toLowerCase(), x.d]));
  const short = SHORT.filter((w) => disp.has(w)).map((w) => ({ word: disp.get(w), group: "short" }));
  return [
    ...[...forced, ...rest].map((x) => ({ word: x.d, group: "common" })),
    ...rareSet.map((x) => ({ word: x.d, group: "rare" })),
    ...short,
  ];
}

function reach(pad, ch) {
  const x = KEYS[ch].x;
  return x >= PADS[pad][0] && x <= PADS[pad][1];
}

function clampPad(pad, x) {
  if (!pad) return x;
  return Math.min(PADS[pad][1], Math.max(PADS[pad][0], x));
}

export const SLOPPY_OVERRIDE = JSON.parse(process.env.SLOPPY ?? "{}");

function sloppyBase(r) {
  return {
    sx: r.u(0.28, 0.42),
    sy: r.u(0.26, 0.4),
    vmax: r.u(0.4, 1.1),
    smooth: r.u(0.3, 0.7),
    dt: r.u(8, 16),
    undershoot: r.u(0.2, 0.6),
    jitter: r.u(1.5, 3),
    wobble: r.u(0.04, 0.1),
    jump: 0.4,
    drop: 0.03,
    slowStart: true,
  };
}

function userStyle(r, kind, profile = "normal") {
  const pad = kind !== "touch";
  if (profile === "sloppy") return { ...sloppyBase(r), ...SLOPPY_OVERRIDE };
  return {
    sx: r.u(0.18, 0.32) * (pad ? 1.1 : 1),
    sy: r.u(0.18, 0.3) * (pad ? 1.1 : 1),
    vmax: pad ? r.u(0.5, 1.3) : r.u(0.8, 2.2),
    smooth: r.u(0.12, 0.45),
    dt: r.u(8, 16),
    undershoot: r.u(0, 0.25),
    jitter: 0.6,
    wobble: 0,
    jump: 0,
    drop: 0,
    slowStart: false,
  };
}

function jumpVec(r, st) {
  const m = r.u(0, st.jump),
    a = r.u(0, 2 * Math.PI);
  return [m * KW * Math.cos(a), m * KH * Math.sin(a)];
}

function aim(r, ch, st) {
  const k = KEYS[ch];
  return [k.x + r.g() * st.sx * KW, k.y + r.g() * st.sy * KH];
}

function stroke(r, st, targets, opts) {
  const { start, t0, pad } = opts;
  const verts = [];
  const dwell = [];
  const pushV = (p, d = 0) => {
    verts.push(p);
    dwell.push(d);
  };
  let first = true;
  if (start) {
    pushV(start, 0);
    first = false;
  }
  for (let i = 0; i < targets.length; i++) {
    const { ch, rep } = targets[i];
    let p = aim(r, ch, st);
    if (verts.length && i < targets.length - 1 && r() < 0.5) {
      const q = verts[verts.length - 1];
      const f = r.u(0, st.undershoot);
      p = [p[0] + (q[0] - p[0]) * f * 0.5, p[1] + (q[1] - p[1]) * f * 0.5];
    }
    let d = first ? (st.slowStart ? r.u(80, 250) : r.u(15, 80)) : 0;
    if (first && st.jump) {
      const j = jumpVec(r, st);
      p = [p[0] + j[0], p[1] + j[1]];
    }
    first = false;
    if (rep) {
      const b = r();
      if (b < 0.3) d += r.u(60, 220);
      else if (b < 0.55) {
        pushV(p, d);
        const rad = r.u(0.15, 0.3) * KW;
        const a0 = r.u(0, 2 * Math.PI);
        const dir = r() < 0.5 ? 1 : -1;
        for (let j = 1; j <= 8; j++) {
          const a = a0 + (dir * 2 * Math.PI * j) / 8;
          pushV([p[0] + rad * Math.cos(a) - rad * Math.cos(a0), p[1] + rad * Math.sin(a) - rad * Math.sin(a0)], 0);
        }
        continue;
      }
    }
    pushV(p, d);
  }
  if (verts.length >= 2 && r() < 0.7) {
    const a = verts[verts.length - 2],
      b = verts[verts.length - 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const o = r.u(0, 0.35) * KW;
    pushV([b[0] + ((b[0] - a[0]) / L) * o, b[1] + ((b[1] - a[1]) / L) * o], 0);
  }
  if (st.jump && opts.release !== false) {
    const b = verts[verts.length - 1],
      j = jumpVec(r, st);
    pushV([b[0] + j[0], b[1] + j[1]], 0);
  }
  if (verts.length === 1) pushV([verts[0][0] + r.g() * 2, verts[0][1] + r.g() * 2], 0);

  const dense = [];
  const vAt = [];
  for (let i = 0; i < verts.length; i++) {
    if (i === 0) {
      dense.push([...verts[0]]);
      vAt.push(0);
      continue;
    }
    const a = verts[i - 1],
      b = verts[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(L / 2));
    for (let j = 1; j <= n; j++) dense.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
    vAt.push(dense.length - 1);
  }
  const win = Math.max(0, Math.round((st.smooth * KW) / 2));
  const sm = dense.map((p, i) => {
    const w = Math.min(win, i, dense.length - 1 - i);
    let sx = 0,
      sy = 0;
    for (let j = i - w; j <= i + w; j++) {
      sx += dense[j][0];
      sy += dense[j][1];
    }
    return [sx / (2 * w + 1), sy / (2 * w + 1)];
  });
  const vSet = new Map(vAt.map((v, i) => [v, dwell[i]]));
  const near = new Float64Array(sm.length).fill(1e9);
  for (const v of vAt) for (let i = 0; i < sm.length; i++) near[i] = Math.min(near[i], Math.abs(i - v) * 2);
  const times = [t0];
  const stops = [];
  let t = t0;
  for (let i = 0; i < sm.length; i++) {
    if (vSet.get(i)) {
      stops.push([i, t, vSet.get(i)]);
      t += vSet.get(i);
    }
    if (i > 0) {
      const v = st.vmax * (0.3 + 0.7 * Math.min(1, near[i] / (0.7 * KW)));
      const seg = Math.hypot(sm[i][0] - sm[i - 1][0], sm[i][1] - sm[i - 1][1]);
      t += seg / v;
    }
    times[i] = t;
  }
  const out = [];
  let k = 0;
  let skip = 0;
  const ph = [r.u(0, 6.3), r.u(0, 6.3)],
    wf = r.u(0.004, 0.012);
  for (let tt = t0; ; tt += st.dt + r.u(-2, 2)) {
    const done = tt >= t;
    const T = done ? t : tt;
    while (k < sm.length - 1 && times[k + 1] <= T) k++;
    let x, y;
    if (k >= sm.length - 1) [x, y] = sm[sm.length - 1];
    else {
      const span = times[k + 1] - times[k];
      const f = span > 0 ? Math.max(0, Math.min(1, (T - times[k]) / span)) : 0;
      x = sm[k][0] + (sm[k + 1][0] - sm[k][0]) * f;
      y = sm[k][1] + (sm[k + 1][1] - sm[k][1]) * f;
    }
    x += r.g() * st.jitter + st.wobble * KW * Math.sin(ph[0] + wf * T);
    y += r.g() * st.jitter + st.wobble * KH * Math.sin(ph[1] + 1.3 * wf * T);
    if (skip > 0 && !done && out.length) {
      skip--;
      continue;
    }
    if (st.drop && r() < st.drop) skip = Math.floor(r.u(2, 7));
    out.push({ x: clampPad(pad, x), y: Math.min(KB.top + KB.height, Math.max(KB.top, y)), t: T });
    if (done) break;
  }
  return { pts: out, end: t };
}

function targetsOf(word) {
  const ls = swipeLetters(word);
  const out = [];
  for (const c of ls) {
    if (out.length && out[out.length - 1].ch === c) out[out.length - 1].rep = true;
    else out.push({ ch: c, rep: false });
  }
  return out;
}

function hold(r, pad, pos, from, to, dt, tag = pad) {
  const out = [];
  for (let t = from; t < to; t += dt + r.u(-2, 2)) out.push({ x: clampPad(pad, pos[0] + r.g() * 0.8), y: pos[1] + r.g() * 0.8, t, s: tag });
  return out;
}

export function simulate(word, mode0, r, profile0) {
  const [mode, profile] = MODE_ALIAS[mode0] ?? [mode0, profile0 ?? "normal"];
  const targets = targetsOf(word);
  const kind = mode === "touch" ? "touch" : "pad";
  const st = userStyle(r, kind, profile);
  if (mode === "touch" || mode === "onepad-ideal") {
    const s = mode === "touch" ? "T" : "R1";
    return stroke(r, st, targets, { t0: 1000, pad: null }).pts.map((p) => ({ ...p, s }));
  }
  const runs = [];
  let pad = null;
  for (let i = 0; i < targets.length; i++) {
    const ch = targets[i].ch;
    const rl = reach("L", ch),
      rr = reach("R", ch);
    let p;
    if (pad && (pad === "L" ? rl : rr) && r() > 0.08) p = pad;
    else if (rl && rr) {
      const nx = targets.slice(i + 1).find((t) => !(reach("L", t.ch) && reach("R", t.ch)));
      p = nx ? (reach("L", nx.ch) ? "L" : "R") : r() < 0.5 ? "L" : "R";
    } else p = rl ? "L" : "R";
    if (p !== pad) runs.push({ pad: p, targets: [] });
    runs[runs.length - 1].targets.push(targets[i]);
    pad = p;
  }
  const overlap = mode === "twopad-overlap";
  const pts = [];
  const state = { L: null, R: null };
  const freeAt = { L: 0, R: 0 };
  const tags = { L: 0, R: 0 };
  let t = 1000;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const held = state[run.pad];
    if (!held) {
      t = Math.max(t, freeAt[run.pad] + r.u(20, 60));
      tags[run.pad]++;
    }
    const tag = run.pad + tags[run.pad];
    const s = stroke(r, st, run.targets, { t0: t, pad: run.pad, start: held ? held.pos : null });
    if (held) pts.push(...hold(r, run.pad, held.pos, held.since, t, st.dt, tag));
    pts.push(...s.pts.map((p) => ({ ...p, s: tag })));
    state[run.pad] = null;
    const last = s.pts[s.pts.length - 1];
    const pos = [last.x, last.y];
    const next = runs[i + 1];
    if (!next) break;
    const again = runs.slice(i + 2).find((x) => x.pad === run.pad);
    const later = again && again.targets[0].ch !== run.targets[run.targets.length - 1].ch;
    if (overlap) {
      const press = s.end + r.u(0, 100);
      if (later && r() < 0.35) state[run.pad] = { pos, since: s.end };
      else {
        freeAt[run.pad] = press + r.u(0, 150);
        pts.push(...hold(r, run.pad, pos, s.end, freeAt[run.pad], st.dt, tag));
      }
      t = press;
    } else {
      const rel = s.end + r.u(0, 40);
      freeAt[run.pad] = rel;
      pts.push(...hold(r, run.pad, pos, s.end, rel, st.dt, tag));
      t = rel + r.u(0, 200);
    }
  }
  pts.sort((a, b) => a.t - b.t);
  return pts;
}

export function perfect(word) {
  const seq = seqOf(word);
  const out = [];
  let t = 0;
  for (let i = 0; i < seq.length; i++) {
    const k = KEYS[seq[i]];
    if (i === 0) {
      out.push({ x: k.x, y: k.y, t: t, s: "T" });
      continue;
    }
    const p = KEYS[seq[i - 1]];
    const n = Math.max(1, Math.ceil(Math.hypot(k.x - p.x, k.y - p.y) / 10));
    for (let j = 1; j <= n; j++) out.push({ x: p.x + ((k.x - p.x) * j) / n, y: p.y + ((k.y - p.y) * j) / n, t: (t += 10), s: "T" });
  }
  return out;
}

export async function loadEngine(path = "../src/engine.js", options = {}) {
  const url = new URL(path, import.meta.url);
  const mod = require(url.pathname);
  const t0 = performance.now();
  const engine = mod.createEngine(globalThis.__oskWords.text, { lm: globalThis.__oskLM?.text, ...options });
  return { engine, createMs: performance.now() - t0 };
}

function pct(v, p) {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
}

export function runMode(engine, set, mode, seed) {
  const r = makeRng(seed ^ (MODES.indexOf(mode) * 0x9e3779b1));
  let top1 = 0,
    top3 = 0,
    seq1 = 0;
  const ms = [];
  const groups = {};
  const misses = [];
  for (const { word, group } of set) {
    const trace = mode === "perfect" ? perfect(word) : simulate(word, mode, r);
    const t0 = performance.now();
    const res = engine.decode(trace, KEYS, /twopad/.test(mode) ? { pads: PADS } : {});
    ms.push(performance.now() - t0);
    const k = word.toLowerCase();
    const rank = res.slice(0, 3).findIndex((c) => c.key === k);
    const g = (groups[group] ??= { n: 0, top1: 0 });
    g.n++;
    if (rank === 0) {
      top1++;
      g.top1++;
    } else misses.push({ word, got: res[0]?.word ?? "-", rank });
    if (rank >= 0) top3++;
    if (res[0] && seqOf(res[0].key) === seqOf(k)) seq1++;
  }
  const n = set.length;
  return {
    mode,
    n,
    top1: top1 / n,
    top3: top3 / n,
    seq1: seq1 / n,
    groups,
    meanMs: ms.reduce((a, b) => a + b, 0) / n,
    p95Ms: pct(ms, 0.95),
    maxMs: Math.max(...ms),
    misses,
  };
}

export async function bench({ engine, seeds = SEEDS, modes = MODES } = {}) {
  const rows = [];
  for (const [name, seed] of Object.entries(seeds)) {
    const set = testSet(seed);
    for (const mode of modes) rows.push({ seed: name, ...runMode(engine, set, mode, seed) });
  }
  return rows;
}

function fmt(rows) {
  const f = (x) => (100 * x).toFixed(1).padStart(5);
  const lines = ["seed     mode               top1  top3  seq1  com1  rare1 short1  mean ms  p95 ms"];
  for (const r of rows) {
    lines.push(
      `${r.seed.padEnd(8)} ${r.mode.padEnd(18)} ${f(r.top1)} ${f(r.top3)} ${f(r.seq1)} ${f(r.groups.common.top1 / r.groups.common.n)} ${f(r.groups.rare.top1 / r.groups.rare.n)} ${f(r.groups.short ? r.groups.short.top1 / r.groups.short.n : 0)}  ${r.meanMs.toFixed(2).padStart(7)} ${r.p95Ms.toFixed(2).padStart(7)}`,
    );
  }
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const get = (k) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const options = {};
  for (const kv of args.filter((a, i) => args[i - 1] === "--opt")) {
    const [k, v] = kv.split("=");
    options[k] = JSON.parse(v);
  }
  const { engine, createMs } = await loadEngine(get("--engine") ?? "../src/engine.js", options);
  engine.decode(perfect("hello"), KEYS, { pads: PADS });
  const modes = get("--mode") ? get("--mode").split(",") : MODES;
  const rows = await bench({ engine, modes });
  console.log(fmt(rows));
  const self = runMode(engine, testSet(SEEDS.tune), "perfect", SEEDS.tune);
  const ok = self.seq1 > 0.98;
  console.log(
    `engine create ${createMs.toFixed(1)} ms; self-check noiseless seq-top1 ${(100 * self.seq1).toFixed(1)}% (exact ${(100 * self.top1).toFixed(1)}%) ${ok ? "OK" : "FAIL"}`,
  );
  if (args.includes("--misses"))
    for (const r of rows)
      console.log(
        r.seed,
        r.mode,
        r.misses
          .slice(0, 40)
          .map((m) => `${m.word}>${m.got}`)
          .join(" "),
      );
  if (!ok) process.exitCode = 1;
}
