import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadEngine } from "./bench.mjs";

const DATA = process.env.OSK_REAL_SWIPES
  ? pathToFileURL(path.resolve(process.env.OSK_REAL_SWIPES))
  : new URL("./real-swipes.json", import.meta.url);
const RETYPE_MS = 15000;
const RETYPE_KEYS = 1.6;

function importLog(path) {
  const src = JSON.parse(fs.readFileSync(path, "utf8"));
  const keys = Object.fromEntries(Object.entries(src.keys).filter(([c]) => c.length === 1 && c >= "a" && c <= "z"));
  const kw = keys.q.w,
    kh = keys.q.h;
  const width = 854;
  const log = src.log;
  const ends = (r) => [r.trace[0], r.trace[r.trace.length - 1]];
  const similar = (a, b) => {
    const [a0, a1] = ends(a),
      [b0, b1] = ends(b);
    const d = (p, q) => Math.hypot((p[0] - q[0]) / kw, (p[1] - q[1]) / kh);
    return d(a0, b0) <= RETYPE_KEYS && d(a1, b1) <= RETYPE_KEYS;
  };
  const resolved = log.map((r) => (r.outcome.startsWith("replaced:") ? r.outcome.slice(9) : r.outcome === "kept" ? r.top[0][0] : null));
  const label = log.map((r, i) => {
    if (r.outcome.startsWith("replaced:")) return { word: resolved[i], how: "replaced" };
    if (r.outcome === "kept") return { word: resolved[i], how: "kept" };
    for (let j = i + 1, at = r.at; j < log.length && log[j].at - at <= RETYPE_MS; at = log[j].at, j++) {
      if (!similar(r, log[j])) continue;
      if (resolved[j]) return { word: resolved[j], how: "retyped" };
    }
    return { word: null, how: "deleted" };
  });
  const swipes = log.map((r, i) => {
    const t0 = r.trace[0][2];
    const onePad = r.trace.some((p) => String(p[3])[0] === "R" && p[0] < width * 0.45);
    const prevOk = i > 0 && r.at - log[i - 1].at < 15000 && resolved[i - 1] && log[i - 1].outcome !== "deleted";
    return {
      label: label[i].word,
      how: label[i].how,
      decoded: r.top.map((c) => c[0]),
      prev: prevOk ? resolved[i - 1] : null,
      onePad,
      trace: r.trace.map(([x, y, t, s]) => [x, y, t - t0, s]),
    };
  });
  return {
    source: `window.__oskSwipeLog on the Steam Deck, patch v${src.version}, engine v${src.eng}, ${src.status}; read ${new Date().toISOString().slice(0, 10)}`,
    labels: `replaced: the user picked another suggestion; kept: not undone, weak label; retyped: deleted, then a swipe within ${RETYPE_MS / 1000} s starting and ending within ${RETYPE_KEYS} keys of it was kept or replaced; deleted: undone, intent unknown`,
    keyboard: { left: 0, width, padSpan: 0.55 },
    keys,
    swipes,
  };
}

export function benchReal(engine, data = JSON.parse(fs.readFileSync(DATA, "utf8"))) {
  const { keys, keyboard } = data;
  const L = keyboard.left,
    W = keyboard.width;
  const groups = {};
  const rows = [];
  for (const s of data.swipes) {
    const trace = s.trace.map(([x, y, t, sid]) => ({ x, y, t, s: sid }));
    const ctx = { prev: s.prev };
    if (trace.some((p) => p.s?.[0] === "L" || p.s?.[0] === "R"))
      ctx.pads = { L: [L, L + W * keyboard.padSpan], R: [s.onePad ? L : L + W - W * keyboard.padSpan, L + W] };
    const res = engine.decode(trace, keys, ctx);
    const words = res.slice(0, 5).map((c) => c.word);
    const g = (groups[s.how] ??= { n: 0, top1: 0, top3: 0, then1: 0, then3: 0 });
    g.n++;
    if (s.label) {
      const k = s.label.toLowerCase();
      const rank = res.slice(0, 3).findIndex((c) => c.key === k);
      if (rank === 0) g.top1++;
      if (rank >= 0) g.top3++;
      const r0 = s.decoded.slice(0, 3).findIndex((w) => w.toLowerCase() === k);
      if (r0 === 0) g.then1++;
      if (r0 >= 0) g.then3++;
    }
    rows.push({ how: s.how, label: s.label, then: s.decoded.slice(0, 3), now: words.slice(0, 3) });
  }
  return { groups, rows };
}

export function format(res) {
  const out = ["group      n   deck top1/top3   now top1/top3"];
  for (const [how, g] of Object.entries(res.groups)) {
    if (how === "deleted") {
      out.push(`${how.padEnd(9)} ${String(g.n).padStart(2)}   (intent unknown)`);
      continue;
    }
    out.push(`${how.padEnd(9)} ${String(g.n).padStart(2)}   ${g.then1}/${g.then3}             ${g.top1}/${g.top3}`);
  }
  return out.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const get = (k) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (get("--import")) {
    fs.writeFileSync(DATA, JSON.stringify(importLog(get("--import"))) + "\n");
    console.log(`wrote ${DATA.pathname}`);
  } else {
    const options = {};
    for (const kv of args.filter((a, i) => args[i - 1] === "--opt")) {
      const [k, v] = kv.split("=");
      options[k] = JSON.parse(v);
    }
    const { engine } = await loadEngine(get("--engine") ?? "../src/engine.js", options);
    const res = benchReal(engine);
    console.log(format(res));
    if (args.includes("--rows"))
      for (const r of res.rows)
        console.log(r.how.padEnd(9), String(r.label ?? "?").padEnd(10), r.then.join("/").padEnd(30), r.now.join("/"));
  }
}
