import puppeteer from "puppeteer-core";
import { openSim, inject, settle, waitKeyboard } from "./run.mjs";
import { readRuntime as read } from "../runtime.mjs";
import { makeCheck, pageHelpers, sleep } from "./helpers.mjs";

const PRELUDE = ["swipe/words.js", "swipe/lm.js", "swipe/engine.js", "modes.js"].map(read).join("\n;\n");
const PATCH = read("patch.js");
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
let failures = 0;
const results = [];
const check = makeCheck(
  (line) => results.push(line),
  () => failures++,
);

async function fresh({ userWords = null, consent = true } = {}) {
  const sim = await openSim({ browser });
  await sim.page.evaluate(PRELUDE);
  await sim.page.evaluate((u) => {
    window.localStorage.clear();
    window.__oskUserWords = u;
    window.__oskInstall = { date: "2026-10-23" };
  }, userWords);
  await inject(sim.page, PATCH, { consent });
  return sim;
}

function helpers(page) {
  const F = (fn, ...a) => page.evaluate(fn, ...a);
  const { kbEval, center, vgp, padAt, padIdle } = pageHelpers(page);
  const BTN = { L: 20, R: 22 };
  const tap = async (key, side = "R") => {
    const c = await center(key);
    if (!c) throw new Error(`no key ${key}`);
    await padAt(side, c.x, c.y);
    await vgp("vgp_onbuttondown", BTN[side]);
    await sleep(15);
    await vgp("vgp_onbuttonup", BTN[side]);
    await padIdle(side);
    await settle(page, { quiet: 0, join: false });
  };
  const word = async (w, end = " ") => {
    for (const ch of w) await tap(ch === " " ? " " : ch);
    if (end) await tap(end);
    await settle(page);
  };
  const stroke = async (side, letters) => {
    const pts = [];
    for (const ch of letters) pts.push(await center(ch));
    await padAt(side, pts[0].x, pts[0].y);
    await vgp("vgp_onbuttondown", BTN[side]);
    for (let i = 1; i < pts.length; i++)
      for (let s = 1; s <= 6; s++) {
        await padAt(side, pts[i - 1].x + ((pts[i].x - pts[i - 1].x) * s) / 6, pts[i - 1].y + ((pts[i].y - pts[i - 1].y) * s) / 6);
        await sleep(8);
      }
    await vgp("vgp_onbuttonup", BTN[side]);
    await padIdle(side);
    await settle(page);
  };
  const text = async () => {
    await settle(page);
    return (await F(() => window.__keyLog.filter(([, k]) => k === "text").map(([, , v]) => v)))
      .map((v) => (v === "\u0002" ? "⌫" : v === "\u0001" ? "⏎" : v))
      .join("");
  };
  const clear = async () => {
    await settle(page);
    await F(() => {
      window.__keyLog.length = 0;
    });
  };
  const user = () => F(() => window.__oskEngine.exportUser());
  const set = (k, v) => F((k, v) => window.__oskTrackpadFix.setSetting(k, v), k, v);
  return { F, kbEval, center, vgp, tap, word, stroke, text, clear, user, set, padAt, padIdle };
}

async function privateBoundary() {
  const { page } = await fresh();
  const h = helpers(page);
  await h.set("typingLog", true);
  await h.tap(" ");
  await h.set("privateMode", true);
  await h.word("hello");
  const swipeLogBefore = await h.F(() => window.__oskTrackpadFix.swipeLog.length);
  await h.stroke("L", "the");
  const swipeLogAfter = await h.F(() => window.__oskTrackpadFix.swipeLog.length);
  await h.tap(" ");
  await h.word("hello", null);
  await h.set("privateMode", false);
  const tracker = await h.F(() => {
    const T = window.__oskTrackpadFix.tracker;
    return { buf: T.buf, prev: T.prev, autocorr: T.autocorr, taps: T.taps.length };
  });
  await h.word("world");
  await h.word("again");
  await h.F(() => window.__oskTrackpadFix.flushLog());
  const u = await h.user();
  const saved = await h.F(() => window.__oskTrackpadFix.takeUserWords() ?? "");
  const log = JSON.parse((await h.F(() => window.__oskTrackpadFix.takeTypingLog())) ?? '{"lines":[]}').lines.join("\n");
  check(
    !u.bigrams["hello world"] &&
      !u.bigrams["the world"] &&
      !/hello world|hello/.test(saved.replace(/"hello"/g, "")) &&
      !/"hello"|"the"/.test(log) &&
      swipeLogAfter === swipeLogBefore &&
      tracker.buf === "" &&
      tracker.prev === null &&
      tracker.taps === 0 &&
      !!u.bigrams["world again"],
    "private mode: 'hello' typed in private then 'world' after leaving is not learned as a pair; nothing private is logged or kept in the swipe log",
    { bigrams: Object.keys(u.bigrams), tracker, swipeLogBefore, swipeLogAfter, log: log.slice(0, 200) },
  );

  await page.close();
}

async function enterEnded() {
  const { page } = await fresh();
  const h = helpers(page);
  await h.tap(" ");
  const before = await h.user();
  await h.word("hello", "Enter");
  await h.word("hello", "Enter");
  await h.F(() => {
    const T = window.__oskTrackpadFix.tracker;
    T.buf = "thank you";
    T.lastOut = "word";
  });
  await h.tap("Enter");
  await h.word("good", null);
  await h.F(() => {
    window.__sim.vkm.SetVirtualKeyboardHidden();
    window.__oskTrackpadFix.tickNow();
    window.__sim.vkm.SetVirtualKeyboardVisible();
  });
  await waitKeyboard(page);
  for (let i = 0; i < 3; i++) await h.word("zqvxplor", "Enter");
  const after = await h.user();
  const diff = Object.keys(after.words).filter((k) => JSON.stringify(after.words[k]) !== JSON.stringify(before.words[k]));
  const bdiff = Object.keys(after.bigrams).filter((k) => after.bigrams[k] !== before.bigrams[k]);
  check(
    diff.length === 0 && bdiff.length === 0 && !(await h.F(() => window.__oskEngine.known("zqvxplor"))),
    "Enter- or close-ended words (known word, phrase, a repeated password-like word) are not learned",
    { diff, bdiff },
  );
  await page.close();
}

async function forgetProtocol() {
  const { page } = await fresh();
  const h = helpers(page);
  await h.tap(" ");
  await h.word("hello");
  await h.word("there", null);
  await h.F(() => window.__oskTrackpadFix.forgetAll());
  const ctx = await h.F(() => {
    const T = window.__oskTrackpadFix.tracker;
    return { buf: T.buf, prev: T.prev };
  });
  const r1 = await h.F(() => window.__oskTrackpadFix.takeRequests());
  const r2 = await h.F(() => window.__oskTrackpadFix.takeRequests());
  const rev = JSON.parse(r1 ?? "{}").rev;
  const acked = await h.F((rev) => window.__oskTrackpadFix.ackRequests?.(rev), rev);
  const r3 = await h.F(() => window.__oskTrackpadFix.takeRequests());
  const words = JSON.parse((await h.F(() => window.__oskTrackpadFix.takeUserWords())) ?? "{}");
  await h.F(() => {
    window.__oskTrackpadFix.hostAcks = true;
    window.__oskTrackpadFix.forgetAll();
  });
  const offers = [];
  for (let i = 0; i < 6; i++) offers.push(await h.F(() => window.__oskTrackpadFix.takeRequests()));
  const rev2 = JSON.parse(offers[0] ?? "{}").rev;
  await h.F((rev) => window.__oskTrackpadFix.ackRequests(rev), rev2);
  const afterAck = await h.F(() => window.__oskTrackpadFix.takeRequests());
  check(
    offers.every((o) => o && o === offers[0]) && afterAck === null,
    "with hostAcks = true a forget survives six unacknowledged takes and clears only on ackRequests(rev)",
    { offers: offers.length, first: offers[0], afterAck },
  );
  const legacy = await fresh();
  const lh = helpers(legacy.page);
  await lh.F(() => window.__oskTrackpadFix.forgetAll());
  const lt = [];
  for (let i = 0; i < 4; i++) lt.push(await lh.F(() => window.__oskTrackpadFix.takeRequests()));
  check(
    lt[0] && lt[2] && lt[3] === null && (await lh.F(() => window.__oskTrackpadFix.hostAcks)) === false,
    "a host that never announces itself keeps the legacy clear after three takes",
    lt,
  );
  await legacy.page.close();
  check(
    ctx.buf === "" &&
      ctx.prev === null &&
      r1 &&
      r1 === r2 &&
      Number.isFinite(rev) &&
      r3 === null &&
      JSON.parse(r1).removeBackup &&
      JSON.parse(r1).clearLog &&
      words.forgetGen >= 1,
    "forgetAll clears the text context; its request stays pending until ackRequests(rev); the words payload carries forgetGen",
    { ctx, r1, r2, r3, acked, forgetGen: words.forgetGen },
  );
  await page.close();
}

async function otherLayout() {
  const { page } = await fresh();
  const h = helpers(page);
  await h.set("typingLog", true);
  await h.tap(" ");
  const sw = await h.kbEval((kb) => {
    const F = window.__oskTrackpadFix;
    const api = F.layoutApi;
    const fr = api.enabled().find((l) => l.name === "french");
    api.current = () => fr;
    kb.setState({ standardLayout: fr });
    return !!fr;
  });
  await h.F(() => window.__oskTrackpadFix.tickNow());
  await settle(page);
  await h.clear();
  const before = await h.user();
  await h.word("teh");
  await h.word("teh");
  await h.stroke("L", "zer");
  await h.F(() => window.__oskTrackpadFix.flushLog());
  const out = await h.text();
  const state = await h.F(() => ({
    sug: !!document.querySelector('[data-key^="OSKSug_"]'),
    esc: !!document.querySelector('[data-key="Escape"]'),
    echo: (() => {
      const e = document.querySelector(".osk-echo");
      return !!e && !e.hidden;
    })(),
    overlay: !!document.getElementById("osk-mode-overlay"),
    log: window.__oskTrackpadFix.takeTypingLog(),
    known: window.__oskEngine.known("teh"),
  }));
  const after = await h.user();
  check(
    sw &&
      out === "teh teh z" &&
      !state.sug &&
      state.esc &&
      !state.echo &&
      !state.overlay &&
      state.log === null &&
      JSON.stringify(before) === JSON.stringify(after),
    "a non-QWERTY layout (French) behaves like stock Steam: no suggestions, autocorrect, swipe, learning, typed-text field, pad remap or log; Esc/Ctrl/Alt stay",
    { out, state, sw },
  );
  await page.close();
}

async function consent() {
  let { page } = await fresh({ consent: false });
  let h = helpers(page);
  await settle(page);
  const card = await h.F(() => ({
    open: !!document.querySelector(".osk-set"),
    text: document.querySelector(".osk-set")?.innerText ?? "",
    on: !!document.querySelector('[data-key="OSKSet_consent_on"]'),
    off: !!document.querySelector('[data-key="OSKSet_consent_off"]'),
    learn: window.__oskTrackpadFix.settings.consent,
  }));
  const effBefore = await h.F(() => window.__oskTrackpadFix.effective?.("learn"));
  await h.tap("OSKSet_consent_off");
  await settle(page);
  const s1 = await h.F(() => window.__oskTrackpadFix.settings);
  await h.tap(" ");
  await h.word("zqvxplor");
  await h.word("zqvxplor");
  const echo = await h.F(() => {
    const e = document.querySelector(".osk-echo");
    return !!e && !e.hidden;
  });
  const known = await h.F(() => window.__oskEngine.known("zqvxplor"));
  const saved = JSON.parse((await h.F(() => window.__oskTrackpadFix.takeUserWords())) ?? "{}").settings;
  check(
    card.open &&
      (card.text.match(/VaporType/g) ?? []).length === 1 &&
      /B: later/.test(card.text) &&
      /VaporType can learn words you type and show what you typed above the keys\. Both stay on this Deck\./.test(card.text) &&
      card.on &&
      card.off &&
      effBefore === false &&
      s1.consent === true &&
      s1.learn === false &&
      s1.echo === false &&
      !echo &&
      !known &&
      saved?.consent === true,
    "first use: consent card; Keep off by pad leaves learning and the typed-text field off, and the answer is saved",
    { card, effBefore, s1: { consent: s1.consent, learn: s1.learn, echo: s1.echo }, echo, known },
  );
  await page.close();

  ({ page } = await fresh({ consent: false }));
  h = helpers(page);
  await settle(page);
  const path = [];
  for (let i = 0; i < 6; i++) {
    const f = await h.F(() => window.__oskTrackpadFix.panel.focus);
    path.push(f);
    if (f === "OSKSet_consent_on") break;
    await h.vgp("vgp_onbuttondown", f ? 11 : 10);
    await h.vgp("vgp_onbuttonup", f ? 11 : 10);
  }
  await h.vgp("vgp_onbuttondown", 1);
  await h.vgp("vgp_onbuttonup", 1);
  await settle(page);
  const s2 = await h.F(() => ({ ...window.__oskTrackpadFix.settings, open: !!document.querySelector(".osk-set") }));
  check(
    s2.consent === true && s2.learn === true && s2.echo === true && !s2.open,
    "Turn on with the D-pad and A turns learning and the typed-text field on and closes the card",
    { path, s2: { consent: s2.consent, learn: s2.learn, echo: s2.echo, open: s2.open } },
  );
  await page.close();

  ({ page } = await fresh({
    consent: false,
    userWords: { version: 1, words: {}, bigrams: {}, settings: { autocorrect: false, echo: false } },
  }));
  h = helpers(page);
  await settle(page);
  const s3 = await h.F(() => ({ ...window.__oskTrackpadFix.settings, open: !!document.querySelector(".osk-set") }));
  check(
    s3.consent === true && s3.autocorrect === false && s3.echo === false && s3.learn === true && !s3.open,
    "an existing user with saved settings gets no card and keeps the settings",
    { s3: { consent: s3.consent, autocorrect: s3.autocorrect, echo: s3.echo, learn: s3.learn, open: s3.open } },
  );
  await page.close();
}

async function naming() {
  const { page } = await fresh();
  const h = helpers(page);
  await h.F(() => window.__oskTrackpadFix.openSettings());
  await settle(page);
  await h.tap("OSKSet_tab_system");
  const v = await h.F(() => ({
    line: document.querySelector(".osk-set-version")?.textContent,
    title: document.querySelector(".osk-set-title")?.textContent,
  }));
  check(
    /^VaporType v30 · engine v\d+ · words v\d+ · pairs v\d+ · modes v\d+ · installed 2026-10-23$/.test(v.line ?? "") &&
      v.title === "VaporType",
    "the panel says VaporType: title and version line",
    v,
  );
  await page.close();
}

async function typingLogOff() {
  const { page } = await fresh();
  const h = helpers(page);
  const def = await h.F(() => window.__oskTrackpadFix.settings.typingLog);
  for (const w of ["hello", "secret", "world"]) await h.word(w);
  await h.F(() => window.__oskTrackpadFix.flushLog());
  const open = await h.F(() => ({
    log: window.__oskTrackpadFix.takeTypingLog(),
    kept: window.__oskTrackpadFix.typingLog.out.length,
    open: window.__oskTrackpadFix.keyboardOpen(),
  }));
  await h.F(() => window.__sim.vkm.SetVirtualKeyboardHidden());
  await settle(page);
  const closed = await h.F(() => window.__oskTrackpadFix.keyboardOpen());
  check(
    def === false && open.log === null && open.kept === 0 && open.open === true && closed === false,
    "the typing log is off by default and keeps nothing typed; keyboardOpen() follows the keyboard",
    { def, ...open, closed },
  );
  await page.close();
}

const blocks = [privateBoundary, enterEnded, forgetProtocol, otherLayout, consent, naming, typingLogOff];
const guard = (f) =>
  f().catch((e) =>
    check(
      false,
      `${f.name} threw`,
      String(e.stack ?? e)
        .split("\n")
        .slice(0, 2)
        .join(" "),
    ),
  );
if (!process.env.PARALLEL) for (const f of blocks) await guard(f);
else await Promise.all(blocks.map(guard));
console.log(results.join("\n"));
console.log(failures ? `${failures} FAILED` : "ALL PASS");
await browser.close();
process.exit(failures ? 1 : 0);
