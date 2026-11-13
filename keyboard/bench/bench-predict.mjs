import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadEngine, KEYS } from "./bench.mjs";

const STALE_MS = 30000;
const NEW_WORD_USES = 2;
const LEARN_SWIPE_ZIPF = 3.5;
const WORD = /^[A-Za-z]+(?:'[A-Za-z]+)?$/;

export function readLogs(files) {
  const seen = new Set();
  const out = [];
  for (const f of files)
    for (const line of fs.readFileSync(f, "utf8").split("\n")) {
      if (!line) continue;
      const r = JSON.parse(line);
      if (r.type === "line") {
        const lid = r.t + " line";
        if (seen.has(lid)) continue;
        seen.add(lid);
        out.push(r);
        continue;
      }
      if (r.type !== "word" || !r.committed) continue;
      const id = r.t + " " + r.committed;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(r);
    }
  return out.sort((a, b) => a.t - b.t);
}

export function readText(file, passes = 2) {
  const lines = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const out = [];
  let t = 0;
  for (let p = 0; p < passes; p++)
    for (const line of lines) {
      t += STALE_MS * 2;
      for (const w of line.split(/\s+/)) {
        const m = w.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, "");
        if (m) out.push({ t: (t += 1000), committed: m, how: "space", kind: "tap", outcome: "kept" });
      }
    }
  return out;
}

function chips(engine, buf, ctx) {
  const seen = new Set([buf.toLowerCase()]);
  const list = [];
  if (buf.length >= 2) {
    const c = engine.correct(buf, ctx);
    if (c?.word && !seen.has(c.word.toLowerCase())) {
      list.push(c.word.toLowerCase());
      seen.add(c.word.toLowerCase());
    }
  }
  for (const s of engine.suggest(buf, ctx, 6)) {
    const k = s.word.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    list.push(k);
  }
  return list.slice(0, 2);
}

export function replay(engine, recs, { keys = KEYS, since = 0 } = {}) {
  const pending = {};
  const n = { words: 0, ctx: 0, p1: 0, p3: 0, c1n: 0, c1: 0, c2n: 0, c2: 0, presses: 0, cost: 0, rep: 0, r3: 0, rc1: 0, rc1n: 0 };
  const pairs = new Set();
  const half = { ...n };
  const scored = recs.filter((r) => r.t >= since && r.type !== "line");
  const nh = recs.indexOf(scored[scored.length >> 1]);
  let prev = null,
    last = -Infinity;
  recs.forEach((r, ri) => {
    if (r.type === "line") {
      prev = null;
      return;
    }
    if (r.outcome === "deleted") return;
    if (r.t - last > STALE_MS) prev = null;
    last = r.t;
    const parts = r.committed.split(" ");
    const multi = parts.length > 1;
    const fromSwipe = r.kind === "swipe";
    for (const w of parts) {
      if (!WORD.test(w)) {
        prev = null;
        continue;
      }
      const target = w.toLowerCase();
      const ctx = { prev, keys };
      const rep = !!prev && pairs.has(prev.toLowerCase() + " " + target);
      const tally = (o) => {
        o.words++;
        if (rep) o.rep++;
        const cost = w.length + 1;
        o.presses += cost;
        let got = cost;
        if (prev) {
          o.ctx++;
          const p = engine.predict(prev, 3).map((c) => c.key);
          if (p[0] === target) o.p1++;
          if (p.includes(target)) (o.p3++, (o.r3 += rep), (got = 1));
        }
        for (let k = 1; k < w.length; k++) {
          const hit = chips(engine, w.slice(0, k), ctx).includes(target);
          if (k === 1) (o.c1n++, (o.c1 += hit), (o.rc1n += rep), (o.rc1 += rep && hit));
          if (k === 2) (o.c2n++, (o.c2 += hit));
          if (hit && got === cost) got = Math.min(got, k + 1);
          if (k >= 2 && got < cost) break;
        }
        o.cost += got;
      };
      if (!multi && !fromSwipe && r.t >= since) {
        tally(n);
        if (ri >= nh) tally(half);
      }
      let learn = true,
        allowNew = !multi && !fromSwipe && ["space", "punct", "swipe", "stop", "enter"].includes(r.how);
      if (r.lone) learn = false;
      if (learn && fromSwipe && r.outcome !== "picked") {
        const inf = engine.info(w);
        if (inf && !(inf.c > 0) && (inf.z ?? 0) < LEARN_SWIPE_ZIPF) learn = false;
      }
      if (learn) {
        if (allowNew && !engine.known(target)) {
          pending[target] = (pending[target] ?? 0) + 1;
          allowNew = pending[target] >= NEW_WORD_USES;
          if (allowNew) delete pending[target];
        }
        engine.learn(w, prev, { allowNew });
      }
      if (prev) pairs.add(prev.toLowerCase() + " " + target);
      prev = w;
    }
    if (r.how === "enter" || r.how === "stop") prev = null;
  });
  return { all: n, late: half };
}

const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) : "-");
export function row(o) {
  return {
    words: o.words,
    "next top-1": pct(o.p1, o.ctx),
    "next top-3": pct(o.p3, o.ctx),
    "1 letter": pct(o.c1, o.c1n),
    "2 letters": pct(o.c2, o.c2n),
    "repeated pairs": o.rep,
    "repeat top-3": pct(o.r3, o.rep),
    "repeat 1 letter": pct(o.rc1, o.rc1n),
    "presses saved": pct(o.presses - o.cost, o.presses),
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
      "usage: OSK_TYPING_LOG=<log.jsonl>[:<log.jsonl>...] [OSK_LOG_SINCE=2026-10-24] node bench-predict.mjs [--engine <engine.js>] [--opt k=v,...]\n" +
        "       node bench-predict.mjs --text corpora/chat-corpus.txt [--passes 2]",
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
  const recs = text ? readText(new URL(text, `file://${process.cwd()}/`).pathname, Number(get("--passes") ?? 2)) : readLogs(logs);
  const t0 = performance.now();
  const since = !text && process.env.OSK_LOG_SINCE ? Date.parse(process.env.OSK_LOG_SINCE) : 0;
  const r = replay(engine, recs, { since });
  console.table({ all: row(r.all), "second half": row(r.late) });
  console.log(`${((performance.now() - t0) / 1000).toFixed(1)} s`);
}
