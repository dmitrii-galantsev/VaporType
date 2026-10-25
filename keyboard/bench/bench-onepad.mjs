import { pathToFileURL } from "node:url";
import { simulate, KEYS, PADS, SEEDS, geo, makeRng, loadEngine, testSet, runMode } from "./bench.mjs";

const KB = geo.keyboard;
const SPAN = geo.padWidthFraction;
const CX = KB.left + KB.width / 2;
const ONEPAD = { L: PADS.L, R: [KB.left, KB.left + KB.width] };

export function simulateOnePad(word, r, profile = "normal") {
  const orig = {};
  for (const [c, k] of Object.entries(KEYS)) {
    orig[c] = k;
    KEYS[c] = { ...k, x: CX + (k.x - CX) * SPAN };
  }
  let pts;
  try {
    pts = simulate(word, "onepad-ideal", r, profile);
  } finally {
    Object.assign(KEYS, orig);
  }
  return pts.map((p) => ({ ...p, x: Math.min(KB.left + KB.width, Math.max(KB.left, CX + (p.x - CX) / SPAN)), s: "R1" }));
}

function runOnePad(engine, set, seed, profile) {
  const r = makeRng(seed ^ 0x0e9ad ^ (profile === "sloppy" ? 0x51 : 0));
  let top1 = 0,
    top3 = 0;
  const ms = [];
  const groups = {};
  for (const { word, group } of set) {
    const trace = simulateOnePad(word, r, profile);
    const t0 = performance.now();
    const res = engine.decode(trace, KEYS, { pads: ONEPAD });
    ms.push(performance.now() - t0);
    const rank = res.slice(0, 3).findIndex((c) => c.key === word.toLowerCase());
    const g = (groups[group] ??= { n: 0, top1: 0 });
    g.n++;
    if (rank === 0) {
      top1++;
      g.top1++;
    }
    if (rank >= 0) top3++;
  }
  ms.sort((a, b) => a - b);
  return {
    mode: profile === "sloppy" ? "sloppy-onepad-real" : "onepad-real",
    n: set.length,
    top1: top1 / set.length,
    top3: top3 / set.length,
    groups,
    meanMs: ms.reduce((a, b) => a + b, 0) / ms.length,
    p95Ms: ms[Math.floor(ms.length * 0.95)],
  };
}

export async function benchOnePad({ engine, seeds = SEEDS } = {}) {
  const rows = [];
  for (const [name, seed] of Object.entries(seeds)) {
    const set = testSet(seed);
    for (const mode of ["onepad-ideal", "twopad-sequential", "twopad-overlap", "sloppy-onepad", "sloppy-twopad"])
      rows.push({ seed: name, ...runMode(engine, set, mode, seed) });
    rows.push({ seed: name, ...runOnePad(engine, set, seed, "normal") });
    rows.push({ seed: name, ...runOnePad(engine, set, seed, "sloppy") });
  }
  return rows;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { engine } = await loadEngine("../src/engine.js");
  const rows = await benchOnePad({ engine });
  const f = (x) => (100 * x).toFixed(1).padStart(5);
  console.log("seed     mode                 top1  top3  com1  rare1 short1  mean ms  p95 ms");
  for (const r of rows) {
    const g = (k) => (r.groups[k] ? f(r.groups[k].top1 / r.groups[k].n) : "    -");
    console.log(
      `${r.seed.padEnd(8)} ${r.mode.padEnd(20)} ${f(r.top1)} ${f(r.top3)} ${g("common")} ${g("rare")} ${g("short")}  ${r.meanMs.toFixed(2).padStart(7)} ${r.p95Ms.toFixed(2).padStart(7)}`,
    );
  }
}
