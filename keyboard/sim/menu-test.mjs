import fs from "node:fs";
import { openSim, inject, settle, waitKeyboard } from "./run.mjs";
import { readRuntime as read } from "../runtime.mjs";
import { pageHelpers, sleep } from "./helpers.mjs";

const patch = process.env.PATCH ? fs.readFileSync(process.env.PATCH, "utf8") : read("patch.js");
const { browser, page, errors } = await openSim();
let failures = 0;
const results = [];

const A = 1,
  B = 2,
  X = 3,
  Y = 4,
  LB = 5,
  RB = 6,
  LT = 7,
  RT = 8,
  UP = 9,
  DOWN = 10,
  LEFT = 11,
  RIGHT = 12;
const TABS = ["typing", "input", "look", "words", "system"];

await page.evaluate(() => window.localStorage.clear());
await page.evaluate(read("swipe/words.js") + "\n;\n" + read("swipe/engine.js"));
await page.evaluate(() => {
  window.__oskUserWords = null;
});
results.push(`inject: ${await inject(page, patch)}`);
await page.evaluate(() => {
  window.__reached = [];
  for (const t of ["vgp_onbuttondown", "vgp_onbuttonup"])
    document.body.addEventListener(t, (e) => window.__reached.push(`${t === "vgp_onbuttondown" ? "d" : "u"}${e.detail.button}`));
});

const vgp = (type, button, repeat = false) =>
  page.evaluate(
    (type, button, repeat) => {
      (document.querySelector("[data-key]") ?? document.body).dispatchEvent(
        new CustomEvent(type, { bubbles: true, cancelable: true, detail: { button, source: 1, is_repeat: repeat } }),
      );
    },
    type,
    button,
    repeat,
  );
const press = async (button, hold = 10) => {
  await vgp("vgp_onbuttondown", button);
  await sleep(hold);
  await vgp("vgp_onbuttonup", button);
  await sleep(30);
};
const reached = () => page.evaluate(() => window.__reached.slice());
const clearReached = () =>
  page.evaluate(() => {
    window.__reached.length = 0;
  });
const panel = () =>
  page.evaluate(() => {
    const p = window.__oskTrackpadFix.panel;
    const f = document.querySelectorAll(".osk-set-focus");
    const body = document.querySelector(".osk-set-page.on");
    const fe = f[0];
    const visible = (() => {
      if (!fe || !body || !body.contains(fe)) return true;
      const a = fe.getBoundingClientRect(),
        b = body.getBoundingClientRect();
      return a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
    })();
    return {
      open: p.open,
      tab: p.tab,
      page: p.page,
      focus: p.focus,
      held: [...p.held],
      rings: f.length,
      ringOn: fe?.getAttribute("data-key") ?? null,
      visible,
      scroll: body?.scrollTop ?? 0,
      on: document.querySelector(".osk-set-tab.on")?.getAttribute("data-key") ?? null,
    };
  });
const settings = () => page.evaluate(() => ({ ...window.__oskTrackpadFix.settings }));
const { setSetting } = pageHelpers(page);
const openPanel = async () => {
  await page.evaluate(() => window.__oskTrackpadFix.openSettings());
  await settle(page);
};
const closePanel = async () => {
  await page.evaluate(() => window.__oskTrackpadFix.closeSettings());
  await settle(page);
};
const focusTo = async (key, max = 30) => {
  for (let i = 0; i < max; i++) {
    const p = await panel();
    if (p.focus === key) return true;
    await press(DOWN);
  }
  return false;
};
const gotoTab = async (id) => {
  for (let i = 0; i < 6 && (await panel()).tab !== id; i++) await press(RB);
};
const keyState = () =>
  page.evaluate(() => {
    const key = document.querySelector("[data-key]");
    const fk = Object.keys(key).find((k) => k.startsWith("__reactFiber"));
    let kb;
    for (let f = key[fk]; f; f = f.return)
      if (typeof f.stateNode?.HandleTrackpadClick === "function") {
        kb = f.stateNode;
        break;
      }
    const ts = kb.state.toggleStates;
    return {
      ctrl: ts.Control & 7,
      alt: ts.Alt & 7,
      sent: [...window.__oskTrackpadFix.sent.entries()].filter(([, v]) => v).map(([k]) => k),
      bumpers: { ...window.__oskTrackpadFix.bumpers },
    };
  });
const clean = (k) => !k.ctrl && !k.alt && !k.sent.length && !Object.values(k.bumpers).some(Boolean);
const center = (key) =>
  page.evaluate((key) => {
    const e = document.querySelector(`[data-key="${key}"]`);
    e?.scrollIntoView({ block: "nearest" });
    const r = e?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  }, key);
const learn = (words) =>
  page.evaluate((words) => {
    const e = window.__oskEngine;
    for (const [w, n] of words) for (let i = 0; i < n; i++) e.learn(w, null);
  }, words);

async function scenario(title, fn) {
  const e0 = errors.length;
  let ok, detail;
  try {
    const r = await fn();
    ok = r === true || r?.ok === true;
    detail = r?.detail ?? "";
  } catch (e) {
    ok = false;
    detail = String(e.stack ?? e);
  }
  if ((await page.evaluate(() => window.__oskTrackpadFix.panel.open)) && !/keep open/.test(title)) await closePanel();
  const newErr = errors.filter((e, i) => i >= e0 && !/404|Failed to load|Transport|passive event listener|cancel a touchend/.test(e));
  if (!ok || newErr.length) failures++;
  results.push(
    `${ok && !newErr.length ? "PASS" : "FAIL"} ${title}${detail ? `\n      ${detail}` : ""}${newErr.length ? `\n      errors ${newErr.join(" | ")}` : ""}`,
  );
}

await scenario("frame: one 26 px bar of five equal tabs and ✕, two columns split at the pads' middle, footer hints", async () => {
  await openPanel();
  await sleep(300);
  const f = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const tabs = [...document.querySelectorAll('.osk-set [data-key^="OSKSet_tab_"]')];
    const rects = tabs.map((t) => t.getBoundingClientRect());
    const panel = q(".osk-set").getBoundingClientRect();
    const cols = [...document.querySelectorAll(".osk-set-page.on > .osk-set-col")].map((c) => c.getBoundingClientRect());
    const close = q('[data-key="OSKSet_close"]').getBoundingClientRect();
    return {
      head: q(".osk-set-head, .osk-set-title, .osk-set-chips, .osk-set-navhint") === null,
      tabs: tabs.map((t) => t.getAttribute("data-key").replace("OSKSet_tab_", "")),
      oneLine: rects.every((r) => Math.abs(r.top - rects[0].top) < 1 && Math.abs(r.width - rects[0].width) < 1),
      span: Math.round(rects.at(-1).right - rects[0].left + close.width) === Math.round(panel.width),
      icons: tabs.every((t) => !!t.querySelector(".osk-set-ico")),
      bar: q(".osk-set-tabs")?.getBoundingClientRect().height,
      foot: [...(q(".osk-set-foot .osk-set-hint")?.children ?? [])].find((e) => !e.hidden)?.textContent ?? "",
      footH: q(".osk-set-foot")?.getBoundingClientRect().height,
      cols: cols.map((c) => [Math.round(c.left - panel.left), Math.round(c.right - panel.left)]),
      mid: Math.round(panel.width / 2),
      sections: [...document.querySelectorAll(".osk-set-page.on .osk-set-sec")].map((e) => e.textContent),
    };
  });
  const p = await panel();
  const [l, r] = f.cols;
  const ok =
    p.focus === "OSKSet_c_mode" &&
    p.rings === 1 &&
    p.visible &&
    f.head &&
    f.tabs.join() === TABS.join() &&
    f.oneLine &&
    f.span &&
    f.icons &&
    f.bar === 26 &&
    f.footH === 20 &&
    f.foot === "◂ ▸ChangeLB/RBTabsBClose" &&
    f.cols.length === 2 &&
    l[1] <= f.mid &&
    r[0] >= f.mid &&
    f.mid - l[1] <= 8 &&
    r[0] - f.mid <= 8 &&
    f.sections.join() === "Keys,Spelling";
  return { ok, detail: JSON.stringify(f) };
});

await scenario("rows: 12 px label, 10.5 px one-line description under it, control on the right, 36 px", async () => {
  await openPanel();
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll(".osk-set-page.on .osk-set-row")].map((e) => {
      const r = e.getBoundingClientRect();
      const l = e.querySelector(".osk-set-label");
      const d = e.querySelector(".osk-set-desc");
      const ctl = e.querySelector(".osk-set-switch, .osk-set-seg");
      return {
        k: e.getAttribute("data-key"),
        h: Math.round(r.height),
        label: l && parseFloat(getComputedStyle(l).fontSize),
        desc: d && parseFloat(getComputedStyle(d).fontSize),
        under: d && d.getBoundingClientRect().top >= l.getBoundingClientRect().bottom - 1,
        oneLine: d && d.getBoundingClientRect().height < 16,
        right: ctl && r.right - ctl.getBoundingClientRect().right < 12,
      };
    }),
  );
  const bad = rows.filter((r) => r.h !== 36 || r.label !== 12 || r.desc !== 10.5 || !r.under || !r.oneLine || !r.right);
  return { ok: rows.length === 7 && !bad.length, detail: `rows ${rows.length} bad ${JSON.stringify(bad)}` };
});

await scenario("the Words tab counts learned and blocked words, past the 12 shown", async () => {
  const count = () => page.evaluate(() => document.querySelector(".osk-set-tab-count")?.textContent ?? "");
  const total = () => page.evaluate(() => Object.values(window.__oskEngine.exportUser().words).filter((u) => u?.c > 0).length);
  await page.evaluate(() => window.__oskTrackpadFix.forgetAll());
  await learn([["onlyword", 2]]);
  await openPanel();
  await sleep(300);
  const one = await count();
  await closePanel();
  const many = [];
  for (let i = 0; i < 40; i++)
    many.push([`countword${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`, 1]);
  await learn(many);
  await openPanel();
  await sleep(300);
  const lots = await count();
  const n = await total();
  await gotoTab("words");
  const seg = await page.evaluate(() => document.querySelector('[data-key="OSKSet_v_list_0"]')?.textContent);
  const rows = await page.evaluate(() => [...document.querySelectorAll(".osk-set-item")].filter((e) => !e.hidden).length);
  for (const [w] of many) await page.evaluate((w) => window.__oskEngine.forget(w), w);
  await page.evaluate(() => window.__oskEngine.forget("onlyword"));
  return {
    ok: one === "1" && n === 41 && lots === String(n) && seg === `Learned (${n})` && rows === 12,
    detail: `${one} | ${lots} | total ${n} seg ${seg} rows ${rows}`,
  };
});

await scenario("footer hints name what each button does on the focused row, on one 10.5 px line", async () => {
  await learn(Array.from({ length: 20 }, (_, i) => [`hintword${String.fromCharCode(97 + i)}`, 1]));
  await openPanel();
  const hint = () =>
    page.evaluate(() => {
      const h = document.querySelector(".osk-set-hint");
      const set = [...h.children].find((e) => !e.hidden);
      return {
        text: set?.textContent ?? "",
        lines: Math.round(set.getBoundingClientRect().height / parseFloat(getComputedStyle(h).lineHeight)),
        size: parseFloat(getComputedStyle(h).fontSize),
        clipped: h.scrollWidth > h.clientWidth,
      };
    });
  const seg = await hint();
  await press(DOWN);
  const toggle = await hint();
  await gotoTab("look");
  await press(A);
  for (let i = 0; i < 5; i++) await press(DOWN);
  const slider = await hint();
  await gotoTab("words");
  const tab = await hint();
  await press(DOWN);
  await press(DOWN);
  const item = await hint();
  for (let i = 0; i < 20; i++) await page.evaluate((i) => window.__oskEngine.forget(`hintword${String.fromCharCode(97 + i)}`), i);
  const all = [seg, toggle, slider, tab, item];
  const ok =
    seg.text === "◂ ▸ChangeLB/RBTabsBClose" &&
    toggle.text === "AToggleLB/RBTabsBClose" &&
    slider.text === "◂ ▸ChangeLB/RBTabsBClose" &&
    tab.text === "◂ ▸ChangeASelectL2/R2PageLB/RBTabsBClose" &&
    item.text === "AForgetL2/R2PageLB/RBTabsBClose" &&
    all.every((h) => h.lines === 1 && h.size === 10.5 && !h.clipped);
  return { ok, detail: JSON.stringify(all) };
});

await scenario("Look: the preview heads the Opacity column and all four sliders are visible without scrolling", async () => {
  await openPanel();
  await gotoTab("look");
  await press(A);
  const r = await page.evaluate(() => {
    const page = document.querySelector(".osk-set-page.on").getBoundingClientRect();
    const pv = document.querySelector(".osk-set-page.on .osk-set-pv");
    const inside = (e) => {
      const b = e.getBoundingClientRect();
      return b.top >= page.top - 1 && b.bottom <= page.bottom + 1 && b.left >= page.left - 1 && b.right <= page.right + 1;
    };
    return {
      inRow: pv?.parentElement === document.querySelector('[data-key="OSKSet_s_keyAlpha"]')?.parentElement,
      height: pv?.getBoundingClientRect().height,
      wide: pv?.getBoundingClientRect().width === pv?.parentElement.getBoundingClientRect().width,
      sliders: ["boardAlpha", "keyAlpha", "spaceAlpha", "stripAlpha"].map((k) =>
        inside(document.querySelector(`[data-key="OSKSet_s_${k}"]`)),
      ),
      tracks: ["boardAlpha", "keyAlpha", "spaceAlpha", "stripAlpha"].map((k) =>
        inside(document.querySelector(`[data-key="OSKSet_s_${k}"] .osk-set-track`)),
      ),
      scroll: document.querySelector(".osk-set-page.on").scrollTop,
      focus: window.__oskTrackpadFix.panel.focus,
    };
  });
  const ok =
    r.inRow &&
    r.wide &&
    r.height <= 40 &&
    r.sliders.every(Boolean) &&
    r.tracks.every(Boolean) &&
    r.scroll === 0 &&
    r.focus === "OSKSet_c_theme";
  return { ok, detail: JSON.stringify(r) };
});

await scenario("RB steps through all five tabs and wraps; the focus follows the active tab; nothing reaches Steam", async () => {
  await openPanel();
  await clearReached();
  const seen = [(await panel()).tab];
  const focus = [];
  for (let i = 0; i < 5; i++) {
    await press(RB);
    const p = await panel();
    seen.push(p.tab);
    focus.push(p.focus === `OSKSet_tab_${p.tab}` && p.rings === 1);
  }
  const p = await panel();
  const leaked = await reached();
  const ok =
    seen.join() === [...TABS, "typing"].join() && focus.every(Boolean) && p.on === "OSKSet_tab_typing" && !p.held.length && !leaked.length;
  return { ok, detail: `tabs ${seen} focus ${focus} held ${p.held} reachedSteam ${leaked}` };
});

await scenario("LB at the first tab wraps to the last, and steps back", async () => {
  await openPanel();
  await press(LB);
  const a = await panel();
  await press(LB);
  const b = await panel();
  return { ok: a.tab === "system" && b.tab === "words" && a.on === "OSKSet_tab_system", detail: `${a.tab} then ${b.tab}` };
});

await scenario("left / right on the focused tab switch tabs; A goes into the list", async () => {
  await openPanel();
  await press(RB);
  await press(RIGHT);
  const a = await panel();
  await press(LEFT);
  await press(LEFT);
  const b = await panel();
  await press(A);
  const c = await panel();
  return {
    ok: a.tab === "look" && b.tab === "typing" && b.focus === "OSKSet_tab_typing" && c.focus === "OSKSet_c_mode",
    detail: `${a.tab} ${b.tab} ${c.focus}`,
  };
});

await scenario("RT / LT behave like RB / LB where there is nothing to page", async () => {
  await openPanel();
  await clearReached();
  await press(RT);
  const a = (await panel()).tab;
  await press(LT);
  await press(LT);
  const b = (await panel()).tab;
  const leaked = await reached();
  return { ok: a === "input" && b === "system" && !leaked.length, detail: `RT ${a}, LT LT ${b}, reachedSteam ${leaked}` };
});

await scenario("Words: Learned (n) / Blocked (n), 12 rows a page, RT / LT page and wrap, RB still leaves the tab", async () => {
  const words = [];
  for (let i = 0; i < 30; i++)
    words.push([`menuword${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`, 1 + (i % 3)]);
  await learn(words);
  await openPanel();
  await gotoTab("words");
  const info = () =>
    page.evaluate(() => ({
      seg: [...document.querySelectorAll('[data-key="OSKSet_c_list"] .osk-set-segbtn')].map((e) => e.textContent),
      rows: [...document.querySelectorAll(".osk-set-item")].filter((e) => !e.hidden).length,
      pageNo: document.querySelector(".osk-set-foot .osk-set-pageno")?.textContent ?? "",
      first: document.querySelector('[data-key="OSKSet_w_0"] .osk-set-word')?.textContent,
    }));
  const i0 = await info();
  await press(RT);
  const i1 = await info();
  await press(RT);
  const i2 = await info();
  await press(RT);
  const i3 = await info();
  await press(LT);
  const i4 = await info();
  await press(RB);
  const out = await panel();
  const ok =
    /^Learned \(3\d\)$/.test(i0.seg[0]) &&
    i0.seg[1] === "Blocked (0)" &&
    i0.rows === 12 &&
    i0.pageNo === "Page 1 / 3" &&
    i1.pageNo === "Page 2 / 3" &&
    i1.first !== i0.first &&
    i2.pageNo === "Page 3 / 3" &&
    i3.pageNo === "Page 1 / 3" &&
    i4.pageNo === "Page 3 / 3" &&
    out.tab === "system";
  return { ok, detail: JSON.stringify([i0, i1, i2, i3, i4, out.tab]) };
});

await scenario("Words: A forgets a word, the footer offers undo for 5 s, A undoes it", async () => {
  await learn([["undoword", 40]]);
  await openPanel();
  await gotoTab("words");
  await press(DOWN);
  await press(DOWN);
  const p0 = await panel();
  const word = await page.evaluate(() => document.querySelector('[data-key="OSKSet_w_0"] .osk-set-word')?.textContent);
  await press(A);
  const after = await page.evaluate(() => ({
    known: window.__oskEngine.known("undoword"),
    undo: document.querySelector('[data-key="OSKSet_undo"]')?.textContent,
    shown: !document.querySelector('[data-key="OSKSet_undo"]')?.hidden,
    focus: window.__oskTrackpadFix.panel.focus,
  }));
  await press(A);
  const back = await page.evaluate(() => ({
    known: window.__oskEngine.known("undoword"),
    count: window.__oskEngine.exportUser().words.undoword?.c,
    hidden: document.querySelector('[data-key="OSKSet_undo"]')?.hidden,
    focus: window.__oskTrackpadFix.panel.focus,
  }));
  await press(A);
  await sleep(5300);
  const expired = await page.evaluate(() => ({
    hidden: document.querySelector('[data-key="OSKSet_undo"]')?.hidden,
    known: window.__oskEngine.known("undoword"),
    focus: window.__oskTrackpadFix.panel.focus,
  }));
  await learn([["undoword", 40]]);
  const ok =
    p0.focus === "OSKSet_w_0" &&
    word === "undoword" &&
    !after.known &&
    after.shown &&
    after.undo === 'Forgot "undoword" — A to undo' &&
    after.focus === "OSKSet_undo" &&
    back.known &&
    back.count === 40 &&
    back.hidden &&
    back.focus === "OSKSet_w_0" &&
    expired.hidden &&
    !expired.known &&
    expired.focus === "OSKSet_w_0";
  return { ok, detail: JSON.stringify({ p0: p0.focus, word, after, back, expired }) };
});

await scenario("Words: Blocked list unblocks with A and undo blocks again; an empty list says so", async () => {
  await page.evaluate(() => window.__oskTrackpadFix.blocked.add("zzblock"));
  await openPanel();
  await gotoTab("words");
  await press(DOWN);
  await press(RIGHT);
  const seg = await page.evaluate(() => document.querySelector('[data-key="OSKSet_c_list"] .osk-set-segbtn.on')?.textContent);
  await press(DOWN);
  await press(A);
  const un = await page.evaluate(() => ({
    blocked: window.__oskTrackpadFix.blocked.has("zzblock"),
    undo: document.querySelector('[data-key="OSKSet_undo"]')?.textContent,
    empty: document.querySelector(".osk-set-empty")?.hidden === false ? document.querySelector(".osk-set-empty").textContent : null,
  }));
  await press(A);
  const re = await page.evaluate(() => window.__oskTrackpadFix.blocked.has("zzblock"));
  await page.evaluate(() => window.__oskTrackpadFix.blocked.delete("zzblock"));
  const ok =
    seg === "Blocked (1)" && !un.blocked && un.undo === 'Unblocked "zzblock" — A to undo' && /No blocked words/.test(un.empty ?? "") && re;
  return { ok, detail: JSON.stringify({ seg, un, re }) };
});

await scenario("one focus ring; up / down wrap through the tab, the left column and the right column; nothing scrolls", async () => {
  await openPanel();
  const first = await panel();
  const path = [];
  let hidden = 0,
    rings = new Set();
  for (let i = 0; i < 7; i++) {
    await press(DOWN);
    const p = await panel();
    path.push(p.focus);
    rings.add(p.rings);
    if (!p.visible) hidden++;
  }
  const wrapped = await panel();
  await press(UP);
  const last = await panel();
  const ok =
    first.focus === "OSKSet_c_mode" &&
    first.scroll === 0 &&
    path.join() ===
      "OSKSet_t_swipe,OSKSet_t_suggestions,OSKSet_t_autocorrect,OSKSet_t_learn,OSKSet_t_autoSpace,OSKSet_t_removeAutoSpace,OSKSet_tab_typing" &&
    wrapped.focus === "OSKSet_tab_typing" &&
    last.focus === "OSKSet_t_removeAutoSpace" &&
    last.scroll === 0 &&
    last.visible &&
    hidden === 0 &&
    [...rings].join() === "1";
  return { ok, detail: `path ${path} last ${last.focus} scroll ${last.scroll} hidden ${hidden} rings ${[...rings]}` };
});

await scenario("a held stick repeats at about 8 per second after 350 ms; Steam's own repeats are ignored", async () => {
  await openPanel();
  await gotoTab("look");
  await press(A);
  const start = (await panel()).focus;
  const order = await page.evaluate(() =>
    [...document.querySelectorAll('.osk-set-page.on [data-key^="OSKSet_"]')]
      .filter((e) => e.classList.contains("osk-set-row"))
      .map((e) => e.getAttribute("data-key")),
  );
  await vgp("vgp_onbuttondown", DOWN);
  const t0 = Date.now();
  for (let i = 0; i < 8; i++) {
    await sleep(100);
    await vgp("vgp_onbuttondown", DOWN, true);
  }
  await sleep(Math.max(0, 900 - (Date.now() - t0)));
  await vgp("vgp_onbuttonup", DOWN);
  const held = Date.now() - t0;
  const end = (await panel()).focus;
  await sleep(400);
  const later = (await panel()).focus;
  const moved = order.indexOf(end) - order.indexOf(start);
  const expect = 1 + Math.floor((held - 350) / 125) + 1;
  return {
    ok: moved >= expect - 2 && moved <= expect + 1 && later === end,
    detail: `held ${held} ms moved ${moved} (expected about ${expect}) from ${start} to ${end}, after release ${later}`,
  };
});

await scenario("A switches a toggle; left / right go to the row beside it in the other column; X, Y and Backspace do nothing", async () => {
  await openPanel();
  await focusTo("OSKSet_t_swipe");
  const s0 = (await settings()).swipe;
  await press(A);
  const s1 = (await settings()).swipe;
  await press(RIGHT);
  const right = (await panel()).focus;
  await press(RIGHT);
  const edge = (await panel()).focus;
  await press(LEFT);
  const left = (await panel()).focus;
  const s2 = (await settings()).swipe;
  await page.evaluate(() => (window.__keyLog.length = 0));
  const before = await panel();
  const sBefore = JSON.stringify(await settings());
  await clearReached();
  await press(X);
  await press(Y);
  await press(X, 600);
  const after = await panel();
  const typed = await page.evaluate(() => window.__keyLog.filter(([, k]) => k === "text").length);
  const leaked = await reached();
  const same = JSON.stringify(await settings()) === sBefore;
  await setSetting("swipe", s0);
  return {
    ok:
      s1 === !s0 &&
      s2 === s1 &&
      right === "OSKSet_t_learn" &&
      edge === right &&
      left === "OSKSet_t_swipe" &&
      same &&
      after.focus === before.focus &&
      after.open &&
      typed === 0 &&
      !leaked.length,
    detail: `swipe ${s0}->${s1}->${s2} right ${right} edge ${edge} left ${left} same ${same} focus ${before.focus}->${after.focus} typed ${typed} reachedSteam ${leaked}`,
  };
});

await scenario("segmented rows: A steps to the next choice, left / right move it and stop at the ends, a tap picks one", async () => {
  await setSetting("mode", "bigkeys");
  await openPanel();
  const seen = [];
  const desc = [];
  const read2 = async () => {
    seen.push((await settings()).mode);
    desc.push(await page.evaluate(() => document.querySelector('[data-key="OSKSet_c_mode"] .osk-set-desc')?.textContent));
  };
  await press(A);
  await read2();
  await press(RIGHT);
  await read2();
  await press(RIGHT);
  await read2();
  await press(LEFT);
  await press(LEFT);
  await press(LEFT);
  await press(LEFT);
  await read2();
  const on = await page.evaluate(() => [...document.querySelectorAll('[data-key^="OSKSet_v_mode_"].on')].map((e) => e.textContent));
  await gotoTab("look");
  const c = await center("OSKSet_v_theme_2");
  await page.mouse.click(c.x, c.y);
  const theme = (await settings()).theme;
  const glass = await center("OSKSet_v_blur_1");
  await page.mouse.click(glass.x, glass.y);
  const blur = (await settings()).blur;
  await setSetting("mode", "bigkeys");
  await setSetting("theme", "modern");
  await setSetting("blur", 0);
  const ok =
    seen.join() === "standard,bigkeys,bigkeys,standard" &&
    desc[0] === "Steam's layout" &&
    on.join() === "Standard" &&
    theme === "oled" &&
    blur === 1;
  return { ok, detail: `modes ${seen} desc ${desc[0]} on ${on} theme ${theme} blur ${blur}` };
});

await scenario("sliders: left / right step by 5, a held direction repeats, A steps up, a click on the track sets the value", async () => {
  await setSetting("keyAlpha", 50);
  await openPanel();
  await gotoTab("look");
  await page.evaluate(() => (window.__oskTrackpadFix.panel.focus = null));
  if (!(await focusTo("OSKSet_s_keyAlpha"))) throw new Error("no slider focus");
  const v = async () => (await settings()).keyAlpha;
  await press(RIGHT);
  const a = await v();
  await press(LEFT);
  await press(LEFT);
  const b = await v();
  await vgp("vgp_onbuttondown", RIGHT);
  for (let i = 0; i < 6; i++) {
    await sleep(100);
    await vgp("vgp_onbuttondown", RIGHT, true);
  }
  await sleep(300);
  await vgp("vgp_onbuttonup", RIGHT);
  const c = await v();
  await sleep(300);
  const c2 = await v();
  await press(A);
  const d = await v();
  const text = await page.evaluate(() => document.querySelector('[data-key="OSKSet_s_keyAlpha"] .osk-set-val')?.textContent);
  const tr = await page.evaluate(() => {
    const r = document.querySelector('[data-key="OSKSet_s_keyAlpha"] .osk-set-track').getBoundingClientRect();
    return { x: r.left, w: r.width, y: r.top + r.height / 2 };
  });
  await page.mouse.click(tr.x + tr.w * 0.2, tr.y);
  const e = await v();
  const label = await page.evaluate(() => {
    const r = document.querySelector('[data-key="OSKSet_s_keyAlpha"] .osk-set-label').getBoundingClientRect();
    return { x: r.left + 10, y: r.top + r.height / 2 };
  });
  await page.mouse.click(label.x, label.y);
  const f = await v();
  await setSetting("keyAlpha", 100);
  const ok = a === 55 && b === 45 && c >= 75 && c2 === c && d === c + 5 && text === `${d} %` && e === 20 && f === 20;
  return { ok, detail: `55:${a} 45:${b} held:${c} after:${c2} A:${d} text:${text} click20:${e} labelClick:${f}` };
});

await scenario("Look: the live preview follows every slider step without re-rendering the rows", async () => {
  await openPanel();
  await gotoTab("look");
  const rows0 = await page.evaluate(() => {
    window.__rows = [...document.querySelectorAll(".osk-set-page.on .osk-set-row")];
    return window.__rows.length;
  });
  const bg = () =>
    page.evaluate(() => {
      const q = (s) => getComputedStyle(document.querySelector(s));
      return {
        board: q(".osk-set-pv-kb").backgroundColor,
        key: q(".osk-set-pv-key").backgroundColor,
        space: q(".osk-set-pv-space").backgroundColor,
        strip: q(".osk-set-pv-strip").backgroundColor,
        blur: q(".osk-set-pv-kb").backdropFilter,
      };
    });
  const before = await bg();
  if (!(await focusTo("OSKSet_s_spaceAlpha"))) throw new Error("no slider focus");
  await press(RIGHT);
  const after = await bg();
  await setSetting("blur", 2);
  const blurred = await bg();
  await setSetting("blur", 0);
  await setSetting("spaceAlpha", 30);
  const same = await page.evaluate(() =>
    [...document.querySelectorAll(".osk-set-page.on .osk-set-row")].every((e, i) => e === window.__rows[i] && e.isConnected),
  );
  const ok =
    rows0 > 6 &&
    before.space !== after.space &&
    /0\.35\)$/.test(after.space) &&
    before.key === after.key &&
    /blur\(16px\)/.test(blurred.blur) &&
    same;
  return { ok, detail: JSON.stringify({ before, after, blurred: blurred.blur, same }) };
});

await scenario("toggles and sliders update only their row: no node of the panel is replaced", async () => {
  await openPanel();
  await gotoTab("look");
  await sleep(600);
  await page.evaluate(() => {
    window.__mut = [];
    window.__mo = new MutationObserver((m) =>
      window.__mut.push(
        ...m
          .filter(
            (x) =>
              x.type === "childList" &&
              (x.addedNodes.length || x.removedNodes.length) &&
              !x.target.closest?.(".osk-set-val, .osk-set-desc, .osk-set-label, .osk-set-hint, .osk-set-chips, .osk-set-pageno"),
          )
          .map((x) => x.target.className),
      ),
    );
    window.__mo.observe(document.querySelector(".osk-set"), { subtree: true, childList: true });
  });
  await focusTo("OSKSet_t_trail");
  await press(A);
  await press(A);
  await focusTo("OSKSet_s_boardAlpha");
  await press(RIGHT);
  await press(LEFT);
  await press(RB);
  await press(LB);
  const mut = await page.evaluate(() => {
    window.__mo.disconnect();
    return window.__mut;
  });
  return { ok: mut.length === 0, detail: `structural mutations ${JSON.stringify(mut.slice(0, 5))}` };
});

await scenario("Forget everything: A arms it for 5 s, B cancels it and only a second B closes the panel; A twice forgets", async () => {
  await learn([["dangerword", 3]]);
  await openPanel();
  await gotoTab("system");
  if (!(await focusTo("OSKSet_forget_all"))) throw new Error("no danger focus");
  await press(A);
  const armed = await page.evaluate(() => document.querySelector('[data-key="OSKSet_forget_all"]').className);
  await press(B);
  const p1 = await panel();
  const disarmed = await page.evaluate(() => document.querySelector('[data-key="OSKSet_forget_all"]').className);
  await press(A);
  await sleep(5200);
  const expired = await page.evaluate(() => document.querySelector('[data-key="OSKSet_forget_all"]').className);
  await press(A);
  await press(A);
  const gone = !(await page.evaluate(() => window.__oskEngine.known("dangerword")));
  await press(B);
  const p2 = await panel();
  const ok = /armed/.test(armed) && p1.open && !/armed/.test(disarmed) && !/armed/.test(expired) && gone && !p2.open;
  return { ok, detail: JSON.stringify({ armed, open1: p1.open, disarmed, expired, gone, open2: p2.open }) };
});

await scenario(
  "touch acts on release inside the row; a drag that scrolls the list does not act; mouse hover does not move the focus",
  async () => {
    await openPanel();
    await press(DOWN);
    const cdp = await page.createCDPSession();
    const s0 = (await settings()).autocorrect;
    const c = await center("OSKSet_t_autocorrect");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: c.x, y: c.y, id: 1 }] });
    await sleep(40);
    const mid = (await settings()).autocorrect;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(60);
    const s1 = (await settings()).autocorrect;
    await page.evaluate(() => (document.querySelector(".osk-set-page.on").scrollTop = 0));
    const c2 = await center("OSKSet_t_swipe");
    const sw0 = (await settings()).swipe;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: c2.x, y: c2.y, id: 2 }] });
    for (let i = 1; i <= 6; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: c2.x, y: c2.y - i * 12, id: 2 }] });
      await sleep(16);
    }
    await page.evaluate(() => (document.querySelector(".osk-set-page.on").scrollTop += 60));
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(60);
    const sw1 = (await settings()).swipe;
    await cdp.detach();
    await setSetting("autocorrect", s0);
    const f0 = (await panel()).focus;
    const h = await center("OSKSet_t_learn");
    await page.mouse.move(h.x, h.y);
    await sleep(50);
    const f1 = (await panel()).focus;
    const typed = await page.evaluate(() => window.__keyLog.filter(([, k]) => k === "text").length);
    return {
      ok: mid === s0 && s1 === !s0 && sw1 === sw0 && f1 === f0 && typed === 0,
      detail: `during ${mid} after ${s1} drag ${sw0}->${sw1} focus ${f0}->${f1}`,
    };
  },
);

await scenario("a stick or D-pad press does not switch tabs from a row", async () => {
  await openPanel();
  await press(DOWN);
  for (const b of [UP, DOWN, DOWN, UP]) await press(b);
  const p = await panel();
  return { ok: p.tab === "typing", detail: `tab ${p.tab}` };
});

await scenario("releases of presses the panel took never reach Steam, nor toggle Ctrl / Alt", async () => {
  await setSetting("bumpers", true);
  await openPanel();
  await clearReached();
  for (const b of [LB, RB, LT, RT, UP, DOWN, LEFT, RIGHT, X, Y]) await press(b);
  await press(DOWN, 600);
  const leaked = await reached();
  const k = await keyState();
  const p = await panel();
  return { ok: !leaked.length && clean(k) && !p.held.length, detail: `reachedSteam ${leaked} keys ${JSON.stringify(k)} held ${p.held}` };
});

await scenario("a bumper held while B closes the panel: its release is still swallowed", async () => {
  await setSetting("bumpers", true);
  await openPanel();
  await clearReached();
  await vgp("vgp_onbuttondown", LB);
  await press(B);
  await vgp("vgp_onbuttonup", LB);
  const leaked = await reached();
  const k = await keyState();
  return { ok: !leaked.length && clean(k), detail: `reachedSteam ${leaked} keys ${JSON.stringify(k)}` };
});

await scenario("auto-repeat of RB / RT does not skip tabs", async () => {
  await openPanel();
  await vgp("vgp_onbuttondown", RB);
  for (let i = 0; i < 4; i++) await vgp("vgp_onbuttondown", RB, true);
  await vgp("vgp_onbuttonup", RB);
  await vgp("vgp_onbuttondown", RT);
  for (let i = 0; i < 4; i++) await vgp("vgp_onbuttondown", RT, true);
  await vgp("vgp_onbuttonup", RT);
  const p = await panel();
  return { ok: p.tab === "look", detail: `tab ${p.tab}` };
});

await scenario("a bumper held before the panel opens is released normally by Ctrl handling", async () => {
  await setSetting("bumpers", true);
  await vgp("vgp_onbuttondown", LB);
  await settle(page);
  const during = await keyState();
  await openPanel();
  await vgp("vgp_onbuttonup", LB);
  await settle(page);
  const after = await keyState();
  return { ok: during.ctrl !== 0 && clean(after), detail: `ctrl while held ${during.ctrl}; after ${JSON.stringify(after)}` };
});

await scenario("panel closed, LB / RB on: LB holds Ctrl, RB holds Alt, nothing reaches Steam", async () => {
  await setSetting("bumpers", true);
  await clearReached();
  await vgp("vgp_onbuttondown", LB);
  await vgp("vgp_onbuttondown", RB);
  await settle(page);
  const held = await keyState();
  await vgp("vgp_onbuttonup", LB);
  await vgp("vgp_onbuttonup", RB);
  await settle(page);
  const after = await keyState();
  const leaked = await reached();
  return {
    ok: held.ctrl !== 0 && held.alt !== 0 && clean(after) && !leaked.length,
    detail: `held ctrl ${held.ctrl} alt ${held.alt}; after ${JSON.stringify(after)}; reachedSteam ${leaked}`,
  };
});

await scenario("panel closed, LB / RB off: Steam gets the presses and no modifier is held", async () => {
  await setSetting("bumpers", false);
  await clearReached();
  await vgp("vgp_onbuttondown", LB);
  await vgp("vgp_onbuttonup", LB);
  await vgp("vgp_onbuttondown", RT);
  await vgp("vgp_onbuttonup", RT);
  await settle(page);
  const leaked = await reached();
  const k = await keyState();
  await setSetting("bumpers", true);
  return { ok: leaked.join() === "d5,u5,d8,u8" && clean(k), detail: `reachedSteam ${leaked} keys ${JSON.stringify(k)}` };
});

await scenario("after using the panel, bumpers still work on the keyboard", async () => {
  await openPanel();
  await press(RB);
  await closePanel();
  await vgp("vgp_onbuttondown", LB);
  await settle(page);
  const held = await keyState();
  await vgp("vgp_onbuttonup", LB);
  await settle(page);
  const after = await keyState();
  return { ok: held.ctrl !== 0 && clean(after), detail: `ctrl ${held.ctrl}; after ${JSON.stringify(after)}` };
});

await scenario("LB held while the keyboard closes, release lost: no Ctrl after reopening and the next key is plain", async () => {
  await vgp("vgp_onbuttondown", LB);
  await settle(page);
  const held = await keyState();
  await page.evaluate(() => window.__sim.vkm.SetVirtualKeyboardHidden());
  await page.evaluate(() => window.__oskTrackpadFix.tickNow());
  await sleep(50);
  await page.evaluate(() => window.__sim.vkm.SetVirtualKeyboardVisible());
  await waitKeyboard(page);
  await page.evaluate(() => window.__oskTrackpadFix.tickNow());
  await settle(page);
  const after = await keyState();
  await page.evaluate(() => (window.__keyLog.length = 0));
  const c = await page.evaluate(() => {
    const e = [...document.querySelectorAll('[data-key="c"]')].find((e) => e.getBoundingClientRect().width > 0);
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.touchscreen.tap(c.x, c.y);
  await settle(page);
  const typed = await page.evaluate(() => window.__keyLog.map(([, k, v]) => `${k}:${v}`));
  return {
    ok: held.ctrl !== 0 && clean(after) && typed.join() === "text:c",
    detail: `held ctrl ${held.ctrl}; after ${JSON.stringify(after)}; typed ${typed}`,
  };
});

results.push(`status: ${await page.evaluate(() => window.__oskTrackpadFix.status())}`);
console.log(results.join("\n"));
console.log(failures ? `${failures} FAILED` : "ALL PASS");
await browser.close();
process.exit(failures ? 1 : 0);
