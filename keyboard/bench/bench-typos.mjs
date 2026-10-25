import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { geo, low, makeRng, loadEngine } from "./bench.mjs";
import { corpus, SPLITS } from "./bench-sentences.mjs";

const require = createRequire(import.meta.url);
const M = require("../src/modes.js");

const SPECIFIC = [
  ["lpl", "lol"],
  ["teh", "the"],
  ["hwllo", "hello"],
  ["gpod", "good"],
  ["im", "I'm"],
  ["thw", "the"],
  ["adn", "and"],
  ["becuase", "because"],
  ["jsut", "just"],
  ["wiht", "with"],
  ["agian", "again"],
  ["hapy", "happy"],
  ["goood", "good"],
  ["tahnks", "thanks"],
  ["whta", "what"],
  ["yuo", "you"],
  ["dont", "don't"],
  ["realy", "really"],
  ["probaly", "probably"],
  ["gaem", "game"],
];

export const PREFIX_CASES = [
  ["wor", null, "work world word worst", "or"],
  ["wor", "the", "work world word worst", "or"],
  ["wo", null, "would work world", "so"],
  ["tod", null, "today", "to"],
  ["ga", null, "game games", "a"],
  ["frie", "the", "friend friends", "fire"],
  ["hel", "the", "help hell hello", ""],
  ["gam", "the", "game games", ""],
  ["thin", null, "thin", ""],
  ["goo", null, "goo good", ""],
  ["pla", null, "play place plan", ""],
  ["th", null, "the that this", ""],
  ["realy", null, "really", "", true],
  ["teh", null, "the", "", true],
  ["agian", null, "again", "", true],
];

export function prefixCases(eng) {
  return PREFIX_CASES.map(([buf, prev, want, never, confident = false]) => {
    const ctx = { prev, keys: geo.keys };
    const c = eng.correct(buf, ctx);
    const s = eng.suggest(buf, ctx, 3);
    const ok = want.split(" ").includes(s[0]?.key) && (!c || !never.split(" ").includes(low(c.word))) && !!c?.confident === confident;
    return { buf, prev, ok, shown: s.map((x) => x.word).join("/"), corr: c ? c.word + (c.confident ? "!" : "?") : "-" };
  });
}

const LK = Object.entries(geo.keys).filter(([c]) => c.length === 1 && c >= "a" && c <= "z");
const KW = geo.keys.q.w,
  KH = geo.keys.q.h;
const NEAR = Object.fromEntries(
  LK.map(([a, ka]) => [a, LK.filter(([b, kb]) => b !== a && Math.hypot((ka.x - kb.x) / KW, (ka.y - kb.y) / KH) < 1.3).map(([b]) => b)]),
);

const RATES = { sub: 0.55, trans: 0.15, omit: 0.15, insert: 0.15, second: 0.12 };

function corrupt(r, word) {
  let s = [...low(word)];
  const one = () => {
    const x = r();
    const letters = s.map((c, i) => (c >= "a" && c <= "z" ? i : -1)).filter((i) => i >= 0);
    const i = letters[Math.floor(r() * letters.length)];
    if (x < RATES.sub) s[i] = r.pick(NEAR[s[i]]);
    else if (x < RATES.sub + RATES.trans) {
      const j = Math.min(i, s.length - 2);
      [s[j], s[j + 1]] = [s[j + 1], s[j]];
    } else if (x < RATES.sub + RATES.trans + RATES.omit) {
      if (s.length > 2) s.splice(i, 1);
    } else s.splice(i + (r() < 0.5 ? 0 : 1), 0, r() < 0.3 ? s[i] : r.pick(NEAR[s[i]]));
  };
  one();
  if (s.length > 5 && r() < RATES.second) one();
  return s.join("");
}

function baselineSuggest(eng, buf, ctx) {
  const lower = low(buf);
  const list = eng
    .complete(buf, { prev: ctx.prev }, 8)
    .filter((c) => low(c.word) !== lower)
    .map((c) => ({ word: c.word, key: c.key }));
  const c = eng.correct(buf, ctx);
  if (c?.word && low(c.word) !== lower) list.unshift({ word: c.word, key: low(c.word) });
  if (eng.known(lower)) list.unshift({ word: buf, key: lower });
  return list.slice(0, 3);
}

function pct(a, b) {
  return b ? (100 * a) / b : NaN;
}
function p(v, q) {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

export function benchTypos(eng, { seed = 31337, baseline = false, splits = SPLITS, extras = true } = {}) {
  const sug = baseline ? (b, c, n) => baselineSuggest(eng, b, c).slice(0, n) : (b, c, n) => eng.suggest(b, c, n);
  const res = {};
  const ms = [];
  const msLen = [];
  for (const split of splits) {
    const r = makeRng(seed + (split === "heldout" ? 1000 : 0));
    const st = { cleanN: 0, cleanTop1: 0, cleanFalse: 0, n: 0, top1: 0, top3: 0, fix: 0, wrong: 0, realWord: 0, pre: 0, preTop3: 0 };
    const miss = [],
      falses = [];
    for (const { tokens } of corpus().filter((l) => l.split === split)) {
      for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i],
          prev = i ? tokens[i - 1] : null,
          ctx = { prev, keys: geo.keys };
        const key = low(tok);
        if (!eng.known(key)) continue;
        const t0 = performance.now();
        const c0 = sug(tok, ctx, 3);
        ms.push(performance.now() - t0);
        st.cleanN++;
        if (c0[0]?.key === key) st.cleanTop1++;
        const cc = eng.correct(tok, { ...ctx, final: true });
        if (cc?.confident && low(cc.word) !== key) {
          st.cleanFalse++;
          falses.push(`${tok}>${cc.word}`);
        }
        if (key.replace(/'/g, "").length < 3) continue;
        const typed = corrupt(r, tok);
        if (typed === key) continue;
        if (eng.known(typed)) {
          st.realWord++;
          continue;
        }
        const t1 = performance.now();
        const c = sug(typed, ctx, 3);
        const dt = performance.now() - t1;
        ms.push(dt);
        msLen.push([typed.length, dt]);
        st.n++;
        const rank = c.findIndex((x) => x.key === key);
        if (rank === 0) st.top1++;
        if (rank >= 0) st.top3++;
        else if (miss.length < 200) miss.push(`${typed}~${tok}>${c.map((x) => x.word).join("/")}`);
        const a = eng.correct(typed, { ...ctx, final: true });
        if (a?.confident) {
          if (low(a.word) === key) st.fix++;
          else st.wrong++;
        }
        if (typed.length >= 5) {
          const part = typed.slice(0, Math.max(3, typed.length - 2));
          const cp = sug(part, ctx, 3);
          st.pre++;
          if (cp.some((x) => x.key === key)) st.preTop3++;
        }
      }
    }
    res[split] = { st, miss, falses };
  }
  if (!extras) return res;
  const spec = SPECIFIC.map(([typed, want]) => {
    const c = sug(typed, { keys: geo.keys }, 3);
    const a = eng.correct(typed, { keys: geo.keys, final: true });
    return {
      typed,
      want,
      rank: c.findIndex((x) => x.key === low(want)),
      auto: a?.confident && low(a.word) === low(want),
      shown: c.map((x) => x.word),
    };
  });
  const r = makeRng(seed + 5);
  const long = [];
  const words = globalThis.__oskWords.text
    .split("\n")
    .map((l) => l.slice(0, l.lastIndexOf(" ")))
    .filter((w) => /^[a-z]{9,12}$/.test(w));
  for (let i = 0; i < 300; i++) {
    const w = corrupt(r, r.pick(words)).slice(0, 12);
    for (let L = 1; L <= w.length; L++) {
      const t0 = performance.now();
      sug(w.slice(0, L), { keys: geo.keys, prev: "the" }, 3);
      long.push(performance.now() - t0);
    }
  }
  return {
    ...res,
    spec,
    prefix: prefixCases(eng),
    ms: { p50: p(ms, 0.5), p95: p(ms, 0.95), max: Math.max(...ms), typingP95: p(long, 0.95), typingMax: Math.max(...long) },
  };
}

const TAP_LETTERS = Object.fromEntries(LK);
const ALL_KEYS = Object.entries(geo.keys).filter(([k, v]) => v.w > 0 && !k.startsWith("OSKSug_"));
const TL = M.geometry.layoutFrom(TAP_LETTERS, geo.keyboard, geo.padWidthFraction);
const PAD_MAPS = { standard: M.geometry.padMap("standard", TL), big: M.geometry.padMap("big", TL) };
const COG = { trans: 0.03, omit: 0.04, insert: 0.03 };

function keyAt(x, y) {
  for (const [k, v] of ALL_KEYS) if (Math.abs(x - v.x) <= v.w / 2 && Math.abs(y - v.y) <= v.h / 2) return k;
  let hit = null,
    bd = Infinity;
  for (const [k, v] of ALL_KEYS) {
    const d = ((x - v.x) / v.w) ** 2 + ((y - v.y) / v.h) ** 2;
    if (d < bd) {
      bd = d;
      hit = k;
    }
  }
  return hit;
}

function tapOf(map, ch, sigma, r) {
  const side = "qwertasdfgzxcvb".includes(ch) ? "L" : "R";
  const k = TAP_LETTERS[ch];
  const [px, py] = M.geometry.toPad(map, side, k.x, k.y);
  const nx = Math.min(Math.max(px + r.g() * sigma, 0), M.geometry.PAD_MM);
  const ny = Math.min(Math.max(py + r.g() * sigma, 0), M.geometry.PAD_MM);
  const [x, y] = M.geometry.screenOf(map, side, nx / M.geometry.PAD_MM, ny / M.geometry.PAD_MM);
  return { x, y };
}

function typeWithTaps(r, word, map, sigma) {
  let seq = [...low(word).replace(/'/g, "")];
  const x = r();
  if (seq.length > 2 && x < COG.trans) {
    const i = Math.floor(r() * (seq.length - 1));
    [seq[i], seq[i + 1]] = [seq[i + 1], seq[i]];
  } else if (seq.length > 3 && x < COG.trans + COG.omit) seq.splice(1 + Math.floor(r() * (seq.length - 1)), 1);
  else if (x < COG.trans + COG.omit + COG.insert) {
    const i = Math.floor(r() * seq.length);
    seq.splice(i, 0, r() < 0.4 ? seq[i] : r.pick(NEAR[seq[i]]));
  }
  const taps = seq.map((ch) => tapOf(map, ch, sigma, r));
  const hits = taps.map((t) => keyAt(t.x, t.y));
  if (hits.some((h) => !/^[a-z]$/.test(h))) return null;
  return { typed: hits.join(""), taps };
}

export function benchTaps(eng, { seed = 4711, maps = ["big", "standard"], sigmas = [1.5, 2.5], split = "tune" } = {}) {
  const out = [];
  for (const mapName of maps)
    for (const sigma of sigmas) {
      const map = PAD_MAPS[mapName];
      const row = {
        map: mapName,
        sigma,
        falses: [],
        clean: 0,
        typo: 0,
        blocked: 0,
        with: { cleanFalse: 0, top1: 0, top3: 0, fix: 0, wrong: 0 },
        without: { cleanFalse: 0, top1: 0, top3: 0, fix: 0, wrong: 0 },
        ms: [],
      };
      const r = makeRng(seed + Math.round(sigma * 100) + (mapName === "big" ? 7 : 0));
      for (const { tokens } of corpus().filter((l) => split === "all" || l.split === split)) {
        for (let i = 0; i < tokens.length; i++) {
          const tok = tokens[i],
            key = low(tok);
          if (!eng.known(key) || key.replace(/'/g, "").length < 2) continue;
          const t = typeWithTaps(r, tok, map, sigma);
          if (!t) {
            row.blocked++;
            continue;
          }
          const prev = i ? tokens[i - 1] : null;
          const clean = t.typed === key.replace(/'/g, "");
          if (!clean && eng.known(t.typed)) continue;
          if (clean) row.clean++;
          else row.typo++;
          for (const [name, ctx] of [
            ["with", { prev, keys: geo.keys, taps: t.taps }],
            ["without", { prev, keys: geo.keys }],
          ]) {
            const st = row[name];
            const t0 = performance.now();
            const c = eng.correct(t.typed, { ...ctx, final: true });
            const sg = eng.suggest(t.typed, ctx, 3);
            if (name === "with") row.ms.push(performance.now() - t0);
            const auto = c?.confident ? low(c.word) : null;
            if (clean) {
              if (auto && auto !== key) {
                st.cleanFalse++;
                row.falses.push(`${name}:${t.typed}>${auto}`);
              }
              continue;
            }
            const rank = sg.findIndex((x) => x.key === key);
            if (rank === 0) st.top1++;
            if (rank >= 0) st.top3++;
            if (auto === key) st.fix++;
            else if (auto) st.wrong++;
          }
        }
      }
      out.push(row);
    }
  return out;
}

export function formatTaps(rows) {
  const f = (a, b) => pct(a, b).toFixed(1).padStart(5);
  const L = [
    "tap positions  map       sigma  clean typos | without taps: false  top1  top3   fix wrong | with taps: false  top1  top3   fix wrong | ms p95",
  ];
  for (const r of rows) {
    const a = r.without,
      b = r.with;
    L.push(
      `               ${r.map.padEnd(9)} ${r.sigma.toFixed(1).padStart(5)} ${String(r.clean).padStart(6)} ${String(r.typo).padStart(5)} |              ${String(a.cleanFalse).padStart(5)} ${f(a.top1, r.typo)} ${f(a.top3, r.typo)} ${f(a.fix, r.typo)} ${f(a.wrong, r.typo)} |           ${String(b.cleanFalse).padStart(5)} ${f(b.top1, r.typo)} ${f(b.top3, r.typo)} ${f(b.fix, r.typo)} ${f(b.wrong, r.typo)} | ${p(r.ms, 0.95).toFixed(2)}`,
    );
  }
  return L.join("\n");
}

export function format(res) {
  const f = (a, b) => pct(a, b).toFixed(1).padStart(5);
  const L = [];
  for (const split of SPLITS) {
    const s = res[split].st;
    L.push(`== ${split}: typos n=${s.n} (real-word typos skipped ${s.realWord})`);
    L.push(
      `  suggest top1 ${f(s.top1, s.n)} top3 ${f(s.top3, s.n)}   autocorrect fixed ${f(s.fix, s.n)} made-wrong ${f(s.wrong, s.n)}   mid-word top3 ${f(s.preTop3, s.pre)} (n=${s.pre})`,
    );
    L.push(`  clean n=${s.cleanN}: suggest top1 = typed ${f(s.cleanTop1, s.cleanN)}  autocorrect false ${f(s.cleanFalse, s.cleanN)}`);
  }
  L.push(`specific: ${res.spec.map((x) => `${x.typed}>${x.want}:${x.rank < 0 ? "-" : x.rank + 1}${x.auto ? "!" : ""}`).join(" ")}`);
  L.push(
    `prefix cases ${res.prefix.filter((x) => x.ok).length}/${res.prefix.length}${res.prefix
      .filter((x) => !x.ok)
      .map((x) => ` FAIL ${x.buf}(${x.prev}): ${x.shown} corr ${x.corr}`)
      .join("")}`,
  );
  L.push(
    `specific top1 ${res.spec.filter((x) => x.rank === 0).length}/${res.spec.length} top3 ${res.spec.filter((x) => x.rank >= 0).length}/${res.spec.length} auto ${res.spec.filter((x) => x.auto).length}/${res.spec.length}`,
  );
  L.push(
    `suggest ms p50 ${res.ms.p50.toFixed(3)} p95 ${res.ms.p95.toFixed(3)} max ${res.ms.max.toFixed(1)}; typing 9-12 letter words keystroke by keystroke p95 ${res.ms.typingP95.toFixed(3)} max ${res.ms.typingMax.toFixed(1)}`,
  );
  return L.join("\n");
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
  const { engine } = await loadEngine(get("--engine") ?? "../src/engine.js", options);
  engine.warm?.();
  const res = benchTypos(engine, { baseline: args.includes("--baseline"), seed: Number(get("--seed") ?? 31337) });
  console.log(format(res));
  if (!args.includes("--baseline") && !args.includes("--no-taps"))
    for (const split of SPLITS) console.log(`== ${split}\n` + formatTaps(benchTaps(engine, { split })));
  if (args.includes("--misses"))
    for (const split of SPLITS) {
      console.log(split, "miss:", res[split].miss.slice(0, 80).join(" "));
      console.log(split, "false:", res[split].falses.join(" "));
    }
  if (args.includes("--spec")) for (const x of res.spec) console.log(x.typed, x.want, x.shown.join("/"));
}
