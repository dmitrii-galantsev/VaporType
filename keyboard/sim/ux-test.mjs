import { openSim, inject, settle } from "./run.mjs";
import { readRuntime as read } from "../runtime.mjs";
import { lum, makeCheck, pageHelpers, sleep } from "./helpers.mjs";

const { browser, page, errors } = await openSim();
let failures = 0;
const results = [];
const check = makeCheck(
  (line) => results.push(line),
  () => failures++,
);

await page.evaluate(["swipe/words.js", "swipe/lm.js", "swipe/engine.js", "modes.js"].map(read).join("\n;\n"));
await page.evaluate(() => {
  window.__oskUserWords = null;
  window.localStorage.clear();
});
results.push(`inject: ${await inject(page, read("patch.js"))}`);

const F = (fn, ...a) => page.evaluate(fn, ...a);
const { kbEval, center, vgp, padAt, padIdle, labels } = pageHelpers(page);
const BTN = { L: 20, R: 22 };
async function tap(key, side = "R", hold = 20) {
  const c = await center(key);
  await padAt(side, c.x, c.y);
  await vgp("vgp_onbuttondown", BTN[side]);
  await sleep(hold);
  await vgp("vgp_onbuttonup", BTN[side]);
  await padIdle(side);
  await settle(page, { quiet: 0, join: false });
}
async function stroke(side, letters) {
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
}
const text = async () =>
  (await settle(page), await F(() => window.__keyLog.filter(([, k]) => k === "text").map(([, , v]) => v)))
    .map((v) => (v === "\u0002" ? "⌫" : v === "\u0001" ? "⏎" : v))
    .join("");
const clear = async () => {
  await settle(page);
  await F(() => {
    window.__keyLog.length = 0;
  });
};
const current = () =>
  F(() => [0, 1, 2].findIndex((i) => document.querySelector(`[data-key="OSKSug_${i}"]`)?.classList.contains("osk-sug-current")));
const ratio = (a, b) => {
  const x = lum(a),
    y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const rgb = (s) =>
  s
    .match(/\d+(\.\d+)?/g)
    .slice(0, 3)
    .map(Number);

const tip = await F(() => ({
  text: document.querySelector(".osk-toast")?.textContent ?? "",
  flag: window.__oskTrackpadFix.settings.tipShown,
}));
await tap("h");
const tipGone = await F(() => !document.querySelector(".osk-toast"));
await F(() => {
  window.__sim.vkm.SetVirtualKeyboardHidden();
  window.__oskTrackpadFix.tickNow();
  window.__sim.vkm.SetVirtualKeyboardVisible();
});
await page.waitForSelector('[data-key="Escape"]');
await F(() => window.__oskTrackpadFix.tickNow());
const tipAgain = await F(() => !!document.querySelector(".osk-toast"));
check(
  /settings/.test(tip.text) && /slide/.test(tip.text) && /Swipe/.test(tip.text) && tip.flag === true && tipGone && !tipAgain,
  "first-run tip lists the hints, hides on a key press and does not come back",
  { tip, tipGone, tipAgain },
);

await tap("Enter");
await tap(" ");
await clear();
for (const k of "teh") await tap(k);
await tap(" ");
check((await text()) === "teh⌫⌫⌫the ", "space autocorrect still fixes 'teh ' to 'the ' (correct() with final: true)", await text());

await tap("Enter");
await tap(" ");
await clear();
for (const k of "dont") await tap(k);
const midCurrent = await current();
const midLabels = await labels();
await tap(" ");
await settle(page);
const after = {
  sent: await text(),
  labels: await labels(),
  current: await current(),
  mark: await F(() => document.querySelector(".osk-echo-mark")?.textContent ?? null),
};
await sleep(1700);
const markLater = await F(() => document.querySelector(".osk-echo-mark")?.textContent ?? null);
check(
  midCurrent === 1 &&
    /don't/i.test(midLabels[1] ?? "") &&
    after.sent === "dont⌫⌫⌫⌫don't " &&
    after.labels[0] === "↶ dont" &&
    after.current === -1 &&
    after.mark === "don't" &&
    markLater === null,
  "autocorrect: the target chip is filled while typing, the corrected word is marked in the field for 1.5 s, the left chip offers ↶ undo, predictions are not filled",
  { midCurrent, midLabels, after, markLater },
);
await clear();
await tap("OSKSug_0", "L");
check((await text()) === "⌫⌫⌫⌫⌫⌫dont ", "picking ↶ dont puts the typed word back with its space", await text());
await tap("Enter");
await tap(" ");
await clear();
for (const k of "teh") await tap(k);
await tap(" ");
await tap("Backspace");
check((await text()) === "teh⌫⌫⌫the ⌫⌫⌫⌫teh", "Backspace right after autocorrect still restores the typed word", await text());

await tap("Enter");
await tap(" ");
await stroke("L", "the");
const swipeCur = await current();
const swipeLabels = await labels();
const word = swipeLabels[0];
const c0 = await center("OSKSug_0");
await padAt("R", c0.x, c0.y);
await vgp("vgp_onbuttondown", BTN.R);
await sleep(650);
await vgp("vgp_onbuttonup", BTN.R);
await padIdle("R");
await settle(page);
const note = { labels: await labels(), blocked: await F((w) => window.__oskTrackpadFix.blocked.has(w.toLowerCase()), word) };
await tap("OSKSug_0", "R");
const undone = { blocked: await F((w) => window.__oskTrackpadFix.blocked.has(w.toLowerCase()), word), labels: await labels() };
check(
  swipeCur === 1 &&
    note.labels[0] === `blocked: ${word} · tap to undo` &&
    note.blocked &&
    !undone.blocked &&
    undone.labels[0] !== note.labels[0],
  "the swiped word's chip is filled; holding a chip blocks it with 'blocked: word · tap to undo', tapping that unblocks",
  { swipeCur, swipeLabels, note, undone },
);

await tap("Enter");
await tap(" ");
for (const k of "zqxv") await tap(k);
const addLabel = (await labels())[0];
await tap("OSKSug_0", "L");
await settle(page);
const addedLabel = (await labels())[0];
await sleep(2200);
const addedLater = (await labels())[0];
await tap("Enter");
check(
  addLabel === "+ add zqxv" &&
    addedLabel === "added: zqxv" &&
    addedLater !== addedLabel &&
    (await F(() => window.__oskEngine.known("zqxv"))),
  "a new word offers '+ add word'; picking it confirms 'added: word' for about 2 s",
  { addLabel, addedLabel, addedLater },
);

await F(() => {
  window.__oskTrackpadFix.setSetting("tipShown", false);
  window.__oskTrackpadFix.tickNow();
});
const tip2 = await F(() => ({
  shown: !!document.querySelector(".osk-toast"),
  gear: !!document.querySelector(".osk-toast .osk-gear"),
  emoji: /⚙/.test(document.querySelector(".osk-toast")?.textContent ?? ""),
}));
await F(() => window.__oskTrackpadFix.openSettings());
const tipUnderPanel = await F(() => !!document.querySelector(".osk-toast"));
const panelInfo = await F(() => {
  const foot = !!document.querySelector(".osk-set-foot .osk-set-version");
  document.querySelector('[data-key="OSKSet_tab_system"]').click();
  const data = document.querySelector(".osk-set-body .osk-set-version")?.textContent ?? "";
  const clear = document.querySelector('[data-key="OSKSet_clear_log"]')?.className ?? "";
  return { foot, data, clear };
});
await F(() => window.__oskTrackpadFix.closeSettings());
check(
  tip2.shown &&
    tip2.gear &&
    !tip2.emoji &&
    !tipUnderPanel &&
    !panelInfo.foot &&
    /^VaporType v30/.test(panelInfo.data) &&
    /osk-set-disabled/.test(panelInfo.clear),
  "the tip uses the gear icon and closes when the panel opens; the version line sits in System, not the footer; Clear typing log is greyed out with the log off and empty",
  { tip2, tipUnderPanel, panelInfo },
);

const rowBg = [];
for (const o of [100, 40, 0]) {
  await F((o) => window.__oskTrackpadFix.setSetting("boardAlpha", o), o);
  await F((o) => window.__oskTrackpadFix.setSetting("stripAlpha", o), [100, 90, 50][rowBg.length]);
  await settle(page);
  rowBg.push(
    await F(() => {
      let e = document.querySelector('[data-key="OSKSug_0"]').parentElement;
      while (e && !e.getBoundingClientRect().width) e = e.parentElement;
      const c = getComputedStyle(e).backgroundColor;
      const m = c.match(/[\d.]+/g).map(Number);
      return m.length > 3 ? m[3] : 1;
    }),
  );
}
await F(() => {
  window.__oskTrackpadFix.setSetting("boardAlpha", 40);
  window.__oskTrackpadFix.setSetting("stripAlpha", 90);
});
const caps = await F(() => getComputedStyle(document.querySelector('[data-key="CapsLock"] img')).transform);
check(
  JSON.stringify(rowBg) === JSON.stringify([1, 0.9, 0.5]) && /matrix\(0\.62/.test(caps),
  "the top strip (typed text and suggestions) follows its own alpha, not the board's; the L3 glyph on Caps is smaller",
  { rowBg, caps },
);

const em = await center("SwitchKeys_Steam");
await padAt("L", em.x, em.y);
await vgp("vgp_onbuttondown", BTN.L);
await sleep(200);
const ring = await F(() => document.querySelector('[data-key="SwitchKeys_Steam"]').classList.contains("osk-holding"));
await sleep(450);
const opened = await F(() => !!document.querySelector(".osk-set"));
await vgp("vgp_onbuttonup", BTN.L);
await padIdle("L");
const badge = await F(() => getComputedStyle(document.querySelector('[data-key="SwitchKeys_Steam"]'), "::after").backgroundImage);
const focusA = await (async () => {
  await F(() => window.__oskTrackpadFix.closeSettings());
  await settle(page);
  await F(() => {
    const el = document.querySelector('[data-key="SwitchKeys_Steam"]');
    el.dispatchEvent(
      new CustomEvent("vgp_onbuttondown", { bubbles: true, cancelable: true, detail: { button: 1, source: 1, is_repeat: false } }),
    );
  });
  await sleep(650);
  await F(() => {
    const el = document.querySelector('[data-key="SwitchKeys_Steam"]');
    el.dispatchEvent(
      new CustomEvent("vgp_onbuttonup", { bubbles: true, cancelable: true, detail: { button: 1, source: 1, is_repeat: false } }),
    );
  });
  return F(() => window.__oskTrackpadFix.panel.focus);
})();
check(focusA === "OSKSet_c_mode", "an A-hold opens the panel with the focus frame on the first control", focusA);
check(ring && opened && /svg/.test(badge), "emoji key has a ⚙ corner badge and a filling ring while held, then opens settings", {
  ring,
  opened,
  badge,
});

const panel = await F(() => ({
  tabs: [...document.querySelectorAll('.osk-set [data-key^="OSKSet_tab_"] .osk-set-tab-label')].map((e) => e.textContent),
  first: document.querySelector(".osk-set-page.on [data-key]")?.getAttribute("data-key"),
  tabStyle: (() => {
    const t = document.querySelector(".osk-set-tab.on");
    return [getComputedStyle(t).backgroundColor, getComputedStyle(t, "::after").backgroundColor];
  })(),
  edges: [...document.querySelectorAll(".osk-set [data-key]")]
    .filter((e) => {
      if (e.classList.contains("osk-set-focus")) return false;
      const cs = getComputedStyle(e);
      return (
        cs.boxShadow !== "none" ||
        cs.outlineStyle !== "none" ||
        (parseFloat(cs.borderTopWidth) > 0 && !/rgba\(0, 0, 0, 0\)/.test(cs.borderTopColor))
      );
    })
    .map((e) => e.getAttribute("data-key")),
  fonts: (() => {
    const size = (sel) =>
      Math.min(...[...document.querySelectorAll(`.osk-set-page.on ${sel}`)].map((e) => parseFloat(getComputedStyle(e).fontSize)));
    return {
      label: size(".osk-set-label"),
      desc: size(".osk-set-desc"),
      seg: size(".osk-set-segbtn"),
      tab: parseFloat(getComputedStyle(document.querySelector(".osk-set-tab")).fontSize),
    };
  })(),
  footFont: Math.min(
    ...[...document.querySelectorAll(".osk-set-foot *")]
      .filter((e) => e.children.length === 0 && e.textContent.trim() && e.getClientRects().length)
      .map((e) => parseFloat(getComputedStyle(e).fontSize)),
  ),
  pill: (() => {
    const v = document.querySelector(".osk-set-toggle.on .osk-set-switch");
    return [getComputedStyle(v).backgroundColor, getComputedStyle(v, "::after").backgroundColor];
  })(),
}));
await F(() => {
  const P = window.__oskTrackpadFix.panel;
  P.focus = "OSKSet_t_swipe";
});
await vgp("vgp_onbuttondown", 10);
await vgp("vgp_onbuttonup", 10);
const focus = await F(() => {
  const f = [...document.querySelectorAll(".osk-set-focus")];
  return f.length === 1
    ? [
        f[0].getAttribute("data-key"),
        getComputedStyle(f[0]).backgroundColor,
        getComputedStyle(document.querySelector(".osk-set-tab.on")).backgroundColor,
        getComputedStyle(f[0]).outlineStyle,
        getComputedStyle(f[0]).outlineColor,
      ]
    : null;
});
await F(() => document.querySelector('[data-key="OSKSet_tab_system"]').click());
const danger = await F(() => !!document.querySelector('.osk-set-page.on [data-key="OSKSet_forget_all"].osk-set-danger'));
await F(() => window.__oskTrackpadFix.closeSettings());
check(
  panel.tabs.join("|") === "Typing|Input|Look|Words|System" &&
    panel.first === "OSKSet_c_mode" &&
    panel.tabStyle[1] === "rgb(74, 168, 255)" &&
    panel.edges.length === 0 &&
    panel.fonts.label >= 16 &&
    panel.fonts.desc >= 13 &&
    panel.fonts.seg >= 15 &&
    panel.fonts.tab >= 16 &&
    panel.footFont >= 12 &&
    ratio(rgb(panel.pill[0]), rgb(panel.pill[1])) >= 3 &&
    focus?.[0] === "OSKSet_t_autocorrect" &&
    focus[1] !== focus[2] &&
    focus[3] === "solid" &&
    focus[4] === "rgb(74, 168, 255)" &&
    danger,
  "panel: five tabs with Typing mode first, the active tab has a blue underline, one blue focus ring and no other outline or edge, labels ≥ 16 px and descriptions ≥ 13 px, switch knob ≥ 3:1 on its track, Forget everything is a red danger row",
  { panel, focus, danger, pillRatio: ratio(rgb(panel.pill[0]), rgb(panel.pill[1])).toFixed(2) },
);

const sizes = await F(() => {
  const f = (k, sel = "span") =>
    Math.max(
      ...[...document.querySelector(`[data-key="${k}"]`).querySelectorAll(sel)].map((e) => parseFloat(getComputedStyle(e).fontSize)),
    );
  const icon = (k) => getComputedStyle(document.querySelector(`[data-key="${k}"] > * > span`), "::after").content;
  return {
    a: f("a"),
    m: f("m"),
    tab: f("Tab"),
    ctrl: f("Control"),
    icons: ["Backspace", "Enter", "Shift"].map(icon),
    lb: getComputedStyle(document.querySelector('[data-key="Control"]'), "::after").content,
  };
});
check(
  sizes.a >= 20 && sizes.m >= 20 && sizes.tab >= 14 && sizes.ctrl >= 14 && sizes.icons.join("") === '"⌫""⏎""⇧"' && sizes.lb === '"LB"',
  "letter labels ≥ 20 px, modifier labels ≥ 14 px, ⌫ ⏎ ⇧ icons, LB badge on Ctrl",
  sizes,
);

await kbEval((kb) => kb.setState((s) => ({ ...s, toggleStates: { ...s.toggleStates, Shift: 2 } })));
await settle(page);
await sleep(150);
const shift = await F(() => {
  const k = document.querySelector('[data-key="Shift"]').firstElementChild;
  return [getComputedStyle(k).backgroundColor, getComputedStyle(k.querySelector("span")).color];
});
await kbEval((kb) => kb.setState((s) => ({ ...s, toggleStates: { ...s.toggleStates, Shift: 0 } })));
check(ratio(rgb(shift[0]), rgb(shift[1])) >= 4.5, "locked Shift: white on blue ≥ 4.5:1", {
  shift,
  r: ratio(rgb(shift[0]), rgb(shift[1])).toFixed(2),
});

const sp = await center(" ");
await padAt("L", sp.x + 60, sp.y);
await vgp("vgp_onbuttondown", BTN.L);
for (let i = 1; i <= 6; i++) {
  await padAt("L", sp.x + 60 - i * 15, sp.y);
  await sleep(20);
}
const sliding = await F(() => [
  document.querySelector('[data-key=" "]').classList.contains("osk-sliding"),
  getComputedStyle(document.querySelector('[data-key=" "]'), "::after").content,
]);
for (let i = 1; i <= 8; i++) {
  await padAt("L", sp.x + 60 - 90 + i * 15, sp.y);
  await sleep(20);
}
const slidingRight = await F(() => getComputedStyle(document.querySelector('[data-key=" "]'), "::after").content);
await vgp("vgp_onbuttonup", BTN.L);
await padIdle("L");
await settle(page);
const slidingAfter = await F(() => document.querySelector('[data-key=" "]').classList.contains("osk-sliding"));
check(
  sliding[0] && sliding[1] === '"◂  cursor"' && slidingRight === '"cursor  ▸"' && !slidingAfter,
  "space bar shows ◂ cursor while sliding left and cursor ▸ while sliding right",
  { sliding, slidingRight, slidingAfter },
);

const gear = await F(() => {
  const cs = getComputedStyle(document.querySelector('[data-key="SwitchKeys_Steam"]'), "::after");
  return [parseFloat(cs.width), cs.backgroundColor];
});
const emo = await center("SwitchKeys_Steam");
await padAt("L", emo.x, emo.y);
await vgp("vgp_onbuttondown", BTN.L);
await sleep(650);
await vgp("vgp_onbuttonup", BTN.L);
await padIdle("L");
const padFocus = await F(() => window.__oskTrackpadFix.panel.focus);
await vgp("vgp_onbuttondown", 10);
await vgp("vgp_onbuttonup", 10);
const padFocus2 = await F(() => window.__oskTrackpadFix.panel.focus);
await F(() => window.__oskTrackpadFix.closeSettings());
check(
  gear[0] >= 14 && !/rgba\(0, 0, 0, 0\)/.test(gear[1]) && padFocus === "OSKSet_c_mode" && padFocus2 === "OSKSet_t_swipe",
  "gear badge ≥ 14 px on a dark backing; a pad hold opens the panel focused on the first control and the D-pad moves from there",
  { gear, padFocus, padFocus2 },
);

const accents = await F(() => {
  const out = [];
  for (const el of document.querySelectorAll("[data-key]")) {
    const k = el.firstElementChild;
    if (!k) continue;
    const cs = getComputedStyle(k);
    if (cs.boxShadow !== "none" || cs.outlineStyle !== "none") out.push(el.getAttribute("data-key"));
  }
  const e = document.querySelector(".osk-echo.row");
  if (e && getComputedStyle(e).boxShadow !== "none") out.push("echo");
  return out;
});
check(accents.length === 0, "no outline, ring or edge shadow on any key, chip or the typed-text field", accents);

const badges = [];
for (const [mode, reach] of [
  ["standard", 55],
  ["bigkeys", 55],
  ["bigkeys", "right"],
  ["standard", "right"],
]) {
  await F(
    (m, r) => {
      window.__oskTrackpadFix.setSetting("mode", m);
      window.__oskTrackpadFix.setSetting("reach", r);
    },
    mode,
    reach,
  );
  await settle(page);
  badges.push(
    await F(() => {
      const b = document.querySelector(".osk-badge");
      return b && !b.hidden ? b.textContent : "";
    }),
  );
}
await F(() => window.__oskTrackpadFix.setSetting("reach", 55));
await settle(page);
const overlap = await F(() => {
  const b = document.querySelector(".osk-badge").getBoundingClientRect();
  const e = document.querySelector(".osk-echo").getBoundingClientRect();
  return b.left < e.right - 1;
});
await F(() => window.__oskTrackpadFix.setSetting("mode", "bigkeys"));
check(
  JSON.stringify(badges) === JSON.stringify(["Standard", "", "1-thumb", "Standard · 1-thumb"]) && !overlap,
  "mode badge only for a non-default mode or Right pad only, outside the typed text",
  { badges, overlap },
);

const oldOpacity = await F(() => window.__oskTrackpadFix.setSetting("opacity", 70));
const sliders = await F(() => {
  window.__oskTrackpadFix.openSettings();
  document.querySelector('[data-key="OSKSet_tab_look"]').click();
  const o = [...document.querySelectorAll('.osk-set-page.on [role="slider"]')].map((e) => [
    e.getAttribute("aria-label"),
    e.getAttribute("aria-valuetext"),
  ]);
  const old = !!document.querySelector('[data-key="OSKSet_c_opacity"]');
  const glass = [...document.querySelectorAll('.osk-set-page.on [data-key="OSKSet_c_blur"] .osk-set-segbtn')].map((e) => e.textContent);
  window.__oskTrackpadFix.closeSettings();
  return { o, old, glass };
});
check(
  !oldOpacity &&
    !sliders.old &&
    sliders.o.map(([l]) => l).join() === "Keyboard background,Keys,Space bar,Top strip" &&
    sliders.glass.join() === "Off,Light,Strong",
  "the Look tab has background, key, space-bar and top-strip sliders, an Off / Light / Strong glass choice and no old opacity setting",
  { oldOpacity, sliders },
);

const errs = errors.filter(
  (e) => !/404|Transport|passive event listener|cancel a touchend|activeOutputDeviceId|AddOnDisconnectCallback|PushState|PopState/.test(e),
);
check(errs.length === 0, "no page errors", errs.slice(0, 3));
console.log(results.join("\n"));
console.log(failures ? `${failures} FAILED` : "ALL PASS");
await browser.close();
process.exit(failures ? 1 : 0);
