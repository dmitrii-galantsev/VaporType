import fs from "node:fs";
import { createRequire } from "node:module";
import { geo, low, makeRng } from "./bench.mjs";

const require = createRequire(import.meta.url);
const here = new URL(".", import.meta.url).pathname;
require(here + "../data/words.js");
require(here + "../data/lm.js");
const E = require(here + "../src/engine.js");
const M = require(here + "../src/modes.js");

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const SIGMAS = opt("--sigmas", "1.5,2.5,3.5").split(",").map(Number);
const SEEDS = opt("--seeds", "20261023,777001").split(",").map(Number);
const LIMIT = Number(opt("--limit", "0"));
const ONLY = opt("--only", "");

const { layoutFrom, padMap, screenOf, toPad, PAD_MM } = M.geometry;

const engine = E.createEngine(globalThis.__oskWords.text, { lm: globalThis.__oskLM.text });
engine.warm?.();

const letters = Object.fromEntries(Object.entries(geo.keys).filter(([c]) => /^[a-z]$/.test(c)));
const allKeys = Object.entries(geo.keys).filter(([k, v]) => v.w > 0 && !k.startsWith("OSKSug_"));
const L = layoutFrom(letters, geo.keyboard, geo.padWidthFraction);
const MAPS = { standard: padMap("standard", L), big: padMap("big", L) };

function corpus() {
  const lines = fs
    .readFileSync(here + "corpora/chat-corpus.txt", "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const out = [];
  for (const l of lines) {
    const toks = l
      .split(/\s+/)
      .map((t) => t.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, ""))
      .filter((t) => /^[A-Za-z']+$/.test(t));
    toks.forEach((t, i) => out.push({ word: t, prev: i ? toks[i - 1] : null }));
  }
  return out;
}

const sideOf = (ch) => ("qwertasdfgzxcvb".includes(ch) ? "L" : "R");

function keyAtScreen(x, y) {
  let hit = null;
  for (const [k, v] of allKeys)
    if (Math.abs(x - v.x) <= v.w / 2 && Math.abs(y - v.y) <= v.h / 2) {
      hit = k;
      break;
    }
  if (hit) return hit;
  let bd = Infinity;
  for (const [k, v] of allKeys) {
    const d = ((x - v.x) / v.w) ** 2 + ((y - v.y) / v.h) ** 2;
    if (d < bd) {
      bd = d;
      hit = k;
    }
  }
  return hit;
}

function tapsFor(word, kind, sigma, r) {
  const map = MAPS[kind];
  const taps = [];
  for (const ch of word.toLowerCase().replace(/'/g, "")) {
    const side = sideOf(ch);
    const k = letters[ch];
    const [px, py] = toPad(map, side, k.x, k.y);
    const nx = Math.min(Math.max(px + r.g() * sigma, 0), PAD_MM);
    const ny = Math.min(Math.max(py + r.g() * sigma, 0), PAD_MM);
    const [x, y] = screenOf(map, side, nx / PAD_MM, ny / PAD_MM);
    taps.push({ x, y, side });
  }
  return taps;
}

const plain = (w) => low(w).replace(/'/g, "");

const CONDITIONS = {
  "standard taps": { map: "standard", how: "literal" },
  "standard taps + autocorrect": { map: "standard", how: "autocorrect" },
  "big keys taps + autocorrect": { map: "big", how: "autocorrect" },
};

function run(name, c, items, sigma, seed) {
  const r = makeRng(seed);
  let n = 0,
    top1 = 0,
    row = 0,
    blocked = 0;
  const ms = [];
  const miss = [];
  for (const { word, prev } of items) {
    const taps = tapsFor(word, c.map, sigma, r);
    n++;
    const hits = taps.map((t) => keyAtScreen(t.x, t.y));
    if (hits.some((h) => !/^[a-z]$/.test(h))) {
      blocked++;
      miss.push(`${word}>#`);
      continue;
    }
    const typed = hits.join("");
    let out = typed;
    if (c.how === "autocorrect") {
      const t0 = performance.now();
      const res = engine.correct(typed, { prev, keys: letters, final: true });
      ms.push(performance.now() - t0);
      if (res?.confident) out = res.word;
      if ([out, res?.word, ...(res?.alts ?? [])].some((w) => w && low(w) === low(word))) row++;
    } else if (typed === plain(word)) row++;
    if (low(out) === low(word) || (c.how === "literal" && out === plain(word))) top1++;
    else miss.push(`${word}>${out}`);
  }
  return {
    n,
    top1: top1 / n,
    row: row / n,
    blocked: blocked / n,
    ms: ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : 0,
    p95: ms.length ? ms.sort((a, b) => a - b)[Math.floor(ms.length * 0.95)] : 0,
    miss,
  };
}

let items = corpus().filter((x) => engine.known(x.word));
const oov = corpus().length - items.length;
if (LIMIT) items = items.slice(0, LIMIT);
const pct = (v) => (100 * v).toFixed(1).padStart(5);
const keyMm = (kind) => {
  const m = MAPS[kind];
  const w = (side, a, b) => Math.abs(toPad(m, side, letters[b].x, letters[b].y)[0] - toPad(m, side, letters[a].x, letters[a].y)[0]);
  const h = (side) => Math.abs(toPad(m, side, letters.d.x, letters.d.y)[1] - toPad(m, side, letters.e.x, letters.e.y)[1]);
  return `L key ${w("L", "e", "r").toFixed(1)}x${h("L").toFixed(1)} mm, R key ${w("R", "u", "i").toFixed(1)}x${h("R").toFixed(1)} mm`;
};
console.log(`chat corpus: ${items.length} in-dictionary words (${oov} OOV skipped), seeds ${SEEDS.join(",")}, pad ${PAD_MM} mm`);
for (const k of ["standard", "big"]) console.log(`  ${k} map: ${keyMm(k)}`);
for (const sigma of SIGMAS) {
  console.log(`\n== tap noise sigma ${sigma} mm on the pad        word ok  in row  off-letters  ms mean/p95`);
  for (const [name, c] of Object.entries(CONDITIONS)) {
    if (ONLY && !name.toLowerCase().includes(ONLY.toLowerCase())) continue;
    const rs = SEEDS.map((s) => run(name, c, items, sigma, s + Math.round(sigma * 1000)));
    const avg = (f) => rs.reduce((a, x) => a + x[f], 0) / rs.length;
    console.log(
      `  ${name.padEnd(36)} ${pct(avg("top1"))}  ${pct(avg("row"))}  ${pct(avg("blocked"))}      ${avg("ms").toFixed(2)}/${avg("p95").toFixed(1)}`,
    );
    if (args.includes("--misses")) console.log("    " + rs[0].miss.slice(0, 40).join(" "));
  }
}
