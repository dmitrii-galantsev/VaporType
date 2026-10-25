import path from "node:path";
import { openSim, inject, settle, waitKeyboard } from "./run.mjs";
import { readRuntime as read } from "../runtime.mjs";
import { pageHelpers, sleep, textOut, withTiming } from "./helpers.mjs";

const shots = process.env.SHOTS;

const { browser, page, errors } = await openSim();
let failures = 0;
const results = [];

await page.evaluate(
  ["swipe/words.js", "swipe/lm.js", "swipe/engine.js", ...(process.env.WITH_MODES ? ["modes.js"] : [])].map(read).join("\n;\n"),
);
await page.evaluate(() => {
  window.__oskUserWords = null;
  window.localStorage.clear();
});
results.push(`inject: ${await inject(page, read("patch.js"))}`);

const { kbEval, center: centerNow, vgp, padAt, padIdle, labels, setSetting } = pageHelpers(page);

const centers = new Map();
async function center(key) {
  if (!centers.has(key)) centers.set(key, await centerNow(key));
  return centers.get(key);
}

const BTN = { L: 20, R: 22 };

async function padStroke(side, letters, { hold = false, steps = 6, jitter = 0, idle = true, tail = 0 } = {}) {
  const pts = [];
  for (const ch of letters) pts.push(await center(ch));
  if (tail && pts.length > 1) {
    const a = pts[pts.length - 2],
      b = pts[pts.length - 1];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    pts.push({ x: b.x + ((b.x - a.x) / l) * tail * 60, y: b.y + ((b.y - a.y) / l) * tail * 60 });
  }
  await padAt(side, pts[0].x, pts[0].y);
  await vgp("vgp_onbuttondown", BTN[side]);
  for (let i = 1; i < pts.length; i++) {
    for (let s = 1; s <= steps; s++) {
      const f = s / steps;
      const j = jitter ? Math.sin(i * 7 + s) * jitter : 0;
      await padAt(side, pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f + j, pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f + j / 2);
      await sleep(8);
    }
  }
  if (!hold) {
    await vgp("vgp_onbuttonup", BTN[side]);
    if (idle) await padIdle(side);
  }
}

async function padTap(side, key) {
  const c = await center(key);
  await padAt(side, c.x, c.y);
  await vgp("vgp_onbuttondown", BTN[side]);
  await sleep(20);
  await vgp("vgp_onbuttonup", BTN[side]);
  await padIdle(side);
  await sleep(20);
}

async function rawPad(side, ux, uy) {
  await kbEval((kb, side, ux, uy) => kb.m_trackpadInput.m_AnalogCallbacks.Dispatch(side === "L" ? 19 : 21, 0, ux, uy), side, ux, uy);
}

async function rawOf(key, side = "R") {
  const c = await center(key);
  return kbEval(
    (kb, c, side) => {
      const r = kb.m_keyboardDiv.getBoundingClientRect();
      const M = window.__oskModes,
        F = window.__oskTrackpadFix;
      const api = F.modeApi;
      if (!M) {
        const span = api.spans()[side];
        const x0 = side === "L" ? r.left : r.right - r.width * span;
        return { ux: (2 * (c.x - x0)) / (r.width * span) - 1, uy: 1 - (2 * (c.y - r.top)) / r.height };
      }
      const mode = M.modes[F.settings.mode] ?? M.modes.standard;
      const G = M.geometry;
      const L = G.layoutFrom(api.keys(kb), r, api.spans());
      const [px, py] = G.toPad(G.padMap(mode.map, L), side, c.x, c.y);
      return { ux: (2 * px) / G.PAD_MM - 1, uy: 1 - (2 * py) / G.PAD_MM };
    },
    c,
    side,
  );
}

async function rawStroke(letters, { steps = 6, side = "R" } = {}) {
  const pts = [];
  for (const ch of letters) pts.push(await rawOf(ch, side));
  await rawPad(side, pts[0].ux, pts[0].uy);
  await sleep(30);
  await rawPad(side, pts[0].ux, pts[0].uy);
  await vgp("vgp_onbuttondown", BTN[side]);
  for (let i = 1; i < pts.length; i++) {
    for (let s = 1; s <= steps; s++) {
      const f = s / steps;
      await rawPad(side, pts[i - 1].ux + (pts[i].ux - pts[i - 1].ux) * f, pts[i - 1].uy + (pts[i].uy - pts[i - 1].uy) * f);
      await sleep(8);
    }
  }
  await vgp("vgp_onbuttonup", BTN[side]);
  await settle(page);
}

async function touchSwipe(letters) {
  const pts = [];
  for (const ch of letters) pts.push(await center(ch));
  await page.evaluate(async (pts) => {
    const target = document.elementFromPoint(pts[0].x, pts[0].y);
    const send = (type, p) => {
      const t = new Touch({ identifier: 1, target, clientX: p.x, clientY: p.y });
      target.dispatchEvent(
        new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          touches: type === "touchend" ? [] : [t],
          targetTouches: type === "touchend" ? [] : [t],
          changedTouches: [t],
        }),
      );
    };
    send("touchstart", pts[0]);
    let last = pts[0];
    for (let i = 1; i < pts.length; i++) {
      for (let s = 1; s <= 6; s++) {
        const f = s / 6;
        last = { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f };
        send("touchmove", last);
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    send("touchend", last);
  }, pts);
}

async function touchTap(key) {
  const c = await center(key);
  await page.touchscreen.tap(c.x, c.y);
  await sleep(30);
}

let doc = "";
const scenario = withTiming(scenario0);

async function scenario0(title, fn, check) {
  centers.clear();
  const all = await page.evaluate(() => {
    const out = {};
    for (const el of document.querySelectorAll("[data-key]")) {
      const k = el.getAttribute("data-key");
      const r = el.getBoundingClientRect();
      if (r.width > 0 && !(k in out)) out[k] = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return out;
  });
  for (const [k, v] of Object.entries(all)) centers.set(k, v);
  const e0 = errors.length;
  await page.evaluate(() => {
    window.__keyLog.length = 0;
  });
  await fn();
  await settle(page);
  const log = await page.evaluate(() => window.__keyLog.slice());
  const out = textOut(log);
  doc += out;
  const sug = await labels();
  const multi = log.filter(([, kind, v]) => kind === "text" && [...v].length !== 1);
  const SH = {
    "!": "1",
    "@": "2",
    "#": "3",
    $: "4",
    "%": "5",
    "^": "6",
    "&": "7",
    "*": "8",
    "(": "9",
    ")": "0",
    _: "-",
    "+": "=",
    ":": ";",
    '"': "'",
    "<": ",",
    ">": ".",
    "?": "/",
  };
  const phys = (v) => SH[v] ?? v.toLowerCase();
  const texts = log.filter(([, kind]) => kind === "text");
  const fast = [];
  for (let i = 1; i < texts.length; i++)
    if (phys(texts[i][2]) === phys(texts[i - 1][2]) && texts[i][0] - texts[i - 1][0] < 32)
      fast.push(`${JSON.stringify(texts[i - 1][2] + texts[i][2])} ${(texts[i][0] - texts[i - 1][0]).toFixed(0)}ms`);
  if (fast.length) results.push(`  same physical key re-sent under 32 ms (SDL drops it as a repeat): ${fast.join(", ")}`);
  const ok = (await check(out, sug)) && multi.length === 0 && fast.length === 0;
  if (multi.length)
    results.push(`  multi-character SendText calls (Moonlight would see digits): ${JSON.stringify(multi.map((x) => x[2]))}`);
  if (!ok) failures++;
  const newErr = errors.filter((e, i) => i >= e0 && !/404|Failed to load|Transport|passive event listener|cancel a touchend/.test(e));
  results.push(
    `${ok ? "PASS" : "FAIL"} ${title}\n      text ${JSON.stringify(out)}  suggestions ${JSON.stringify(sug)}${newErr.length ? `\n      errors ${newErr.join(" | ")}` : ""}`,
  );
  if (newErr.length) failures++;
}

await scenario(
  "one-pad swipe the (left pad)",
  () => padStroke("L", "the"),
  (o) => o === "the",
);
await scenario(
  "two-pad swipe hello: R h, L e, R l..o",
  async () => {
    await padStroke("R", "h", { hold: true });
    await sleep(40);
    await padTap("L", "e");
    await vgp("vgp_onbuttonup", BTN.R);
    await sleep(60);
    await padStroke("R", "lo", { tail: 1.5 });
  },
  (o) => o === " hello",
);
await scenario(
  "Backspace right after a swipe deletes the word and its space",
  () => padTap("R", "Backspace"),
  (o) => o === "",
);
await scenario(
  "overlapping presses without movement stay taps: L w, R o, L r, R l, L d",
  async () => {
    await padStroke("L", "w", { hold: true });
    await padStroke("R", "o", { hold: true });
    await vgp("vgp_onbuttonup", BTN.L);
    await padStroke("L", "r", { hold: true });
    await vgp("vgp_onbuttonup", BTN.R);
    await padStroke("R", "l", { hold: true });
    await vgp("vgp_onbuttonup", BTN.L);
    await padStroke("L", "d", { hold: true });
    await vgp("vgp_onbuttonup", BTN.R);
    await sleep(30);
    await vgp("vgp_onbuttonup", BTN.L);
  },
  (o) => o === "world",
);
await scenario(
  "swipe people, strip shows it in the middle with alternatives",
  async () => {
    await padTap("R", " ");
    await padStroke("R", "p");
    await sleep(30);
    await padStroke("L", "e");
    await sleep(30);
    await padStroke("R", "opl", { hold: true, tail: 1.5 });
    await padStroke("L", "e", { hold: true });
    await vgp("vgp_onbuttonup", BTN.R);
    await padIdle("R");
    await page.waitForFunction(() => window.__oskTrackpadFix.tracker.mode === "preview", { timeout: 3000, polling: 10 });
    if (shots) await page.screenshot({ path: path.join(shots, "swipe-during.png"), clip: { x: 0, y: 500, width: 1280, height: 300 } });
    await vgp("vgp_onbuttonup", BTN.L);
    await padIdle("L");
    await settle(page);
    if (shots) await page.screenshot({ path: path.join(shots, "swipe-after.png"), clip: { x: 0, y: 500, width: 1280, height: 300 } });
  },
  (o, s) => o === " people" && s[1] === "people" && !!s[0] && !!s[2],
);
await scenario(
  "pick the left alternative replaces the swiped word",
  () => padTap("L", "OSKSug_0"),
  (o, s) => o.length > 0 && s[1] !== "people",
);
await scenario(
  "tap space, then tap typing g-a-m stays in order, completions offered",
  async () => {
    await padTap("R", " ");
    for (const k of "gam") await padTap(k < "h" ? "L" : "R", k);
  },
  (o, s) => o === " gam" && s.includes("game"),
);
await scenario(
  "pick completion game: rest of word and a space",
  async () => {
    const s = await labels();
    await padTap(s.indexOf("game") === 0 ? "L" : "R", `OSKSug_${s.indexOf("game")}`);
  },
  (o) => o === "game " || o.endsWith("game "),
);
await scenario(
  "rolled taps (no movement) stay taps: i down, t down, i up, t up",
  async () => {
    const o = await center("i"),
      t = await center("t");
    await padAt("R", o.x, o.y);
    await vgp("vgp_onbuttondown", BTN.R);
    await padAt("L", t.x, t.y);
    await vgp("vgp_onbuttondown", BTN.L);
    await vgp("vgp_onbuttonup", BTN.R);
    await vgp("vgp_onbuttonup", BTN.L);
    await padIdle("L");
    await padIdle("R");
  },
  (o) => o === "it",
);
await scenario(
  "space then shift + swipe capitalizes",
  async () => {
    await padTap("R", " ");
    await vgp("vgp_onbuttondown", 7);
    await padStroke("L", "great");
    await vgp("vgp_onbuttonup", 7);
  },
  (o) => o === " Great",
);
await scenario(
  "swipe after a swiped word inserts the space automatically",
  () => padStroke("R", "job"),
  (o) => o === " job",
);
await scenario(
  "punctuation tap attaches to the swiped word",
  () => padTap("R", "."),
  (o) => o === ".",
);
await scenario(
  "a new word typed once is not learned yet",
  async () => {
    await padTap("R", " ");
    for (const k of "zorblex") await padTap("zxbre".includes(k) ? "L" : "R", k);
    await padTap("R", " ");
  },
  async (o) => o === " zorblex " && !(await page.evaluate(() => window.__oskEngine.known("zorblex"))),
);
await scenario(
  "typed a second time it is learned",
  async () => {
    for (const k of "zorblex") await padTap("zxbre".includes(k) ? "L" : "R", k);
    await padTap("R", " ");
  },
  async (o) => o === "zorblex " && (await page.evaluate(() => window.__oskEngine.known("zorblex"))),
);
await scenario(
  "the learned word can now be swiped (two pads, thumbs stay on the pads between strokes)",
  async () => {
    await padStroke("L", "z", { idle: false });
    await padStroke("R", "o", { idle: false });
    await padStroke("L", "rb", { idle: false });
    await padStroke("R", "l", { idle: false });
    await padStroke("L", "ex", { idle: false });
    await padIdle("R");
    await padIdle("L");
  },
  (o) => o === "zorblex",
);
await scenario(
  "two quick words on alternating pads stay two words: L the, R job 60 ms later",
  async () => {
    await padTap("R", " ");
    await padStroke("L", "the");
    await sleep(60);
    await padStroke("R", "job");
  },
  (o) => o === " the job",
);
await scenario(
  "tap then quick swipe continues the word: tap s (left), swipe k..y (right)",
  async () => {
    await padTap("R", " ");
    await padTap("L", "s");
    await sleep(50);
    await padStroke("R", "ky");
  },
  (o) => o === " sky",
);
await scenario(
  "touchscreen swipe typing",
  async () => {
    await padTap("R", " ");
    await touchSwipe("typing");
  },
  (o) => o === " typing",
);
await scenario(
  "touchscreen taps still type",
  async () => {
    await touchTap("o");
    await touchTap("k");
  },
  (o) => o === " ok",
);
const AFTER_SWIPE = [
  ["Y (space)", () => vgp("vgp_onbuttondown", 4).then(() => vgp("vgp_onbuttonup", 4)), " great "],
  ["X (Backspace)", () => vgp("vgp_onbuttondown", 3).then(() => vgp("vgp_onbuttonup", 3)), " "],
  ["RT (Enter)", () => vgp("vgp_onbuttondown", 8).then(() => vgp("vgp_onbuttonup", 8)), " great\n"],
  ["touch space", () => touchTap(" "), " great "],
];
for (const [name, press, want] of AFTER_SWIPE)
  for (const ms of [0, 40, 120])
    await scenario(
      `${name} ${ms} ms after a pad swipe goes out after the word`,
      async () => {
        await padTap("R", " ");
        await settle(page);
        await padStroke("L", "great");
        if (ms) await sleep(ms);
        await press();
      },
      (o) => o === want,
    );
await scenario(
  "Ctrl active: pad press on a letter is a normal chord, no swipe",
  async () => {
    await padTap("L", "Control");
    await padStroke("L", "cv");
  },
  (o) => o === "",
);

let hovered = [];
async function hoverRaw(ux, uy) {
  await rawPad("R", ux, uy);
  await sleep(30);
  await rawPad("R", ux, uy);
  hovered.push(await kbEval((kb) => kb.m_rightTrackpad.lastElement?.getAttribute("data-key")));
}
await scenario(
  "two-pad mode: right pad at its far left edge points into the middle of the keyboard",
  async () => {
    hovered = [];
    await hoverRaw(-0.95, 0);
  },
  () => {
    results.push(`      right pad hovers ${hovered}`);
    return !!hovered[0] && !"qazwsx".includes(hovered[0]);
  },
);
await scenario(
  "Pad reach Right pad only: the right pad covers the whole keyboard (q at its left edge, p at its right)",
  async () => {
    hovered = [];
    await page.evaluate(() => window.__oskTrackpadFix.setSetting("reach", "right"));
    await settle(page);
    const q = await rawOf("q"),
      p = await rawOf("p");
    await hoverRaw(q.ux, q.uy);
    await hoverRaw(p.ux, p.uy);
  },
  () => {
    results.push(`      right pad hovers ${hovered}`);
    return hovered[0] === "q" && hovered[1] === "p";
  },
);
await scenario(
  "Right pad only: swipe hello with the right pad alone, typed at release",
  async () => {
    await padTap("R", " ");
    await rawStroke("helo");
  },
  (o) => o === " hello",
);
await scenario(
  "Right pad only: swipe a left-side word (great) with the right pad",
  () => rawStroke("great"),
  (o) => o === " great",
);
await scenario(
  "Right pad only: right pad tap on a and left pad tap on s still type",
  async () => {
    await padTap("R", " ");
    const a = await rawOf("a");
    await rawPad("R", a.ux, a.uy);
    await sleep(30);
    await rawPad("R", a.ux, a.uy);
    await vgp("vgp_onbuttondown", BTN.R);
    await sleep(20);
    await vgp("vgp_onbuttonup", BTN.R);
    await settle(page);
    await padTap("L", "s");
  },
  (o) => o === " as",
);
for (const mode of ["bigkeys", "standard"]) {
  for (const reach of [75, 100]) {
    await scenario(
      `pad reach ${reach}, ${mode}: swipe testing with the left pad alone, typed at release`,
      async () => {
        await setSetting("mode", mode);
        await setSetting("reach", reach);
        await settle(page);
        await rawStroke("testing", { side: "L" });
      },
      (o) => o === " testing",
    );
  }
  await scenario(
    `pad reach 100, ${mode}: swipe a right-side word (hello) with the left pad alone`,
    () => rawStroke("hello", { side: "L" }),
    (o) => o === " hello",
  );
  await scenario(
    `pad reach 100, ${mode}: swipe a left-side word (great) with the right pad alone`,
    () => rawStroke("great", { side: "R" }),
    (o) => o === " great",
  );
}
const reachRound = {};
await scenario(
  "pad reach setting: 75 is stored, 60 is refused, 55 restores the default",
  async () => {
    const set = (v) => page.evaluate((v) => window.__oskTrackpadFix.setSetting("reach", v), v);
    const stored = () =>
      page.evaluate(() => [
        window.__oskTrackpadFix.settings.reach,
        JSON.parse(window.localStorage.getItem("oskSwipeSettings") ?? "{}").reach,
      ]);
    const out = reachRound;
    out.set75 = await set(75);
    out.after75 = await stored();
    out.set60 = await set(60);
    out.after60 = await stored();
    out.setStr = await set("wide");
    out.set55 = await set(55);
    out.after55 = await stored();
  },
  () =>
    reachRound.set75 === true &&
    reachRound.after75[0] === 75 &&
    reachRound.after75[1] === 75 &&
    reachRound.set60 === false &&
    reachRound.after60[0] === 75 &&
    reachRound.setStr === false &&
    reachRound.set55 === true &&
    reachRound.after55[0] === 55 &&
    reachRound.after55[1] === 55,
);
results.push(`      reach round trip ${JSON.stringify(reachRound)}`);
await setSetting("reach", 55);
await setSetting("mode", "bigkeys");
await settle(page);
await scenario(
  "lost button-up: a second press on the same pad ends the first stroke (a, then s)",
  async () => {
    await padTap("R", " ");
    const a = await center("a"),
      b = await center("s");
    await padAt("L", a.x, a.y);
    await vgp("vgp_onbuttondown", BTN.L);
    await padAt("L", b.x, b.y);
    await vgp("vgp_onbuttondown", BTN.L);
    await vgp("vgp_onbuttonup", BTN.L);
    await padIdle("L");
  },
  (o) => o === " as",
);
await scenario(
  "LB released while the keyboard is closed: nothing stays held after reopening",
  async () => {
    await vgp("vgp_onbuttondown", 5);
    await sleep(100);
    await page.evaluate(() => window.__sim.vkm.SetVirtualKeyboardHidden());
    await page.evaluate(() => window.__oskTrackpadFix.tickNow());
    await vgp("vgp_onbuttonup", 5);
    await page.evaluate(() => window.__sim.vkm.SetVirtualKeyboardVisible());
    await waitKeyboard(page);
  },
  async () =>
    (await page.evaluate(() => [...window.__oskTrackpadFix.sent.keys()].length === 0)) &&
    (await kbEval((kb) => kb.state.toggleStates.Control)) === 0,
);
await scenario(
  "tapping an unknown word offers + word; picking it adds it at once and types a space",
  async () => {
    await padTap("R", " ");
    for (const k of "qwopz") await padTap("L", k);
    const s = await labels();
    if (s[0] !== "+ add qwopz") throw new Error(`labels ${s}`);
    await padTap("L", "OSKSug_0");
  },
  async (o) => o === " qwopz " && (await page.evaluate(() => window.__oskEngine.known("qwopz"))),
);
await scenario(
  "holding a suggestion removes it and it is not suggested again",
  async () => {
    for (const k of "peopl") await padTap(k === "p" || k === "o" || k === "l" ? "R" : "L", k);
    const s = await labels();
    const i = s.indexOf("people");
    if (i < 0) throw new Error(`labels ${s}`);
    const c = await center(`OSKSug_${i}`);
    await padAt("R", c.x, c.y);
    await vgp("vgp_onbuttondown", BTN.R);
    await sleep(750);
    await vgp("vgp_onbuttonup", BTN.R);
    await padIdle("R");
    await page.waitForFunction(() => window.__oskTrackpadFix.blocked.has("people"), { timeout: 3000, polling: 10 });
    await settle(page);
  },
  async (o, s) => o === "peopl" && !s.includes("people") && (await page.evaluate(() => window.__oskTrackpadFix.blocked.has("people"))),
);
await scenario(
  "same key with and without Shift is paced like a repeat: aAAa Ss 1! ;: ll",
  async () => {
    await page.evaluate(() => window.__oskTrackpadFix.typeText("aAAa Ss 1! ;: ll"));
    await settle(page);
  },
  async (o) => o.endsWith("aAAa Ss 1! ;: ll"),
);
const saved = await page.evaluate(() => window.__oskTrackpadFix.takeUserWords());
const savedOk = !!saved && JSON.parse(saved).words.zorblex?.c >= 1;
if (!savedOk) failures++;
results.push(`${savedOk ? "PASS" : "FAIL"} takeUserWords has zorblex: ${saved?.slice(0, 160)}`);
const unacked = await page.evaluate(() => window.__oskTrackpadFix.takeUserWords());
if (unacked !== saved) failures++;
results.push(`${unacked === saved ? "PASS" : "FAIL"} takeUserWords keeps returning the data until inject.mjs acknowledges the write`);
await page.evaluate((rev) => window.__oskTrackpadFix.ackUserWords(rev), JSON.parse(saved).rev);
const again = await page.evaluate(() => window.__oskTrackpadFix.takeUserWords());
if (again !== null) failures++;
results.push(`${again === null ? "PASS" : "FAIL"} takeUserWords returns null after the acknowledged write`);
const forgot = await page.evaluate(() => {
  window.__oskTrackpadFix.forgetAll();
  return [window.__oskEngine.known("zorblex"), JSON.parse(window.__oskTrackpadFix.takeUserWords()).words];
});
const forgotOk = forgot[0] === false && Object.keys(forgot[1]).length === 0;
if (!forgotOk) failures++;
results.push(`${forgotOk ? "PASS" : "FAIL"} forgetAll() clears learned words: ${JSON.stringify(forgot)}`);
results.push(`document so far: ${JSON.stringify(doc)}`);
results.push(
  `status: ${await page.evaluate(() => window.__oskTrackpadFix.status())} lastDecodeMs=${await page.evaluate(() => window.__oskTrackpadFix.lastDecodeMs)}`,
);
if (shots) await page.screenshot({ path: path.join(shots, "swipe.png") });
console.log(results.join("\n"));
console.log(failures ? `${failures} FAILED` : "ALL PASS");
await browser.close();
process.exit(failures ? 1 : 0);
