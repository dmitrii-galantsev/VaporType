import fs from "node:fs";
import { openTwoPad, raw, rest, swipePad, restAt, sent, firstSendAfter, lastUp, lastSample, pct, reset } from "./twopad.mjs";

const N = Number(process.env.N ?? 10);
const N3 = Number(process.env.N3 ?? Math.max(3, Math.ceil(N / 2)));
const CPU = Number(process.env.CPU ?? 1);
const ONLY = process.env.CASES ? process.env.CASES.split(",") : null;
const PROFILE = process.env.PROFILE;

const { browser, page, errors } = await openTwoPad();
const bootErrors = errors.length;
const cdp = await page.createCDPSession();
await cdp.send("Performance.enable");
if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });

const WORDS_R = ["you", "only", "join", "milk", "hum"];

const metric = async () => {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
};

async function traced(fn) {
  await page.tracing.start({ categories: (process.env.TRACE_CATS ?? "toplevel").split(",") });
  let r;
  try {
    r = await fn();
  } finally {
    const buf = await page.tracing.stop();
    r = { ...r, tasks: parseTrace(buf) };
  }
  return r;
}

function parseTrace(buf) {
  const ev = JSON.parse(Buffer.from(buf).toString("utf8")).traceEvents;
  const main = new Set(ev.filter((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain").map((e) => `${e.pid}:${e.tid}`));
  const tasks = ev.filter((e) => e.ph === "X" && /^(RunTask|ThreadControllerImpl::RunTask)$/.test(e.name) && main.has(`${e.pid}:${e.tid}`));
  const counts = {};
  for (const t of tasks) counts[`${t.pid}:${t.tid}`] = (counts[`${t.pid}:${t.tid}`] ?? 0) + 1;
  const tid = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const mine = tasks.filter((t) => `${t.pid}:${t.tid}` === tid).sort((a, b) => b.dur - a.dur);
  const inner = ev.filter((e) => e.ph === "X" && `${e.pid}:${e.tid}` === tid && e.name !== "RunTask");
  const what = (t) =>
    inner
      .filter((e) => e.ts >= t.ts && e.ts + e.dur <= t.ts + t.dur && e.dur > 1000)
      .sort((a, b) => b.dur - a.dur)
      .slice(0, 4)
      .map(
        (e) =>
          `${e.name}${e.args?.data?.type ? `:${e.args.data.type}` : ""}${e.args?.data?.functionName ? `:${e.args.data.functionName}` : ""}${e.args?.data?.url ? `@${e.args.data.url.split("/").pop().slice(0, 24)}:${e.args.data.lineNumber}` : ""} ${(e.dur / 1000).toFixed(1)}`,
      )
      .join(", ");
  return {
    max: (mine[0]?.dur ?? 0) / 1000,
    over16: mine.filter((t) => t.dur > 16000).length,
    top: mine.slice(0, 3).map((t) => `${(t.dur / 1000).toFixed(1)} ms [${what(t)}]`),
  };
}

async function run(plan) {
  const m0 = await metric();
  const out = await page.evaluate((plan) => window.__tp.drive(plan), plan);
  const m1 = await metric();
  out.cpu = (m1.TaskDuration - m0.TaskDuration) * 1000;
  out.script = (m1.ScriptDuration - m0.ScriptDuration) * 1000;
  out.layout = (m1.LayoutDuration - m0.LayoutDuration + m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000;
  out.layouts = m1.LayoutCount - m0.LayoutCount;
  await reset(page);
  return out;
}

async function swipeCase({ otherRest, segMs = 64, runs = N, restAfter = false, words = WORDS_R }) {
  const res = [];
  for (let i = 0; i < runs; i++) {
    const w = words[i % words.length];
    const R = await swipePad(page, w, "R", { segMs, restAfter });
    const pads = { R };
    if (otherRest) pads.L = restAt(await rest(page, "s", "L"));
    const end = R.release + (restAfter ? 300 : 40);
    const out = await run({ pads, end, seed: i + 1 });
    const up = lastUp(out, "R");
    const lift = restAfter ? up : Math.max(up, lastSample(out, "R"));
    res.push({
      ...out,
      end,
      expect: [w],
      got: sent(out).trim().split(/\s+/),
      rel: firstSendAfter(out, up),
      lift: up + firstSendAfter(out, up) - lift,
    });
  }
  return res;
}

async function bothCase({ runs = N3, segL = 750, segR = 1000, offset = 150 }) {
  const res = [];
  for (let i = 0; i < runs; i++) {
    const wl = ["great", "start", "fast"][i % 3],
      wr = ["only", "join", "milk"][i % 3];
    const L = await swipePad(page, wl, "L", { segMs: (segL * 4) / (wl.length - 1) });
    const R = await swipePad(page, wr, "R", { segMs: (segR * 3) / (wr.length - 1), start: 40 + offset });
    const end = Math.max(L.release, R.release) + 40;
    const out = await run({ pads: { L, R }, end, seed: i + 1 });
    const up = lastUp(out);
    const lift = Math.max(up, lastSample(out, "L"), lastSample(out, "R"));
    res.push({
      ...out,
      end,
      expect: [wl, wr],
      got: sent(out).trim().split(/\s+/),
      rel: firstSendAfter(out, up),
      lift: up + firstSendAfter(out, up) - lift,
    });
  }
  return res;
}

async function tapCase({ rate, runs = Math.max(2, Math.ceil(N / 3)), hold = 40, taps = 16 }) {
  const res = [];
  const gap = 1000 / rate;
  for (let i = 0; i < runs; i++) {
    const seq = [];
    for (let j = 0; j < taps; j++) {
      const side = j % 2 ? "R" : "L";
      const pool = side === "L" ? "asdfwer" : "jklouin";
      seq.push([side, pool[(j * 3 + i) % pool.length]]);
    }
    const restL = await rest(page, "d", "L"),
      restR = await rest(page, "k", "R");
    const pads = { L: { path: [[0, ...restL]], touch: [0, 1e9], presses: [] }, R: { path: [[0, ...restR]], touch: [0, 1e9], presses: [] } };
    const tapsAt = [];
    for (let j = 0; j < seq.length; j++) {
      const [side, k] = seq[j];
      const t = 120 + j * gap;
      const [x, y] = (await raw(page, k, side))[0];
      const p = pads[side];
      const prev = p.path[p.path.length - 1];
      p.path.push([Math.max(prev[0], t - 40), prev[1], prev[2]], [t - 12, x, y], [t + hold, x, y]);
      p.presses.push([t, t + hold]);
      tapsAt.push(t + hold);
    }
    const end = tapsAt[tapsAt.length - 1] + 60;
    const out = await run({ pads, end, seed: i + 1 });
    const text = sent(out).trim();
    const letters = out.sends.filter(([, x]) => x !== " ");
    const per = out.ups.map(([t], j) => (letters[j] ? letters[j][0] - t : NaN));
    res.push({ ...out, end, expect: [seq.map((x) => x[1]).join("")], got: [text], rel: per, lift: per });
  }
  return res;
}

async function restTypeCase({ runs = N }) {
  const res = [];
  for (let i = 0; i < runs; i++) {
    const w = WORDS_R[i % WORDS_R.length];
    const restL = await rest(page, "s", "L");
    const R = await swipePad(page, w, "R", { restAfter: true, start: 40 });
    const end = R.release + 300;
    const out = await run({ pads: { L: restAt(restL), R }, end, seed: i + 1 });
    const up = lastUp(out, "R");
    res.push({ ...out, end, expect: [w], got: sent(out).trim().split(/\s+/), rel: firstSendAfter(out, up), lift: firstSendAfter(out, up) });
  }
  return res;
}

const CASES = [
  ["1", "one pad swipe", () => swipeCase({})],
  ["2", "one pad swipe, other thumb touching", () => swipeCase({ otherRest: true })],
  ["1b", "one pad 3 s swipe (CPU reference)", () => swipeCase({ segMs: 1000, runs: N3, words: ["only", "join", "you"] })],
  ["3", "both pads swiping 3 s, two words", () => bothCase({})],
  ["4a", "alternating two-thumb taps 8/s", () => tapCase({ rate: 8 })],
  ["4b", "alternating two-thumb taps 12/s", () => tapCase({ rate: 12, hold: 35 })],
  ["5", "both pads resting, swipe on one", () => restTypeCase({})],
];

const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "-");
const summary = [];
for (const [id, name, fn] of CASES) {
  if (ONLY && !ONLY.includes(id)) continue;
  if (PROFILE === id) {
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
    await cdp.send("Profiler.start");
  }
  const r = await traced(async () => ({ runs: await fn() }));
  if (PROFILE === id) {
    const { profile } = await cdp.send("Profiler.stop");
    const self = {};
    const dt = profile.timeDeltas;
    const byId = Object.fromEntries(profile.nodes.map((n) => [n.id, n]));
    profile.samples.forEach((s, i) => {
      const n = byId[s].callFrame;
      const k = `${n.functionName || "(anon)"} ${n.url.split("/").pop()}:${n.lineNumber + 1}`;
      self[k] = (self[k] ?? 0) + (dt[i] ?? 0) / 1000;
    });
    const top = Object.entries(self)
      .filter(([k]) => !/^\((idle|program|garbage collector)\)/.test(k))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25);
    console.log(`profile case ${id} self ms:\n${top.map(([k, v]) => `  ${v.toFixed(1).padStart(8)}  ${k}`).join("\n")}`);
    const incl = {};
    const selfOf = {};
    profile.samples.forEach((s, i) => (selfOf[s] = (selfOf[s] ?? 0) + (dt[i] ?? 0) / 1000));
    const walk = (n, seen) => {
      let t = selfOf[n.id] ?? 0;
      const name = n.callFrame.functionName;
      const inner = new Set(seen);
      inner.add(name);
      for (const c of n.children ?? []) t += walk(byId[c], inner);
      if (name && !seen.has(name)) incl[name] = (incl[name] ?? 0) + t;
      return t;
    };
    walk(profile.nodes[0], new Set());
    const want = (
      process.env.INCL ??
      "finishGesture,commitSwipe,refreshSuggestions,setSuggestions,decode,sendText,logSwipe,drawTrail,paintTrail,onPadSample,addPoint,schedulePreview,commitTaps,renderEcho,paint,mapPad,padTarget"
    ).split(",");
    console.log(`inclusive ms: ${want.map((k) => `${k} ${(incl[k] ?? 0).toFixed(1)}`).join(", ")}`);
    const parent = {};
    for (const n of profile.nodes) for (const c of n.children ?? []) parent[c] = n;
    const native = {};
    profile.samples.forEach((s, i) => {
      const n = byId[s];
      if (!/^(getBoundingClientRect|elementsFromPoint)$/.test(n.callFrame.functionName)) return;
      const chain = [];
      for (let p = parent[s]; p && chain.length < 3; p = parent[p.id]) chain.push(p.callFrame.functionName || "(anon)");
      const k = `${n.callFrame.functionName} <- ${chain.join(" <- ")}`;
      native[k] = (native[k] ?? 0) + (dt[i] ?? 0) / 1000;
    });
    console.log(
      Object.entries(native)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([k, v]) => `  ${v.toFixed(1).padStart(8)}  ${k}`)
        .join("\n"),
    );
  }
  const runs = r.runs;
  const samples = runs.flatMap((x) => x.samples.map((s) => s[2]));
  const two = runs.flatMap((x) => x.samples.filter((s) => s[3] >= 2).map((s) => s[2]));
  const frames = runs.flatMap((x) => x.frames.filter(([t]) => t <= x.end).map(([, d]) => d));
  const rel = runs.flatMap((x) => [x.rel].flat());
  const lift = runs.flatMap((x) => [x.lift].flat());
  const padTask = Math.max(
    ...runs.flatMap((x) => [
      ...x.samples.map((v) => v[2]),
      ...x.ups.map((v) => v[2]),
      ...x.downs.map((v) => v[2]),
      ...x.callbacks.map((v) => v[1]),
    ]),
  );
  const ok = runs.filter((x) => x.got.join(" ") === x.expect.join(" ")).length;
  const row = {
    id,
    name,
    runs: runs.length,
    sampleP50: pct(samples, 0.5),
    sampleP95: pct(samples, 0.95),
    sampleMax: pct(samples, 1),
    twoP95: two.length ? pct(two, 0.95) : NaN,
    maxTask: r.tasks.max,
    padTask,
    padTop: runs
      .flatMap((x) =>
        x.callbacks.map(([t, d, k]) => [k, Math.round(d * 10) / 10, Math.round(t - (x.ups.length ? x.ups[x.ups.length - 1][0] : 0))]),
      )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4),
    over16: r.tasks.over16,
    frameP95: pct(frames, 0.95),
    relP50: pct(rel, 0.5),
    relP95: pct(rel, 0.95),
    liftP50: pct(lift, 0.5),
    liftP95: pct(lift, 0.95),
    cpu: pct(
      runs.map((x) => x.cpu),
      0.5,
    ),
    script: pct(
      runs.map((x) => x.script),
      0.5,
    ),
    layout: pct(
      runs.map((x) => x.layout),
      0.5,
    ),
    mutations: pct(
      runs.map((x) => x.mutations),
      0.5,
    ),
    layouts: pct(
      runs.map((x) => x.layouts),
      0.5,
    ),
    correct: `${ok}/${runs.length}`,
    wrong: runs
      .filter((x) => x.got.join(" ") !== x.expect.join(" "))
      .slice(0, 3)
      .map((x) => `${x.expect.join(" ")} -> ${x.got.join(" ")}`),
    top: r.tasks.top,
  };
  summary.push(row);
  console.log(JSON.stringify(row));
}
console.log(`\npatch ${process.env.PATCH ?? "patch.js"}  CPU x${CPU}  N=${N}`);
console.log(
  "| case | sample p50/p95 ms | 2-pad sample p95 | longest pad task ms (any task) | frame p95 ms | release->send p50/p95 | last lift->send p50/p95 | CPU ms/gesture | style+layout ms (count) | DOM mutations | words |",
);
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of summary)
  console.log(
    `| ${r.id} ${r.name} | ${f1(r.sampleP50)} / ${f1(r.sampleP95)} | ${f1(r.twoP95)} | ${f1(r.padTask)} (${f1(r.maxTask)}) | ${f1(r.frameP95)} | ${f1(r.relP50)} / ${f1(r.relP95)} | ${f1(r.liftP50)} / ${f1(r.liftP95)} | ${f1(r.cpu)} | ${f1(r.layout)} (${r.layouts}) | ${r.mutations} | ${r.correct} |`,
  );
const newErrors = errors.slice(bootErrors);
console.log(`errors: ${newErrors.length ? newErrors.slice(0, 5).join(" | ") : "none"}`);
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(summary, null, 1));
await browser.close();
