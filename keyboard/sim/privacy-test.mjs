import puppeteer from "puppeteer-core";
import { openSim, inject, settle, waitKeyboard } from "./run.mjs";
import { keyboardVersion, readRuntime as read } from "../runtime.mjs";
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

const logRecs = async (h) => {
  await h.F(() => window.__oskTrackpadFix.flushLog());
  const raw = await h.F(() => window.__oskTrackpadFix.takeTypingLog());
  return JSON.parse(raw ?? '{"lines":[]}')
    .lines.map((l) => JSON.parse(l))
    .filter((r) => r.type === "word" || r.type === "line")
    .map((r) => (r.type === "line" ? "line" : `${r.committed}:${r.how}${r.lone ? ":lone" : ""}${r.prev ? `<${r.prev}` : ""}`));
};

async function enterEnded() {
  const { page } = await fresh();
  const h = helpers(page);
  await h.tap(" ");
  const before = await h.user();
  await h.word("hello", "Enter");
  await h.word("hello", "Enter");
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
    "a lone word ended by Enter (known word, repeated password-like word) and a word left in the buffer when the keyboard closes are not learned",
    { diff, bdiff },
  );
  await page.close();
}

async function enterLine() {
  const { page } = await fresh();
  const h = helpers(page);
  await h.set("typingLog", true);
  await h.tap(" ");
  const before = await h.user();
  await h.word("hello", "Enter");
  await h.word("hello", "Enter");
  for (let i = 0; i < 3; i++) await h.word("zqvxplor", "Enter");
  const lone = await logRecs(h);
  const after = await h.user();
  const diff = Object.keys(after.words).filter((k) => JSON.stringify(after.words[k]) !== JSON.stringify(before.words[k]));
  const bdiff = Object.keys(after.bigrams).filter((k) => after.bigrams[k] !== before.bigrams[k]);
  check(
    JSON.stringify(lone) === JSON.stringify(["hello:enter:lone", "hello:enter:lone", "line"]) &&
      diff.length === 0 &&
      bdiff.length === 0 &&
      !(await h.F(() => window.__oskEngine.known("zqvxplor"))),
    "lone words ended by Enter: a known word is logged with lone and not learned, an unknown word is neither logged nor learned, one line marker and never two in a row",
    { lone, diff, bdiff },
  );
  await page.close();
}

async function enterLast() {
  const { page } = await fresh();
  const h = helpers(page);
  await h.set("typingLog", true);
  await h.tap(" ");
  await h.word("good");
  await h.word("morning", "Enter");
  await h.word("good");
  await h.word("blorptank", "Enter");
  const k1 = await h.F(() => window.__oskEngine.known("blorptank"));
  await h.word("good");
  await h.word("blorptank", "Enter");
  const k2 = await h.F(() => window.__oskEngine.known("blorptank"));
  const recs = await logRecs(h);
  const u = await h.user();
  check(
    JSON.stringify(recs.slice(0, 2)) === JSON.stringify(["good:space", "morning:enter<good"]) &&
      recs.includes("blorptank:enter<good") &&
      !recs.includes("line") &&
      !!u.bigrams["good morning"],
    "the last word of a line ended by Enter is logged with its previous word and learned with its pair",
    { recs, bigrams: Object.keys(u.bigrams) },
  );
  check(!k1 && k2, "an unknown last word of a line is learned on its second use, like a word ended by space", { k1, k2 });
  await page.close();
}

async function stopEnded() {
  const { page } = await fresh();
  const h = helpers(page);
  await h.set("typingLog", true);
  await h.tap(" ");
  await h.word("are");
  await h.word("you", ".");
  await h.word("now");
  const recs = await logRecs(h);
  const u = await h.user();
  check(
    JSON.stringify(recs) === JSON.stringify(["are:space", "you:stop<are", "now:space"]) && !!u.bigrams["are you"] && !u.bigrams["you now"],
    "a word ended by a full stop is logged with how stop and learned with its pair, and the next word has no pair with it",
    { recs, bigrams: Object.keys(u.bigrams) },
  );
  await page.close();
}

async function staleLine() {
  const { page } = await fresh();
  const h = helpers(page);
  await h.set("typingLog", true);
  await h.tap(" ");
  await h.word("good", ".");
  await h.F(() => {
    window.__oskTrackpadFix.tracker.at = performance.now() - 60000;
  });
  await h.word("zqvxplor", "Enter");
  const recs = await logRecs(h);
  check(
    recs.join() === "good:stop,line" && !(await h.F(() => window.__oskEngine.known("zqvxplor"))),
    "after a pause the line starts over: a word typed alone then is a lone word even if a full stop ended the one before",
    { recs },
  );
  await page.close();
}

async function lineMarker() {
  const { page } = await fresh();
  const h = helpers(page);
  await h.set("typingLog", true);
  await h.tap(" ");
  await h.word("good");
  await h.word("morning");
  await h.tap("Enter");
  await h.tap("Enter");
  await h.tap("Enter");
  await h.word("good", "Enter");
  await h.word("zq", "Enter");
  await h.word("zq", "Enter");
  const recs = await logRecs(h);
  check(
    JSON.stringify(recs) === JSON.stringify(["good:space", "morning:space<good", "line", "good:enter:lone", "line"]),
    "Enter after typing that left no word record writes one line marker; Enter on an empty line or right after a marker writes none",
    { recs },
  );
  await h.F(() => {
    window.__sim.vkm.SetVirtualKeyboardHidden();
    window.__oskTrackpadFix.tickNow();
    window.__sim.vkm.SetVirtualKeyboardVisible();
  });
  await waitKeyboard(page);
  await h.word("good", null);
  await h.F(() => {
    window.__sim.vkm.SetVirtualKeyboardHidden();
    window.__oskTrackpadFix.tickNow();
    window.__sim.vkm.SetVirtualKeyboardVisible();
  });
  await waitKeyboard(page);
  const closed = await logRecs(h);
  check(closed.length === recs.length, "a word left in the buffer when the keyboard closes is not logged", { closed });
  await page.close();
}

async function enterPrivate() {
  const { page } = await fresh();
  const h = helpers(page);
  await h.set("typingLog", true);
  await h.tap(" ");
  await h.set("privateMode", true);
  await h.word("good morning", "Enter");
  await h.word("hello", "Enter");
  await h.word("good", ".");
  await h.set("privateMode", false);
  const recs = await logRecs(h);
  const u = await h.user();
  check(
    recs.length === 0 && !u.bigrams["good morning"] && !u.bigrams["morning hello"],
    "private mode logs and learns nothing for words ended by Enter or a full stop",
    { recs, bigrams: Object.keys(u.bigrams) },
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
    focus: window.__oskTrackpadFix.panel.focus,
    echo: window.__oskTrackpadFix.settings.echo,
  }));
  const effBefore = await h.F(() => window.__oskTrackpadFix.effective?.("learn"));
  await h.vgp("vgp_onbuttondown", 1);
  await h.vgp("vgp_onbuttonup", 1);
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
      /Learn the words you type\? VaporType can remember new words and the words you often type together, to suggest them\. They stay on this Deck\./.test(
        card.text,
      ) &&
      /Learn my words/.test(card.text) &&
      /Don't learn/.test(card.text) &&
      !/typed text|above the keys/.test(card.text) &&
      card.focus === "OSKSet_consent_off" &&
      card.echo === false &&
      card.on &&
      card.off &&
      effBefore === false &&
      s1.consent === true &&
      s1.learn === false &&
      s1.echo === false &&
      !echo &&
      !known &&
      saved?.consent === true,
    "first use: the card asks only about learning with Don't learn focused; A there leaves learning and the typed-text field off, and the answer is saved",
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
    path[0] === "OSKSet_consent_off" &&
      path.at(-1) === "OSKSet_consent_on" &&
      s2.consent === true &&
      s2.learn === true &&
      s2.echo === false &&
      !s2.open,
    "Learn my words, reached with the D-pad and pressed with A, turns learning on (the typed-text field stays off) and closes the card",
    { path, s2: { consent: s2.consent, learn: s2.learn, echo: s2.echo, open: s2.open } },
  );
  await page.close();

  ({ page } = await fresh({
    consent: false,
    userWords: {
      version: 1,
      words: {},
      bigrams: {},
      settings: { autocorrect: false, echo: true, learn: true, boardAlpha: 40, stripAlpha: 90 },
    },
  }));
  h = helpers(page);
  await settle(page);
  const s3 = await h.F(() => ({ ...window.__oskTrackpadFix.settings, open: !!document.querySelector(".osk-set") }));
  check(
    s3.consent === true &&
      s3.autocorrect === false &&
      s3.echo === true &&
      s3.learn === true &&
      s3.boardAlpha === 40 &&
      s3.stripAlpha === 90 &&
      !s3.open,
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
    title: document.querySelector(".osk-set-title")?.textContent ?? null,
  }));
  check(
    new RegExp(`^VaporType v${keyboardVersion()} · engine v\\d+ · words v\\d+ · pairs v\\d+ · modes v\\d+ · installed 2026-10-23$`).test(
      v.line ?? "",
    ) && v.title === null,
    "the panel says VaporType in the version line and has no wordmark",
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

async function backIntoWord() {
  const { page } = await fresh();
  const h = helpers(page);
  await h.set("typingLog", true);
  await h.tap(" ");
  await h.word("good");
  const before = await h.user();
  await h.word("track");
  await h.tap("Backspace");
  await h.word("ed");
  for (let i = 0; i < 2; i++) {
    await h.word("zqvxplorr");
    await h.tap("Backspace");
    await h.tap("Backspace");
    await h.tap(" ");
  }
  await h.word("you", ",");
  await h.tap("Backspace");
  await h.word("r");
  await h.tap("Enter");
  await h.word("hell");
  await h.tap("Backspace");
  await h.word("o");
  await h.F(() => window.__oskTrackpadFix.flushLog());
  const raw = await h.F(() => window.__oskTrackpadFix.takeTypingLog());
  const words = JSON.parse(raw ?? '{"lines":[]}')
    .lines.map((l) => JSON.parse(l))
    .filter((r) => r.type === "word");
  const recs = words.map((r) => `${r.committed}:${r.how}${r.prev ? `<${r.prev}` : ""}`);
  const erased = words.map((r) => (r.erased ?? []).map((e) => e.c).join(""));
  const after = await h.user();
  const known = await h.F(() => [window.__oskEngine.known("zqvxplorr"), window.__oskEngine.known("zqvxplor")]);
  const out = await h.text();
  check(
    JSON.stringify(recs) ===
      JSON.stringify([
        "good:space",
        "tracked:space<good",
        "zqvxplor:space<tracked",
        "zqvxplor:space<zqvxplor",
        "your:space<zqvxplor",
        "hello:space",
      ]) &&
      erased.join() === ",,r,r,," &&
      !after.bigrams["^ hell"] &&
      !!after.bigrams["^ hello"] &&
      after.words.track?.c === before.words.track?.c &&
      after.words.you?.c === before.words.you?.c &&
      !after.bigrams["good track"] &&
      !!after.bigrams["good tracked"] &&
      !known[0] &&
      known[1] &&
      out.endsWith("good track ⌫ed zqvxplorr ⌫⌫ zqvxplorr ⌫⌫ you,⌫r ⏎hell ⌫o "),
    "Backspace over the space or comma after a typed word takes the word back: the letters typed next finish it, and the first ending is neither logged nor learned",
    {
      recs,
      erased,
      track: [before.words.track, after.words.track],
      known,
      starts: Object.keys(after.bigrams).filter((k) => k.startsWith("^")),
      out,
    },
  );
  await page.close();
}

async function geoOnClose() {
  const { page } = await fresh();
  const h = helpers(page);
  await h.set("typingLog", true);
  await h.tap(" ");
  await h.word("good");
  await h.word("morning");
  await h.kbEval((kb) => {
    window.__sim.vkm.SetVirtualKeyboardHidden();
    kb.m_keyboardDiv = null;
    window.__oskTrackpadFix.tickNow();
  });
  await settle(page);
  const raw = await h.F(() => window.__oskTrackpadFix.takeTypingLog());
  const recs = JSON.parse(raw ?? '{"lines":[]}').lines.map((l) => JSON.parse(l));
  const geos = recs.filter((r) => r.type === "geo").map((r) => Object.keys(r.keys ?? {}).length);
  const words = recs.filter((r) => r.type === "word").map((r) => r.committed);
  check(
    words.join() === "good,morning" && geos.length === 1 && geos[0] === 26,
    "a word logged after the keyboard closed gets no empty key geometry record",
    { words, geos },
  );
  await page.close();
}

const blocks = [
  privateBoundary,
  enterEnded,
  enterLine,
  enterLast,
  stopEnded,
  staleLine,
  backIntoWord,
  geoOnClose,
  lineMarker,
  enterPrivate,
  forgetProtocol,
  otherLayout,
  consent,
  naming,
  typingLogOff,
];
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
