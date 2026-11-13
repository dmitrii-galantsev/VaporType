import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadEngine, KEYS } from "./bench.mjs";
import { readText } from "./bench-predict.mjs";
import { corpus } from "./bench-sentences.mjs";

const STALE_MS = 30000;
const NEW_WORD_USES = 2;
const LEARN_SWIPE_ZIPF = 3.5;
const WORD = /^[A-Za-z]+(?:'[A-Za-z]+)?$/;
const MAXK = 5;
const plain = (w) => w.toLowerCase().replace(/[' ]/g, "");

export function chips(engine, buf, ctx, { legacy = false } = {}) {
  const lower = buf.toLowerCase();
  const seen = new Set([lower]);
  const list = [];
  const add = (w) => {
    const k = w.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    list.push(k);
  };
  if (legacy && buf.length >= 2 && /^[A-Za-z']+$/.test(buf)) {
    const c = engine.correct(buf, ctx);
    if (c?.word) add(c.word);
  }
  for (const s of engine.suggest(buf, ctx, 8)) add(s.word);
  const p = plain(lower);
  const ext = list.slice(0, 3).filter((w) => plain(w) !== p && plain(w).startsWith(p)).length;
  return { list: list.slice(0, 3), shown: legacy || list.length < 3 || ext < 2 ? 2 : 3 };
}

export function readLog(files) {
  const seen = new Set();
  const out = [];
  for (const f of files)
    for (const line of fs.readFileSync(f, "utf8").split("\n")) {
      if (!line) continue;
      const r = JSON.parse(line);
      if (r.type === "word" ? !r.committed : r.type !== "geo" && r.type !== "line") continue;
      const id = r.type + " " + r.t + " " + (r.committed ?? "");
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(r);
    }
  return out.sort((a, b) => a.t - b.t);
}

const drill = (r) => r.kind === "tap" && Array.isArray(r.taps) && r.taps.length > 0 && r.taps.every((t) => t === null);

function blank() {
  return {
    words: 0,
    ctx: 0,
    first: 0,
    first3: 0,
    p1: 0,
    p3: 0,
    kn: new Array(MAXK + 1).fill(0),
    h1: new Array(MAXK + 1).fill(0),
    h2: new Array(MAXK + 1).fill(0),
    h3: new Array(MAXK + 1).fill(0),
    hs: new Array(MAXK + 1).fill(0),
    presses: 0,
    cost2: 0,
    cost3: 0,
    costs: 0,
    thirds: 0,
    phrase: 0,
    slots: 0,
    off: 0,
    split: 0,
    typoN: 0,
    typo1: 0,
    typo2: 0,
    typoMiss: [],
  };
}

export function replay(
  engine,
  recs,
  { keys = KEYS, since = 0, legacy = false, dump = null, context = 2, part = null, starts = true } = {},
) {
  const pending = {};
  const n = blank();
  const scored = recs.filter((r) => r.t >= since && r.committed);
  const mid = scored[scored.length >> 1]?.t ?? 0;
  const inPart = (t) => t >= since && (!part || (part === "first" ? t < mid : t >= mid));
  let prev = null,
    prev2 = null,
    fresh = true,
    offered = null,
    last = -Infinity;
  for (const r of recs) {
    if (r.type === "geo") {
      if (r.keys) keys = Object.fromEntries(Object.entries(r.keys).map(([k, [x, y, w, h]]) => [k, { x, y, w, h }]));
      continue;
    }
    if (r.type === "line") {
      prev = prev2 = null;
      fresh = true;
      continue;
    }
    if (r.outcome === "deleted" || drill(r)) continue;
    if (r.t - last > STALE_MS) {
      prev = prev2 = null;
      fresh = true;
    }
    last = r.t;
    const parts = r.committed.split(" ");
    const multi = parts.length > 1;
    const fromSwipe = r.kind === "swipe";
    for (const w of parts) {
      if (!WORD.test(w)) {
        prev = prev2 = null;
        fresh = false;
        continue;
      }
      const target = w.toLowerCase();
      if (!prev) offered = null;
      const ctx = { prev: context > 1 && prev && prev2 ? prev2 + " " + prev : prev, keys, start: starts && !prev && fresh };
      if (!multi && !fromSwipe && inPart(r.t)) {
        n.words++;
        const cost = w.length + 1;
        n.presses += cost;
        let got2 = cost,
          got3 = cost,
          gots = cost;
        if (prev || ctx.start) {
          if (prev) n.ctx++;
          else n.first++;
          const p = engine.predict(ctx.prev, 3, ctx.start).map((c) => c.key);
          if (!prev && p.includes(target)) n.first3++;
          if (p[0] === target) n.p1++;
          if (p.includes(target)) (n.p3++, (got2 = got3 = gots = 1));
        }
        const clean = r.typed === undefined || r.typed === r.committed || plain(r.committed).startsWith(plain(r.typed ?? ""));
        const taps = Array.isArray(r.taps) && r.taps.some(Boolean) && r.typed && w.startsWith(r.typed) ? r.taps : null;
        const row = dump ? { prev2, prev, w, typed: r.typed, steps: [] } : null;
        for (let k = 1; k < w.length; k++) {
          const pre = w.slice(0, k);
          const { list: ch, shown } = chips(engine, pre, taps && k <= taps.length ? { ...ctx, taps: taps.slice(0, k) } : ctx, { legacy });
          const at = ch.indexOf(target);
          if (k <= MAXK) {
            n.kn[k]++;
            if (at === 0) n.h1[k]++;
            if (at >= 0 && at < 2) n.h2[k]++;
            if (at >= 0) n.h3[k]++;
            if (at >= 0 && at < shown) n.hs[k]++;
          }
          if (at >= 0 && at < 2 && got2 === cost) got2 = k + 1;
          if (at >= 0 && got3 === cost) got3 = k + 1;
          if (at >= 0 && at < shown && gots === cost) gots = k + 1;
          if (clean) {
            const pp = plain(pre);
            if (shown === 3) n.thirds++;
            for (const c of ch.slice(0, shown)) {
              n.slots++;
              if (!plain(c).startsWith(pp)) n.off++;
              if (c.includes(" ") && !engine.info(c)?.phrase) n.split++;
            }
          }
          row?.steps.push(ch);
        }
        if (offered?.has(target)) {
          n.phrase++;
          gots = 0;
        }
        offered = null;
        {
          const end = chips(engine, w, taps ? { ...ctx, taps } : ctx, { legacy });
          const head = target + " ";
          const next = end.list.slice(0, end.shown).filter((c) => c.startsWith(head) && !c.slice(head.length).includes(" "));
          if (next.length) offered = new Set(next.map((c) => c.slice(head.length)));
        }
        n.cost2 += got2;
        n.cost3 += got3;
        n.costs += gots;
        if (r.outcome === "picked" && r.typed && !plain(r.committed).startsWith(plain(r.typed))) {
          n.typoN++;
          const { list: ch, shown } = chips(engine, r.typed, { ...ctx, taps: r.taps }, { legacy });
          const at = ch.indexOf(target);
          if (at === 0) n.typo1++;
          if (at >= 0 && at < shown) n.typo2++;
          else n.typoMiss.push(`${r.typed}>${target} [${ch.join(",")}]`);
        }
        if (row) dump.push(row);
      }
      let learn = true,
        allowNew = !multi && !fromSwipe && (r.how === "space" || r.how === "punct" || r.how === "swipe");
      if (fromSwipe && r.outcome !== "picked") {
        const inf = engine.info(w);
        if (inf && !(inf.c > 0) && (inf.z ?? 0) < LEARN_SWIPE_ZIPF) learn = false;
      }
      if (learn) {
        if (allowNew && !engine.known(target)) {
          pending[target] = (pending[target] ?? 0) + 1;
          allowNew = pending[target] >= NEW_WORD_USES;
          if (allowNew) delete pending[target];
        }
        engine.learn(w, ctx.prev, { allowNew, start: ctx.start });
      }
      prev2 = prev;
      prev = w;
      fresh = false;
    }
    if (r.how === "enter" || r.how === "stop") prev = prev2 = null;
    if (r.how === "enter") fresh = true;
  }
  return n;
}

export const ROW_CASES = [
  ["wa", null, "a"],
  ["ra", null, "a"],
  ["sp", null, "so"],
  ["spo", null, "so"],
  ["thei", "no", "the i"],
  ["assis", "my", "ass is"],
  ["inve", "is", "nice"],
  ["offi", null, "off i"],
  ["pi", "take", "i"],
  ["playin", "aint", ""],
  ["thinki", "was", ""],
  ["ther", null, ""],
  ["hou", null, ""],
];

export function rowCases(engine) {
  const out = ROW_CASES.map(([buf, prev, never]) => {
    const { list, shown } = chips(engine, buf, { prev, keys: KEYS });
    const row = list.slice(0, shown);
    const ok = !!row[0] && plain(row[0]).startsWith(buf) && plain(row[0]) !== buf && !row.includes(never);
    return { buf, prev, ok, shown: row.join("/") };
  });
  const two = engine.predict("lot of", 3).map((c) => c.key);
  const one = engine.predict("of", 3).map((c) => c.key);
  out.push({ buf: "lot of + next word", prev: null, ok: two.includes("people") && !one.includes("people"), shown: two.join("/") });
  return out;
}

export function benchChips(engine, split) {
  const recs = [];
  let t = 0;
  for (const line of corpus()) {
    if (line.split !== split) continue;
    t += STALE_MS * 2;
    for (const w of line.tokens) recs.push({ t: (t += 1000), committed: w, how: "space", kind: "tap", outcome: "kept" });
  }
  const empty = { version: 1, words: {}, bigrams: {} };
  engine.setUser(empty);
  const o = replay(engine, recs);
  engine.setUser(empty);
  return { row2: o.hs[2] / o.kn[2], saved: 1 - o.costs / o.presses, off: o.off / o.slots };
}

const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) : "-");
export function row(o) {
  const ks = (h) => [1, 2, 3, 4].map((k) => pct(h[k], o.kn[k])).join(" / ");
  return {
    words: o.words,
    "next top-1 / top-3": `${pct(o.p1, o.ctx)} / ${pct(o.p3, o.ctx)}`,
    "first word of a burst in top-3": `${pct(o.first3, o.first)} (n ${o.first})`,
    "first chip after 1 / 2 / 3 / 4 letters": ks(o.h1),
    "two chips": ks(o.h2),
    "three chips": ks(o.h3),
    "the row as shown": ks(o.hs),
    "presses saved: 2 chips / 3 / as shown": `${pct(o.presses - o.cost2, o.presses)} / ${pct(o.presses - o.cost3, o.presses)} / ${pct(o.presses - o.costs, o.presses)}`,
    "phrase chips that held the next word": o.phrase,
    "chips that do not extend a clean prefix": pct(o.off, o.slots),
    "made-up splits": pct(o.split, o.slots),
    "real typos offered first / in the row": `${o.typo1} / ${o.typo2} of ${o.typoN}`,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = (f) => {
    const i = args.indexOf(f);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const text = get("--text");
  const logs = (process.env.OSK_TYPING_LOG ?? "").split(/[:,]/).filter(Boolean);
  if (!text && !logs.length) {
    console.error(
      "usage: OSK_TYPING_LOG=<log.jsonl>[:<log.jsonl>...] [OSK_LOG_SINCE=2026-10-24] node bench-chips.mjs [--engine <engine.js>] [--opt k=v,...] [--legacy] [--context 1] [--dump <out.json>] [--misses]\n" +
        "       node bench-chips.mjs --text corpora/chat-corpus.txt [--passes 1]",
    );
    process.exit(2);
  }
  const options = Object.fromEntries(
    (get("--opt") ?? "")
      .split(",")
      .filter(Boolean)
      .map((kv) => {
        const [k, v] = kv.split("=");
        return [k, Number(v)];
      }),
  );
  const { engine } = await loadEngine(get("--engine") ?? "../src/engine.js", options);
  const recs = text ? readText(new URL(text, `file://${process.cwd()}/`).pathname, Number(get("--passes") ?? 1)) : readLog(logs);
  const since = !text && process.env.OSK_LOG_SINCE ? Date.parse(process.env.OSK_LOG_SINCE) : 0;
  const dump = get("--dump") ? [] : null;
  const t0 = performance.now();
  const r = replay(engine, recs, {
    since,
    legacy: args.includes("--legacy"),
    dump,
    context: Number(get("--context") ?? 2),
    part: get("--part") ?? null,
    starts: !args.includes("--no-start"),
  });
  if (args.includes("--json")) console.log(JSON.stringify(row(r)));
  else {
    for (const [k, v] of Object.entries(row(r))) console.log(`${k.padEnd(42)} ${v}`);
    if (args.includes("--misses")) for (const m of r.typoMiss) console.log("  typo not offered: " + m);
    console.log(`${((performance.now() - t0) / 1000).toFixed(1)} s`);
  }
  if (dump) fs.writeFileSync(get("--dump"), JSON.stringify(dump));
}
