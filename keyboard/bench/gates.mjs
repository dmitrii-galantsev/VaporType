import os from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { loadEngine, runMode, testSet, SEEDS } from "./bench.mjs";
import { benchSentences } from "./bench-sentences.mjs";
import { benchTypos, benchTaps, prefixCases } from "./bench-typos.mjs";

export const FLOORS = {
  selfCheck: 0.98,
  oovNames: 1,
  swipe: {
    tune: { "onepad-ideal": 0.917, "twopad-overlap": 0.945, "sloppy-onepad": 0.829, "sloppy-twopad": 0.792 },
    heldout: { "onepad-ideal": 0.93, "twopad-overlap": 0.962, "sloppy-onepad": 0.811, "sloppy-twopad": 0.761 },
  },
  typos: {
    tune: { top1: 0.9, top3: 0.971, fix: 0.8, midTop3: 0.817 },
    heldout: { top1: 0.909, top3: 0.971, fix: 0.81, midTop3: 0.751 },
  },
};

const SPLITS = ["tune", "heldout"];

export function tasks(fast) {
  const modes = fast ? ["sloppy-onepad", "sloppy-twopad"] : Object.keys(FLOORS.swipe.tune);
  const t = [{ kind: "self" }, { kind: "dict" }, { kind: "prefix" }];
  for (const split of SPLITS) {
    for (const mode of modes) t.push({ kind: "swipe", split, mode });
    t.push({ kind: "tap", split }, { kind: "typos", split });
    if (!fast) for (const map of ["big", "standard"]) for (const sigma of [1.5, 2.5]) t.push({ kind: "taps", split, map, sigma });
  }
  return t;
}

export function runTask(engine, t) {
  switch (t.kind) {
    case "self": {
      const r = runMode(engine, testSet(SEEDS.tune), "perfect", SEEDS.tune);
      return { seq1: r.seq1 };
    }
    case "dict":
      return benchSentences(engine, { parts: [], splits: [], dict: true }).dict;
    case "prefix":
      return prefixCases(engine);
    case "swipe":
      return {
        top1: benchSentences(engine, { parts: ["swipe"], modes: [t.mode], splits: [t.split], dict: false })[t.split].swipe[t.mode].top1,
      };
    case "tap": {
      const o = benchSentences(engine, { parts: ["tap"], splits: [t.split], dict: false })[t.split].tap;
      return { st: o.st, falses: o.falses.filter((f) => !f.startsWith("!")) };
    }
    case "typos":
      return benchTypos(engine, { splits: [t.split], extras: false })[t.split].st;
    case "taps":
      return benchTaps(engine, { split: t.split, maps: [t.map], sigmas: [t.sigma] }).reduce((a, r) => a + r.with.cleanFalse, 0);
  }
}

export function checkResults(res, fast) {
  const fails = [];
  const notes = [];
  const pct = (x) => (100 * x).toFixed(1);
  const check = (ok, what) => {
    (ok ? notes : fails).push(what);
  };
  const get = (kind, f = () => true) => res.filter((x) => x.t.kind === kind && f(x.t));
  check(
    get("self")[0].r.seq1 >= FLOORS.selfCheck,
    `bench.mjs self-check seq-top1 ${pct(get("self")[0].r.seq1)}% >= ${pct(FLOORS.selfCheck)}%`,
  );
  for (const split of SPLITS) {
    const { st, falses } = get("tap", (t) => t.split === split)[0].r;
    check(
      st.cleanFalse === 0,
      `${split} clean words auto-changed ${st.cleanFalse}/${st.cleanN} == 0${st.cleanFalse ? ": " + falses.join(" ") : ""}`,
    );
    for (const { t, r } of get("swipe", (t) => t.split === split)) {
      const floor = FLOORS.swipe[split][t.mode];
      check(r.top1 >= floor - 1e-9, `${split} sentence swipe ${t.mode} top1 ${pct(r.top1)} >= ${pct(floor)}`);
    }
  }
  const d = get("dict")[0].r;
  const auto = Math.round(d.auto * d.n);
  check(auto === 0, `dictionary words auto-changed ${auto}/${d.n} == 0${auto ? ": " + d.ex.join(" ") : ""}`);
  check(
    d.oovAuto <= FLOORS.oovNames,
    `game/app names auto-changed ${d.oovAuto}/${d.oovN} <= ${FLOORS.oovNames}${d.oovAuto ? ": " + d.oex.join(" ") : ""}`,
  );
  for (const split of SPLITS) {
    const s = get("typos", (t) => t.split === split)[0].r;
    check(s.cleanFalse === 0, `${split} typo bench clean words auto-changed ${s.cleanFalse} == 0`);
    check(s.cleanTop1 === s.cleanN, `${split} typo bench clean words shown first ${s.cleanTop1}/${s.cleanN}`);
    const vals = { top1: s.top1 / s.n, top3: s.top3 / s.n, fix: s.fix / s.n, midTop3: s.preTop3 / s.pre };
    for (const [k, v] of Object.entries(vals))
      check(v >= FLOORS.typos[split][k] - 1e-9, `${split} typo bench ${k} ${pct(v)} >= ${pct(FLOORS.typos[split][k])}`);
  }
  const pf = get("prefix")[0].r;
  const bad = pf.filter((x) => !x.ok);
  check(
    !bad.length,
    `prefix cases (mid-word lookalikes) ${pf.length - bad.length}/${pf.length}${bad.map((x) => ` ${x.buf}: ${x.shown} corr ${x.corr}`).join("")}`,
  );
  if (!fast)
    for (const split of SPLITS) {
      const n = get("taps", (t) => t.split === split).reduce((a, x) => a + x.r, 0);
      check(n === 0, `${split} tap-position bench clean words auto-changed ${n} == 0`);
    }
  return { fails, notes };
}

export async function runGates({
  engine: enginePath = "../src/engine.js",
  fast = false,
  jobs = Math.max(1, Math.min(os.availableParallelism?.() ?? os.cpus().length, 16) - 1),
} = {}) {
  const list = tasks(fast);
  const res = new Array(list.length);
  const n = Math.min(jobs, list.length);
  let next = 0,
    version = null;
  await Promise.all(
    Array.from(
      { length: n },
      () =>
        new Promise((resolve, reject) => {
          const w = new Worker(fileURLToPath(import.meta.url), { workerData: { enginePath } });
          const feed = () => {
            if (next < list.length) {
              const i = next++;
              w.postMessage({ i, t: list[i] });
            } else {
              w.terminate();
              resolve();
            }
          };
          w.on("message", (m) => {
            if (m.ready) {
              version = m.version;
              return feed();
            }
            res[m.i] = { t: list[m.i], r: m.r };
            feed();
          });
          w.on("error", reject);
        }),
    ),
  );
  return { ...checkResults(res, fast), version };
}

if (!isMainThread) {
  const { engine } = await loadEngine(workerData.enginePath);
  engine.warm?.();
  parentPort.on("message", ({ i, t }) => parentPort.postMessage({ i, r: runTask(engine, t) }));
  parentPort.postMessage({ ready: true, version: engine.version });
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const t0 = performance.now();
  const { fails, notes, version } = await runGates({
    engine: arg("--engine") ?? "../src/engine.js",
    fast: args.includes("--fast"),
    ...(arg("--jobs") ? { jobs: Number(arg("--jobs")) } : {}),
  });
  if (args.includes("--verbose")) for (const n of notes) console.log("ok   " + n);
  for (const f of fails) console.log("FAIL " + f);
  console.log(
    `${fails.length ? "GATES FAILED" : "all gates passed"}: ${notes.length} ok, ${fails.length} failed, engine v${version}, ${((performance.now() - t0) / 1000).toFixed(0)} s`,
  );
  process.exitCode = fails.length ? 1 : 0;
}
