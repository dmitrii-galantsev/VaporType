import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { KEYS, PADS, geo, low, makeRng, simulate, loadEngine } from "./bench.mjs";

const SWIPE_MODES = ["onepad-ideal", "twopad-overlap", "sloppy-onepad", "sloppy-twopad"];
const OOV =
  "kirito xqc pogchamp valorant minecraft fortnite elden apex overwatch warzone genshin roblox tarkov halo2 zelda hollowknight noita factorio rimworld stardew terraria baldurs palworld helldivers deckmate pokimane asmongold lirik summit1g moonlight decky proton protondb flatpak kde plasma gamescope steamos lutris heroic".split(
    " ",
  );

const EVAL = process.env.OSK_CORPUS ? process.env.OSK_CORPUS.replace(/^.*\//, "").replace(/-corpus\.txt$|\.txt$/, "") : null;
export const SPLITS = EVAL ? [EVAL] : ["tune", "heldout"];

export function corpus(path = new URL("./corpora/" + (process.env.OSK_CORPUS || "chat-corpus.txt"), import.meta.url)) {
  const lines = fs
    .readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.map((l, i) => ({
    split: EVAL ? EVAL : i % 4 === 3 ? "heldout" : "tune",
    tokens: l
      .split(/\s+/)
      .map((t) => t.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, ""))
      .filter((t) => /^[A-Za-z']+$/.test(t)),
  }));
}

function swipeWords(engine, lines, mode, seed) {
  const r = makeRng(seed);
  let n = 0,
    t1 = 0,
    t3 = 0,
    oov = 0;
  const ms = [];
  const miss = [];
  for (const { tokens } of lines) {
    let prev = null;
    for (const tok of tokens) {
      if (!engine.known(tok)) {
        oov++;
        prev = tok;
        continue;
      }
      if (engine.letters(tok).length < 2 && !/(.)\1/.test(low(tok))) {
        prev = tok;
        continue;
      }
      const trace = simulate(tok, mode, r);
      const t0 = performance.now();
      const res = engine.decode(trace, KEYS, { prev, pads: /twopad/.test(mode) ? PADS : undefined });
      ms.push(performance.now() - t0);
      const rank = res.slice(0, 3).findIndex((c) => c.key === low(tok));
      n++;
      if (rank === 0) t1++;
      else miss.push(`${tok}>${res[0]?.word ?? "-"}`);
      if (rank >= 0) t3++;
      prev = res[0]?.word ?? tok;
    }
  }
  return { n, top1: t1 / n, top3: t3 / n, oov, meanMs: ms.reduce((a, b) => a + b, 0) / ms.length, miss };
}

function phraseSpans(engine, tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++)
    for (let j = Math.min(tokens.length, i + 3); j >= i + 2; j--) {
      const k = tokens.slice(i, j).join(" ");
      if (engine.info ? engine.info(k)?.phrase : engine.known(k)) {
        out.push({ i, j, k: low(k), d: k });
        break;
      }
    }
  return out;
}

function swipePhrases(engine, lines, mode, seed) {
  const r = makeRng(seed);
  let n = 0,
    t1 = 0,
    t3 = 0;
  const miss = [];
  for (const { tokens } of lines)
    for (const sp of phraseSpans(engine, tokens)) {
      const res = engine.decode(simulate(sp.d, mode, r), KEYS, {
        prev: sp.i ? tokens[sp.i - 1] : null,
        pads: /twopad/.test(mode) ? PADS : undefined,
      });
      const rank = res.slice(0, 3).findIndex((c) => c.key === sp.k);
      n++;
      if (rank === 0) t1++;
      else miss.push(`${sp.d}>${res[0]?.word ?? "-"}`);
      if (rank >= 0) t3++;
    }
  return { n, top1: t1 / n, top3: t3 / n, miss };
}

const TAP_KEYS = Object.entries(geo.keys).filter(([c]) => c.length === 1 && /[a-z']/.test(c));
const KW = KEYS.q.w,
  KH = KEYS.q.h;

function tapChar(r, ch, sigma) {
  const k = geo.keys[ch];
  if (!k) return ch;
  const x = k.x + r.g() * sigma * KW,
    y = k.y + r.g() * sigma * KH;
  let best = ch,
    bd = Infinity;
  for (const [c, q] of TAP_KEYS) {
    const d = ((q.x - x) / KW) ** 2 + ((q.y - y) / KH) ** 2;
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

function noisyType(r, word, p) {
  let s = [...low(word)];
  if (s.includes("'") && r() < p.dropApo) s = s.filter((c) => c !== "'");
  s = s.map((c) => tapChar(r, c, p.sigma));
  if (s.length > 2 && r() < p.swap) {
    const i = Math.floor(r() * (s.length - 1));
    [s[i], s[i + 1]] = [s[i + 1], s[i]];
  }
  if (s.length > 3 && r() < p.omit) s.splice(1 + Math.floor(r() * (s.length - 1)), 1);
  if (r() < p.extra) {
    const i = Math.floor(r() * s.length);
    s.splice(i, 0, tapChar(r, s[i], 0.5));
  }
  const out = s.join("");
  return word[0] !== low(word[0]) && r() < 0.5 ? out[0].toUpperCase() + out.slice(1) : out;
}

const TAP = { sigma: 0.3, dropApo: 0.6, swap: 0.05, omit: 0.05, extra: 0.04 };

function tapTyping(engine, lines, seed) {
  const r = makeRng(seed);
  const st = {
    cleanN: 0,
    cleanFalse: 0,
    lazyN: 0,
    lazyFix: 0,
    lazyFalse: 0,
    noisyN: 0,
    noisyFix: 0,
    noisySug: 0,
    noisyWorse: 0,
    runN: 0,
    runFix: 0,
    runSug: 0,
    ms: [],
  };
  const falses = [],
    misses = [];
  const run = (typed, target, prev) => {
    const t0 = performance.now();
    const res = engine.correct(typed, { prev, keys: geo.keys, final: true });
    st.ms.push(performance.now() - t0);
    const after = res?.confident ? res.word : typed;
    return {
      res,
      ok: low(after) === low(target),
      sug: !!res && (low(res.word) === low(target) || res.alts?.some((a) => low(a) === low(target))),
      changed: !!res?.confident && low(res.word) !== low(typed),
    };
  };
  for (const { tokens } of lines) {
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i],
        prev = i ? tokens[i - 1] : null;
      const c = run(tok, tok, prev);
      st.cleanN++;
      if (c.changed) {
        st.cleanFalse++;
        falses.push(`${tok}>${c.res.word}`);
      }
      if (tok.includes("'")) {
        const lazy = low(tok).replace(/'/g, "");
        const l = run(lazy, tok, prev);
        st.lazyN++;
        if (l.ok) st.lazyFix++;
        else if (l.changed) st.lazyFalse++;
        else misses.push(`${lazy}~${tok}`);
      }
      const typed = noisyType(r, tok, TAP);
      if (low(typed).replace(/'/g, "") === low(tok).replace(/'/g, "")) continue;
      const n = run(typed, tok, prev);
      st.noisyN++;
      if (n.ok) st.noisyFix++;
      if (n.sug) st.noisySug++;
      if (n.changed && !n.ok) {
        st.noisyWorse++;
        falses.push(`!${typed}~${tok}>${n.res.word}`);
      }
      if (!n.ok && misses.length < 400) misses.push(`${typed}~${tok}${n.res ? ">" + n.res.word : ""}`);
    }
    for (const sp of phraseSpans(engine, tokens)) {
      const typed = low(sp.d).replace(/[' ]/g, "");
      const n = run(typed, sp.d, sp.i ? tokens[sp.i - 1] : null);
      st.runN++;
      if (n.ok) st.runFix++;
      if (n.sug) st.runSug++;
      if (!n.ok) misses.push(`${typed}~${sp.d}${n.res ? ">" + n.res.word : ""}`);
    }
    for (let i = 0; i + 1 < tokens.length; i++) {
      if (r() > 0.25 || phraseSpans(engine, tokens.slice(i, i + 2)).length) continue;
      const target = tokens[i] + " " + tokens[i + 1];
      const typed = low(target).replace(/[' ]/g, "");
      if (engine.known(typed)) continue;
      const n = run(typed, target, i ? tokens[i - 1] : null);
      st.runN++;
      if (n.ok) st.runFix++;
      if (n.sug) st.runSug++;
      if (!n.ok) misses.push(`${typed}~${target}${n.res ? ">" + n.res.word : ""}`);
    }
  }
  return { st, falses, misses };
}

function dictClean(engine, seed, n = 3000) {
  const r = makeRng(seed);
  const words = globalThis.__oskWords.text
    .split("\n")
    .map((l) => l.slice(0, l.lastIndexOf(" ")))
    .filter((w) => /^[A-Za-z']+$/.test(w) && w.length > 1);
  let changed = 0,
    auto = 0;
  const ex = [];
  for (let i = 0; i < n; i++) {
    const w = words[Math.floor(r() * words.length)];
    const res = engine.correct(w, { keys: geo.keys, final: true });
    if (res?.confident && low(res.word) !== low(w)) {
      auto++;
      if (ex.length < 20) ex.push(`${w}>${res.word}`);
    }
    if (res && low(res.word) !== low(w)) changed++;
  }
  let oovAuto = 0;
  const oex = [];
  for (const w of OOV) {
    const res = engine.correct(w, { keys: geo.keys, final: true });
    if (res?.confident && low(res.word) !== w) {
      oovAuto++;
      oex.push(`${w}>${res.word}`);
    }
  }
  return { n, auto: auto / n, sugg: changed / n, ex, oovN: OOV.length, oovAuto, oex };
}

function prediction(engine, lines) {
  let n = 0,
    h1 = 0,
    h3 = 0;
  const ms = [];
  for (const { tokens } of lines)
    for (let i = 1; i < tokens.length; i++) {
      const t0 = performance.now();
      const p = engine.predict(tokens[i - 1], 3);
      ms.push(performance.now() - t0);
      const rank = p.findIndex((c) => c.key === low(tokens[i]));
      n++;
      if (rank === 0) h1++;
      if (rank >= 0) h3++;
    }
  return { n, top1: h1 / n, top3: h3 / n, meanMs: ms.reduce((a, b) => a + b, 0) / ms.length };
}

export function benchSentences(
  engine,
  { seed = 4242, modes = SWIPE_MODES, parts = ["swipe", "phrase", "tap", "predict"], splits = SPLITS, dict = parts.includes("tap") } = {},
) {
  const all = corpus();
  const out = {};
  for (const split of splits) {
    const lines = all.filter((l) => l.split === split);
    const o = (out[split] = { lines: lines.length, words: lines.reduce((a, l) => a + l.tokens.length, 0) });
    if (parts.includes("swipe"))
      o.swipe = Object.fromEntries(modes.map((m) => [m, swipeWords(engine, lines, m, seed + 17 * Math.max(0, SWIPE_MODES.indexOf(m)))]));
    if (parts.includes("phrase"))
      o.phrase = Object.fromEntries(["onepad-ideal", "sloppy-twopad"].map((m, i) => [m, swipePhrases(engine, lines, m, seed + 101 + i)]));
    if (parts.includes("tap")) o.tap = tapTyping(engine, lines, seed + (split === "heldout" ? 999 : 0));
    if (parts.includes("predict")) o.predict = prediction(engine, lines);
  }
  if (dict) out.dict = dictClean(engine, seed);
  return out;
}

export function format(res) {
  const f = (x) => (100 * x).toFixed(1).padStart(5);
  const L = [];
  for (const split of SPLITS) {
    const o = res[split];
    L.push(`== ${split}: ${o.lines} lines, ${o.words} words`);
    if (o.swipe) {
      L.push("swipe words (ctx)    top1  top3   oov  mean ms");
      for (const [m, s] of Object.entries(o.swipe))
        L.push(`  ${m.padEnd(18)} ${f(s.top1)} ${f(s.top3)} ${String(s.oov).padStart(5)} ${s.meanMs.toFixed(2).padStart(7)}`);
    }
    if (o.phrase)
      for (const [m, s] of Object.entries(o.phrase)) L.push(`phrase swipe ${m.padEnd(14)} n=${s.n} top1 ${f(s.top1)} top3 ${f(s.top3)}`);
    if (o.tap) {
      const s = o.tap.st;
      L.push(
        `tap clean: n=${s.cleanN} false-auto ${f(s.cleanFalse / s.cleanN)}%   no-apostrophe: n=${s.lazyN} fixed ${f(s.lazyFix / s.lazyN)}% wrong ${f(s.lazyFalse / s.lazyN)}%`,
      );
      L.push(
        `tap noisy: n=${s.noisyN} auto-fixed ${f(s.noisyFix / s.noisyN)}% in-suggestions ${f(s.noisySug / s.noisyN)}% made-wrong ${f(s.noisyWorse / s.noisyN)}%`,
      );
      L.push(
        `run-together: n=${s.runN} auto-fixed ${f(s.runFix / s.runN)}% in-suggestions ${f(s.runSug / s.runN)}%   correct() mean ${(s.ms.reduce((a, b) => a + b, 0) / s.ms.length).toFixed(2)} ms max ${Math.max(...s.ms).toFixed(1)} ms`,
      );
    }
    if (o.predict)
      L.push(`next-word predict: n=${o.predict.n} top1 ${f(o.predict.top1)} top3 ${f(o.predict.top3)} (${o.predict.meanMs.toFixed(2)} ms)`);
  }
  if (res.dict)
    L.push(
      `dictionary words typed correctly: n=${res.dict.n} auto-changed ${(100 * res.dict.auto).toFixed(2)}% suggested ${(100 * res.dict.sugg).toFixed(2)}%; OOV names auto-changed ${res.dict.oovAuto}/${res.dict.oovN}`,
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
  const { engine, createMs } = await loadEngine(get("--engine") ?? "../src/engine.js", options);
  const t0 = performance.now();
  engine.warm?.();
  const warmMs = performance.now() - t0;
  const res = benchSentences(engine, { parts: get("--parts")?.split(",") ?? undefined, modes: get("--mode")?.split(",") ?? undefined });
  console.log(format(res));
  console.log(`engine create ${createMs.toFixed(1)} ms, warm ${warmMs.toFixed(1)} ms`);
  if (args.includes("--misses")) {
    for (const split of SPLITS) {
      const o = res[split];
      if (o.swipe) for (const [m, s] of Object.entries(o.swipe)) console.log(split, m, s.miss.slice(0, 60).join(" "));
      if (o.phrase) for (const [m, s] of Object.entries(o.phrase)) console.log(split, "phrase", m, s.miss.slice(0, 40).join(" "));
      if (o.tap) {
        console.log(split, "tap false:", o.tap.falses.join(" "));
        console.log(split, "tap misses:", o.tap.misses.slice(0, 120).join(" "));
      }
    }
    if (res.dict) console.log("dict auto:", res.dict.ex.join(" "), "| oov:", res.dict.oex.join(" "));
  }
}
