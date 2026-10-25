import fs from "node:fs";
import path from "node:path";
import { openSim, inject, settle, waitKeyboard } from "./run.mjs";
import { readRuntime as read } from "../runtime.mjs";
import { pageHelpers, sleep, withTiming } from "./helpers.mjs";

const shots = process.env.SHOTS;
if (shots) fs.mkdirSync(shots, { recursive: true });

const { browser, page, errors } = await openSim({ backdrop: true });
let failures = 0;
const results = [];
const BTN = { L: 20, R: 22 };

await page.evaluate(() => window.localStorage.clear());
await page.evaluate(read("swipe/words.js") + "\n;\n" + read("swipe/engine.js"));
results.push(`inject: ${await inject(page, read("patch.js"))}`);
await page.waitForSelector('[data-key="Escape"]');
await settle(page);

const { kbEval, center, vgp, padAt, padIdle, setSetting } = pageHelpers(page);

async function padTapAt(side, x, y, holdMs = 20) {
  await padAt(side, x, y);
  await vgp("vgp_onbuttondown", BTN[side]);
  await sleep(holdMs);
  await vgp("vgp_onbuttonup", BTN[side]);
  await padIdle(side);
  await sleep(60);
}

async function padTap(side, key, holdMs = 20) {
  const c = await center(key);
  if (!c) throw new Error(`no key ${key}`);
  await padTapAt(side, c.x, c.y, holdMs);
}

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
}

const rawOf = async (key) => {
  const c = await center(key);
  const r = await kbEval((kb) => kb.m_keyboardDiv.getBoundingClientRect().toJSON());
  return { ux: (2 * (c.x - r.left)) / r.width - 1, uy: 1 - (2 * (c.y - r.top)) / r.height };
};
const rawHover = async (side, key) => {
  const { ux, uy } = await rawOf(key);
  return kbEval(
    async (kb, side, ux, uy) => {
      kb.m_trackpadInput.m_AnalogCallbacks.Dispatch(side === "L" ? 19 : 21, 0, ux, uy);
      await new Promise((r) => setTimeout(r, 30));
      kb.m_trackpadInput.m_AnalogCallbacks.Dispatch(side === "L" ? 19 : 21, 0, ux, uy);
      const pad = side === "L" ? kb.m_leftTrackpad : kb.m_rightTrackpad;
      const el = kb.getElementFromPointWorkaround(pad.x, pad.y, side === "L" ? 5 : 6);
      return el?.getAttribute("data-key") ?? null;
    },
    side,
    ux,
    uy,
  );
};

const echo = () =>
  page.evaluate(() => {
    const e = document.querySelector(".osk-echo");
    return e && !e.hidden && e.isConnected ? e.firstChild.textContent : null;
  });
const echoWhere = () =>
  page.evaluate(() => {
    const e = document.querySelector(".osk-echo");
    if (!e || e.hidden || !e.isConnected) return null;
    return e.classList.contains("row") ? "row" : e.classList.contains("space") ? "space" : "?";
  });
const geometry = () =>
  page.evaluate(() => {
    const out = {};
    for (const k of ["Escape", "q", "a", "z", " ", "OSKSug_0", "OSKSug_2"]) {
      const el = [...document.querySelectorAll("[data-key]")].find(
        (e) => e.getAttribute("data-key") === k && e.getBoundingClientRect().width > 0,
      );
      if (el?.closest?.(".osk-set-page")) el.scrollIntoView({ block: "nearest" });
      const r = el?.getBoundingClientRect();
      out[k] = r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null;
    }
    const kb = document.querySelector("[data-key]").closest(".DefaultTheme")?.getBoundingClientRect();
    out.kb = kb ? [Math.round(kb.top), Math.round(kb.height)] : null;
    return out;
  });
const clear = async () => {
  await padTap("R", "Enter");
  await settle(page);
};
const shot = async (name) => {
  if (!shots) return;
  const r = await kbEval((kb) => {
    const b = kb.m_keyboardDiv.getBoundingClientRect();
    return { x: b.left, y: b.top - 4, width: b.width, height: b.height + 4 };
  });
  const file = path.join(shots, `${name}.png`);
  await page.screenshot({ path: file, clip: r });
  results.push(`  screenshot ${file}`);
};

const scenario = withTiming(scenario0);

async function scenario0(title, fn) {
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
  const newErr = errors.filter((e, i) => i >= e0 && !/404|Failed to load|Transport|passive event listener|cancel a touchend/.test(e));
  const state = await page.evaluate(() => window.__oskTrackpadFix.errors.slice());
  if (!ok || newErr.length || state.length) failures++;
  results.push(
    `${ok && !newErr.length && !state.length ? "PASS" : "FAIL"} ${title}${detail ? `\n      ${detail}` : ""}${newErr.length ? `\n      errors ${newErr.join(" | ")}` : ""}${state.length ? `\n      patch errors ${state.join(" | ")}` : ""}`,
  );
}

await scenario("echo sits in the suggestion row; keyboard height, rows and keys keep their place", async () => {
  await setSetting("echo", false);
  await settle(page);
  const off = await geometry();
  const offWhere = await echoWhere();
  await setSetting("echo", true);
  await settle(page);
  const on = await geometry();
  const where = await echoWhere();
  const same =
    ["Escape", "q", "a", "z", " "].every((k) => JSON.stringify(off[k]) === JSON.stringify(on[k])) &&
    JSON.stringify(off.kb) === JSON.stringify(on.kb);
  const sugTop = off.OSKSug_0[1] === on.OSKSug_0[1] && off.OSKSug_0[3] === on.OSKSug_0[3];
  const shifted = on.OSKSug_0[0] > off.OSKSug_0[0] + 100 && on.OSKSug_2[0] + on.OSKSug_2[2] === off.OSKSug_2[0] + off.OSKSug_2[2];
  return {
    ok: offWhere === null && where === "row" && same && sugTop && shifted,
    detail: `off ${JSON.stringify(off)} on ${JSON.stringify(on)} where ${offWhere}->${where}`,
  };
});

await scenario(
  "raw pad mapping (Pad reach: Right pad only) lands on the same keys with the echo off and on; the echo area hits no key",
  async () => {
    const want = ["Escape", "Tab", "1", "q", "p", "a", "z", "m", "OSKSug_1", "OSKSug_2", " ", "Backspace"];
    await setSetting("reach", "right");
    await setSetting("echo", false);
    await padTap("R", "h");
    await settle(page);
    const before = [];
    await rawHover("R", "q");
    for (const k of want) before.push(await rawHover("R", k));
    await setSetting("echo", true);
    await settle(page);
    const got = [];
    await rawHover("R", "q");
    for (const k of want) got.push(await rawHover("R", k));
    await setSetting("reach", 55);
    await settle(page);
    const box = await page.evaluate(() => {
      const r = document.querySelector(".osk-echo").getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    const onEcho = await kbEval((kb, x, y) => kb.getElementFromPointWorkaround(x, y, 6)?.getAttribute("data-key") ?? null, box.x, box.y);
    await kbEval((kb) => kb.m_trackpadInput.m_AnalogCallbacks.Dispatch(21, 0, 0, 0));
    await padIdle("R");
    await page.evaluate(() => {
      window.__keyLog.length = 0;
    });
    await padTapAt("R", box.x, box.y);
    await settle(page);
    const typed = await page.evaluate(() => window.__keyLog.length);
    return {
      ok: want.every((k, i) => got[i] === k && before[i] === k) && onEcho === null && typed === 0,
      detail: `off ${JSON.stringify(before)} on ${JSON.stringify(got)} onEcho ${onEcho} typed ${typed}`,
    };
  },
);

await scenario("initial focus row still points at the letter row", async () => {
  const r = await kbEval((kb) => kb.constructor.s_initialFocusRow);
  return { ok: r === 3, detail: `s_initialFocusRow ${r}` };
});

await scenario("pad taps h, i show 'hi'", async () => {
  await clear();
  await padTap("R", "h");
  await padTap("R", "i");
  await settle(page);
  const e = await echo();
  return { ok: e === "hi", detail: JSON.stringify(e) };
});

await scenario("a swiped word is added with its automatic space", async () => {
  await padStroke("L", "the");
  await settle(page);
  const e = await echo();
  await shot("echo-typed");
  return { ok: e === "hi the", detail: JSON.stringify(e) };
});

await scenario("Backspace after the swipe removes the word and its space; another removes one letter", async () => {
  await padTap("R", "Backspace");
  await settle(page);
  const a = await echo();
  await padTap("R", "Backspace");
  await settle(page);
  const b = await echo();
  return { ok: a === "hi" && b === "h", detail: `${JSON.stringify(a)} ${JSON.stringify(b)}` };
});

await scenario("picking a suggestion replaces the word in the echo", async () => {
  await clear();
  await padStroke("L", "the");
  await settle(page);
  const labels = await page.evaluate(() => window.__oskTrackpadFix.tracker.labels.slice());
  await padTap("R", "OSKSug_0");
  await settle(page);
  const e = await echo();
  return { ok: !!labels[0] && e === labels[0], detail: `labels ${JSON.stringify(labels)} echo ${JSON.stringify(e)}` };
});

await scenario("Enter starts a fresh empty line", async () => {
  await padTap("R", "Enter");
  await settle(page);
  const e = await echo();
  return { ok: e === "", detail: JSON.stringify(e) };
});

await scenario("a press outside the keyboard resets to '…'; typing continues after it", async () => {
  await padTap("R", "o");
  await padTap("R", "k");
  await settle(page);
  await page.mouse.click(400, 40);
  await settle(page);
  const a = await echo();
  await padTap("R", "y");
  await settle(page);
  const b = await echo();
  return { ok: a === "…" && b === "…y", detail: `${JSON.stringify(a)} ${JSON.stringify(b)}` };
});

await scenario("arrow, Tab and Ctrl chord each reset to '…'", async () => {
  const out = [];
  for (const k of ["ArrowLeft", "Tab"]) {
    await clear();
    await padTap("R", "a");
    await padTap("R", k);
    await settle(page);
    out.push(await echo());
  }
  await clear();
  await padTap("R", "a");
  await padTap("L", "Control");
  await padTap("R", "c");
  await settle(page);
  out.push(await echo());
  return { ok: out.every((e) => e === "…"), detail: JSON.stringify(out) };
});

await scenario("Esc resets to '…'", async () => {
  await clear();
  await padTap("R", "a");
  await padTap("L", "Escape");
  await settle(page);
  const e = await echo();
  return { ok: e === "…", detail: JSON.stringify(e) };
});

await scenario("long text shows the last 60 characters behind '…', scrolled to the caret", async () => {
  await clear();
  const text = "the quick brown fox jumps over the lazy dog while we wait in the queue";
  await page.evaluate((t) => window.__oskTrackpadFix.typeText(t), text);
  await settle(page);
  const e = await echo();
  const over = await page.evaluate(() => document.querySelector(".osk-echo").classList.contains("over"));
  await shot("echo-long");
  return { ok: e === "…" + text.slice(-59) && over, detail: `${JSON.stringify(e)} over ${over}` };
});

await scenario("30 s without typing: the next key starts after '…'", async () => {
  await clear();
  await padTap("R", "a");
  await page.evaluate(() => {
    window.__oskTrackpadFix.echo.at -= 31000;
  });
  await padTap("R", "b");
  await settle(page);
  const e = await echo();
  return { ok: e === "…b", detail: JSON.stringify(e) };
});

await scenario("settings panel hides the echo, closing shows it again", async () => {
  await clear();
  await padTap("R", "o");
  await padTap("L", "SwitchKeys_Steam", 620);
  await settle(page);
  const during = await echo();
  const open = await page.evaluate(() => !!document.querySelector(".osk-set"));
  await padTap("R", "OSKSet_close");
  await settle(page);
  const after = await echo();
  return {
    ok: open && during === null && after === "o",
    detail: `open ${open} during ${JSON.stringify(during)} after ${JSON.stringify(after)}`,
  };
});

await scenario("'Show typed text' switch in the panel turns it off and on", async () => {
  await padTap("L", "SwitchKeys_Steam", 620);
  await settle(page);
  await padTap("R", "OSKSet_tab_look");
  const label = await page.evaluate(() => document.querySelector('[data-key="OSKSet_t_echo"]')?.textContent ?? "");
  await padTap("R", "OSKSet_t_echo");
  const s1 = await page.evaluate(() => window.__oskTrackpadFix.settings.echo);
  await padTap("R", "OSKSet_close");
  await settle(page);
  const off = await echo();
  const g = await geometry();
  await padTap("L", "SwitchKeys_Steam", 620);
  await settle(page);
  await padTap("R", "OSKSet_tab_look");
  await padTap("R", "OSKSet_t_echo");
  await padTap("R", "OSKSet_close");
  await settle(page);
  const on = await echo();
  return {
    ok: /Show typed text/.test(label) && s1 === false && off === null && g.OSKSug_0[0] < 10 && on === "o",
    detail: `label ${label} setting ${s1} off ${JSON.stringify(off)} sug0 ${g.OSKSug_0} on ${JSON.stringify(on)}`,
  };
});

await scenario("suggestion row off: the echo moves into the space bar; back on: into the row", async () => {
  await setSetting("suggestions", false);
  await settle(page);
  const a = await echoWhere();
  const e = await echo();
  await shot("echo-space");
  await setSetting("suggestions", true);
  await settle(page);
  const b = await echoWhere();
  return { ok: a === "space" && e === "o" && b === "row", detail: `${a} ${JSON.stringify(e)} ${b}` };
});

await scenario("keyboard hidden and shown again: empty line", async () => {
  await padTap("R", "x");
  await page.evaluate(() => window.__sim.vkm.SetVirtualKeyboardHidden());
  await page.evaluate(() => window.__oskTrackpadFix.tickNow());
  await page.evaluate(() => window.__sim.vkm.SetVirtualKeyboardVisible());
  await waitKeyboard(page);
  const e = await echo();
  return { ok: e === "", detail: JSON.stringify(e) };
});

for (const theme of ["modern", "steam", "oled"]) {
  if (!shots) break;
  await setSetting("theme", theme);
  await padTap("R", "h");
  await padTap("R", "i");
  await settle(page);
  await shot(`echo-${theme}`);
  await clear();
}
await setSetting("theme", "modern");

await scenario("stop() removes the echo", async () => {
  await page.evaluate(() => window.__oskTrackpadFix.stop());
  await settle(page);
  const left = await page.evaluate(() => document.querySelectorAll(".osk-echo").length);
  return { ok: left === 0, detail: `left ${left}` };
});

console.log(results.join("\n"));
console.log(failures ? `${failures} FAILED` : "ALL PASS");
await browser.close();
process.exit(failures ? 1 : 0);
