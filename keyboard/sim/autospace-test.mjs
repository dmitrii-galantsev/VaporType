import { openSim, inject, settle } from "./run.mjs";
import { readRuntime as read } from "../runtime.mjs";
import { pageHelpers, sleep } from "./helpers.mjs";

const { browser, page, errors } = await openSim();
let failures = 0;
const results = [];
const BTN = { L: 20, R: 22 };

await page.evaluate(["swipe/words.js", "swipe/lm.js", "swipe/engine.js", "modes.js"].map(read).join("\n;\n"));
await page.evaluate(() => {
  window.__oskUserWords = null;
  window.localStorage.clear();
});
results.push(`inject: ${await inject(page, read("patch.js"))}`);

const { kbEval, center, vgp, padAt, padIdle, labels, setSetting } = pageHelpers(page);

async function padStroke(side, letters) {
  const pts = [];
  for (const ch of letters) pts.push(await center(ch));
  await padAt(side, pts[0].x, pts[0].y);
  await vgp("vgp_onbuttondown", BTN[side]);
  for (let i = 1; i < pts.length; i++) {
    for (let s = 1; s <= 6; s++) {
      await padAt(side, pts[i - 1].x + (pts[i].x - pts[i - 1].x) * (s / 6), pts[i - 1].y + (pts[i].y - pts[i - 1].y) * (s / 6));
      await sleep(8);
    }
  }
  await vgp("vgp_onbuttonup", BTN[side]);
  await padIdle(side);
  await settle(page);
}

const key = async (k) => {
  await kbEval((kb, k) => kb.TypeKeyInternal({ strKey: k }), k);
  await settle(page);
};
const word = async (w) => {
  for (const c of w) await key(c);
};
const setMode = (id) => page.evaluate((id) => window.__oskTrackpadFix.setMode(id), id);
const tracker = () =>
  page.evaluate(() => {
    const F = window.__oskTrackpadFix;
    return { buf: F.tracker.buf, prev: F.tracker.prev, pending: Object.keys(F.pending ?? {}) };
  });

const GLYPH = { "\u0001": "⏎", "\u0002": "⌫", "\u0003": "←", "\u0004": "→" };
const view = (log) =>
  log
    .filter(([, k]) => k === "text")
    .map(([, , v]) => GLYPH[v] ?? v)
    .join("");
const applied = (raw) => {
  let s = "";
  for (const c of raw) s = c === "⌫" ? s.slice(0, -1) : c === "⏎" ? s + "\n" : /[←→]/.test(c) ? s : s + c;
  return s;
};

async function pick(re) {
  const l = await labels();
  const i = l.findIndex((x) => x && re.test(x));
  if (i < 0) throw new Error(`no suggestion ${re} in ${JSON.stringify(l)}`);
  await key(`OSKSug_${i}`);
  return l[i];
}

async function fresh(mode) {
  await setMode(mode);
  await kbEval((kb) => kb.setState({ layoutState: 0 }));
  await page.evaluate(() => {
    const T = window.__oskTrackpadFix.tracker;
    Object.assign(T, { buf: "", taps: [], prev: null, fromSwipe: null, auto: false, lastOut: "unknown", autocorr: null });
  });
  await key(" ");
  await page.evaluate(() => {
    window.__keyLog.length = 0;
  });
}

async function scenario(title, fn, expect) {
  const e0 = errors.length;
  let got = "";
  let extra;
  let failed = false;
  try {
    await fresh(fn.mode ?? "standard");
    extra = (await fn()) ?? "";
    await settle(page);
    got = view(await page.evaluate(() => window.__keyLog.slice()));
  } catch (e) {
    extra = `threw ${e.message}`;
    failed = true;
  }
  const want = failed ? { raw: null, text: null } : typeof expect === "function" ? expect(extra) : expect;
  const newErr = errors.filter((e, i) => i >= e0 && !/404|Failed to load|Transport|passive event listener|cancel a touchend/.test(e));
  const ok = got === want.raw && applied(got) === want.text && !newErr.length;
  if (!ok) failures++;
  results.push(
    `${ok ? "PASS" : "FAIL"} ${title}\n      sent ${JSON.stringify(got)} text ${JSON.stringify(applied(got))}${ok ? "" : `\n      want ${JSON.stringify(want.raw)} text ${JSON.stringify(want.text)}`}${extra !== undefined ? ` ${JSON.stringify(extra)}` : ""}${newErr.length ? `\n      errors ${newErr.join(" | ")}` : ""}`,
  );
}

const std = (fn) => Object.assign(fn, { mode: "standard" });
const completed = async () => {
  await word("hel");
  return pick(/^hel[a-z]+$/);
};
const done = (w) => `hel⌫⌫⌫${w} `;
const swipe = async (side, w) => {
  await padStroke(side, w);
  return (await tracker()).buf;
};
const shifted = async (k) => {
  await key("Shift");
  await key(k);
};

await scenario(
  "suggestion pick then period removes the auto space: word.",
  std(async () => {
    const w = await completed();
    await key(".");
    return w;
  }),
  (w) => ({ raw: `${done(w)}⌫.`, text: `${w}.` }),
);

await scenario(
  "pick, period, then a swiped word gets its space: word. the",
  std(async () => {
    const w = await completed();
    await key(".");
    return [w, await swipe("L", "the")];
  }),
  ([w, s]) => ({ raw: `${done(w)}⌫. ${s}`, text: `${w}. ${s}` }),
);

await scenario(
  "pick then comma: word,",
  std(async () => {
    const w = await completed();
    await key(",");
    return w;
  }),
  (w) => ({ raw: `${done(w)}⌫,`, text: `${w},` }),
);

await scenario(
  "pick, comma, swiped word: word, job",
  std(async () => {
    const w = await completed();
    await key(",");
    return [w, await swipe("R", "job")];
  }),
  ([w, s]) => ({ raw: `${done(w)}⌫, ${s}`, text: `${w}, ${s}` }),
);

await scenario(
  "pick then Enter removes the auto space: word + newline",
  std(async () => {
    const w = await completed();
    await key("Enter");
    return w;
  }),
  (w) => ({ raw: `${done(w)}⌫⏎`, text: `${w}\n` }),
);

await scenario(
  "swipe then ? (Shift + /): attaches; the simulator logs the base key, Steam applies Shift; the next swipe is spaced",
  std(async () => {
    const a = await swipe("L", "the");
    await shifted("/");
    return [a, await swipe("R", "job")];
  }),
  ([a, b]) => ({ raw: `${a}/ ${b}`, text: `${a}/ ${b}` }),
);

await scenario(
  "pick then ? (Shift + /) removes the space",
  std(async () => {
    const w = await completed();
    await shifted("/");
    return w;
  }),
  (w) => ({ raw: `${done(w)}⌫/`, text: `${w}/` }),
);

await scenario(
  "pick then ! (Shift + 1) then a swiped word: spaced once",
  std(async () => {
    const w = await completed();
    await shifted("1");
    return [w, await swipe("L", "the")];
  }),
  ([w, s]) => ({ raw: `${done(w)}⌫1 ${s}`, text: `${w}1 ${s}` }),
);

await scenario(
  "pick then : (Shift + ;), ; and ) (Shift + 0) each remove the space",
  std(async () => {
    const ws = [];
    for (const [shift, k] of [
      [true, ";"],
      [false, ";"],
      [true, "0"],
    ]) {
      ws.push(await completed());
      if (shift) await key("Shift");
      await key(k);
      await key(" ");
    }
    return ws;
  }),
  (ws) => ({
    raw: `${done(ws[0])}⌫; ${done(ws[1])}⌫; ${done(ws[2])}⌫0 `,
    text: `${ws[0]}; ${ws[1]}; ${ws[2]}0 `,
  }),
);

await scenario(
  "pick then a swiped word does not double the space",
  std(async () => {
    const w = await completed();
    return [w, await swipe("L", "the")];
  }),
  ([w, s]) => ({ raw: `${done(w)}${s}`, text: `${w} ${s}` }),
);

await scenario(
  "a typed space then period keeps the space",
  std(async () => {
    await word("hello");
    await key(" ");
    await key(".");
  }),
  { raw: "hello .", text: "hello ." },
);

await scenario(
  "a cursor move between the pick and the period keeps the space",
  std(async () => {
    const w = await completed();
    await key("ArrowLeft");
    await key("ArrowRight");
    await key(".");
    return w;
  }),
  (w) => ({ raw: `${done(w)}←→.`, text: `${w} .` }),
);

await scenario(
  "Backspace between the pick and the period: the user's Backspace only",
  std(async () => {
    const w = await completed();
    await key("Backspace");
    await key(".");
    return w;
  }),
  (w) => ({ raw: `${done(w)}⌫.`, text: `${w}.` }),
);

await scenario(
  "a letter between the pick and the period: the space stays",
  std(async () => {
    const w = await completed();
    await key("w");
    await key(".");
    return w;
  }),
  (w) => ({ raw: `${done(w)}w.`, text: `${w} w.` }),
);

await scenario(
  "apostrophe may open a quote, so it keeps the auto space",
  std(async () => {
    const w = await completed();
    await key("'");
    return w;
  }),
  (w) => ({ raw: `${done(w)}'`, text: `${w} '` }),
);

await scenario(
  "the pending space is consumed once: a second period removes nothing",
  std(async () => {
    const w = await completed();
    await key(".");
    await key(".");
    return w;
  }),
  (w) => ({ raw: `${done(w)}⌫..`, text: `${w}..` }),
);

await scenario(
  "prediction pick then period",
  std(async () => {
    await word("the");
    await key(" ");
    const w = await pick(/\S/);
    await key(".");
    return w;
  }),
  (w) => ({ raw: `the ${w} ⌫.`, text: `the ${w}.` }),
);

await scenario(
  "setting off: pick then period and Enter keep the space (old behaviour)",
  std(async () => {
    await setSetting("removeAutoSpace", false);
    try {
      const w = await completed();
      await key(".");
      await key("Enter");
      return w;
    } finally {
      await setSetting("removeAutoSpace", true);
    }
  }),
  (w) => ({ raw: `${done(w)}.⏎`, text: `${w} .\n` }),
);

await scenario(
  "swipe then a tapped letter starts a new word",
  std(async () => {
    const s = await swipe("L", "the");
    await key("a");
    return [s, await tracker()];
  }),
  ([s]) => ({ raw: `${s} a`, text: `${s} a` }),
);

await scenario(
  "the tracker and learner see the tapped letter as its own word",
  std(async () => {
    const s = await swipe("L", "the");
    await key("a");
    const t = await tracker();
    await key(" ");
    const bad = t.pending.filter((w) => w.length > 1 && w.endsWith("a"));
    return { s, ok: t.buf === "a" && t.prev === s && !bad.length, t };
  }),
  (e) => ({ raw: `${e.s} a `, text: e.ok ? `${e.s} a ` : "tracker saw a joined word" }),
);

await scenario(
  "swipe then a tapped period attaches without a space",
  std(async () => {
    const s = await swipe("L", "the");
    await key(".");
    return s;
  }),
  (s) => ({ raw: `${s}.`, text: `${s}.` }),
);

await scenario(
  "space before swiped words off: a tapped letter after a swipe joins the word (old behaviour)",
  std(async () => {
    await setSetting("autoSpace", false);
    try {
      const s = await swipe("L", "the");
      await key("a");
      return s;
    } finally {
      await setSetting("autoSpace", true);
    }
  }),
  (s) => ({ raw: `${s}a`, text: `${s}a` }),
);

console.log(results.join("\n"));
console.log(failures ? `${failures} FAILED` : "ALL PASS");
await browser.close();
process.exit(failures ? 1 : 0);
