import fs from "node:fs";
import path from "node:path";
import { openSim, inject, settle, waitKeyboard } from "./run.mjs";
import { readRuntime as read } from "../runtime.mjs";
import { pageHelpers, sleep, textOut, withTiming } from "./helpers.mjs";

const shots = process.env.SHOTS;
if (shots) fs.mkdirSync(shots, { recursive: true });

const { browser, page: firstPage, errors } = await openSim();
let page = firstPage;
let failures = 0;
const results = [];
const BTN = { L: 20, R: 22 };

async function boot(userWords) {
  await page.evaluate(read("swipe/words.js") + "\n;\n" + read("swipe/engine.js"));
  await page.evaluate((u) => {
    window.__oskUserWords = u;
  }, userWords ?? null);
  return inject(page, read("patch.js"));
}

await page.evaluate(() => window.localStorage.clear());
results.push(`inject: ${await boot(null)}`);

const { kbEval, center, vgp, padAt, padIdle, setSetting } = pageHelpers(() => page);

async function padTap(side, key, holdMs = 20) {
  const c = await center(key);
  if (!c) throw new Error(`no key ${key}`);
  await padAt(side, c.x, c.y);
  await vgp("vgp_onbuttondown", BTN[side]);
  await sleep(holdMs);
  await vgp("vgp_onbuttonup", BTN[side]);
  await padIdle(side);
  await settle(page, { quiet: 0, join: false });
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

async function touchHold(key, ms) {
  const c = await center(key);
  const cdp = await page.createCDPSession();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: c.x, y: c.y, id: 1 }] });
  await sleep(ms);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
  await sleep(60);
}

async function touchTap(key) {
  const c = await center(key);
  if (!c) throw new Error(`no key ${key}`);
  await page.touchscreen.tap(c.x, c.y);
  await sleep(60);
}

async function aButton(key, ms) {
  const sel = `[data-key="${key}"]`;
  await vgp("vgp_onbuttondown", 1, sel);
  await sleep(ms);
  await vgp("vgp_onbuttonup", 1, sel);
  await sleep(60);
}

async function gamepad(button) {
  await vgp("vgp_onbuttondown", button);
  await sleep(10);
  await vgp("vgp_onbuttonup", button);
  await sleep(30);
}

const panelOpen = () => page.evaluate(() => !!document.querySelector(".osk-set"));
const items = () =>
  page.$$eval(".osk-set-item:not([hidden])", (els) =>
    els.map((e) => [
      e.getAttribute("data-key"),
      e.querySelector(".osk-set-word").textContent + e.querySelector(".osk-set-count").textContent,
    ]),
  );
const layoutState = () => kbEval((kb) => kb.state.layoutState);
const settings = () => page.evaluate(() => ({ ...window.__oskTrackpadFix.settings }));
const section = async (id) => {
  const sec = await page.evaluate((id) => window.__oskTrackpadFix.sectionOf(id), id);
  if (sec && !(await page.evaluate((sec) => document.querySelector(`[data-key="OSKSet_tab_${sec}"]`)?.classList.contains("on"), sec)))
    await padTap("L", `OSKSet_tab_${sec}`);
};
const toggle = async (name) => {
  await section(`t_${name}`);
  await padTap("R", `OSKSet_t_${name}`);
};
const choose = async (name, label) => {
  await section(`c_${name}`);
  const key = await page.evaluate(
    (name, label) =>
      [...document.querySelectorAll(`[data-key^="OSKSet_v_${name}_"]`)].find((e) => e.textContent === label)?.getAttribute("data-key"),
    name,
    label,
  );
  if (!key) throw new Error(`no option ${label} for ${name}`);
  await padTap("R", key);
};
const chosen = (name) =>
  page.evaluate((name) => document.querySelector(`[data-key="OSKSet_c_${name}"] .osk-set-segbtn.on`)?.textContent ?? null, name);
const shot = async (name) => {
  if (!shots) return;
  const r = await kbEval((kb) => {
    const b = kb.m_keyboardDiv.getBoundingClientRect();
    return { x: b.left, y: b.top, width: b.width, height: b.height };
  });
  const file = path.join(shots, `${name}.png`);
  await page.screenshot({ path: file, clip: r });
  results.push(`  screenshot ${file}`);
};

const scenario = withTiming(scenario0);

async function scenario0(title, fn) {
  const e0 = errors.length;
  await page.evaluate(() => {
    window.__keyLog.length = 0;
  });
  let ok, detail;
  try {
    const r = await fn(async () => {
      await settle(page);
      return textOut(await page.evaluate(() => window.__keyLog.slice()));
    });
    ok = r === true || r?.ok === true;
    detail = r?.detail ?? "";
  } catch (e) {
    ok = false;
    detail = String(e.stack ?? e);
  }
  const newErr = errors.filter((e, i) => i >= e0 && !/404|Failed to load|Transport|passive event listener|cancel a touchend/.test(e));
  if (!ok || newErr.length) failures++;
  results.push(
    `${ok && !newErr.length ? "PASS" : "FAIL"} ${title}${detail ? `\n      ${detail}` : ""}${newErr.length ? `\n      errors ${newErr.join(" | ")}` : ""}`,
  );
}

async function restartSteam() {
  const old = page;
  const sim = await openSim({ browser });
  page = sim.page;
  page.on("pageerror", (e) => errors.push(String(e.stack ?? e)));
  await old.close();
}

async function backToLetters() {
  if ((await layoutState()) === 0) return;
  if (await center("SwitchKeys_ABC")) await padTap("R", "SwitchKeys_ABC");
  if ((await layoutState()) !== 0) await kbEval((kb) => kb.setState({ layoutState: 0 }));
  await page.waitForSelector('[data-key="a"]');
  await settle(page);
}

await scenario("pad tap on the emoji key still switches to emoji, no panel", async () => {
  await padTap("L", "SwitchKeys_Steam");
  await waitLayoutChange();
  const ls = await layoutState();
  const open = await panelOpen();
  await backToLetters();
  return { ok: ls !== 0 && !open, detail: `layoutState ${ls} panel ${open}` };
});

await scenario("pad hold on the emoji key opens the settings panel, layout unchanged", async (out) => {
  await padTap("L", "SwitchKeys_Steam", 620);
  const open = await panelOpen();
  const ls = await layoutState();
  await shot("panel-settings");
  const o = await out();
  return { ok: open && ls === 0 && o === "", detail: `panel ${open} layoutState ${ls} text ${JSON.stringify(o)}` };
});

await scenario("pad clicks on the panel do not type the keys under it", async (out) => {
  const c = await page.evaluate(() => {
    const r = document.querySelector(".osk-set-hint").getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await padAt("R", c.x, c.y);
  await vgp("vgp_onbuttondown", BTN.R);
  await vgp("vgp_onbuttonup", BTN.R);
  await padIdle("R");
  const o = await out();
  return { ok: o === "" && (await panelOpen()), detail: `text ${JSON.stringify(o)}` };
});

await scenario("B closes the panel", async () => {
  await gamepad(2);
  const open = await panelOpen();
  const kbOpen = await page.evaluate(() => window.__sim.vkm.m_bIsVirtualKeyboardShowing?.Value !== false);
  return { ok: !open && kbOpen, detail: `panel ${open} keyboard ${kbOpen}` };
});

await scenario("touch hold on the emoji key opens the panel without Steam's extended row; Close by touch", async () => {
  await touchHold("SwitchKeys_Steam", 620);
  const open = await panelOpen();
  const ls = await layoutState();
  const ext = await kbEval((kb) => kb.m_nOpenExtendedRows ?? 0);
  await touchTap("OSKSet_close");
  const closed = !(await panelOpen());
  return { ok: open && ls === 0 && ext === 0 && closed, detail: `panel ${open} layoutState ${ls} extendedRows ${ext} closed ${closed}` };
});

await scenario("touch tap on the emoji key still switches to emoji", async () => {
  await touchHold("SwitchKeys_Steam", 40);
  await waitLayoutChange();
  const ls = await layoutState();
  const open = await panelOpen();
  await backToLetters();
  return { ok: ls !== 0 && !open, detail: `layoutState ${ls} panel ${open}` };
});

await scenario("A held on the focused emoji key opens the panel; D-pad + A toggle a setting", async () => {
  await aButton("SwitchKeys_Steam", 620);
  const open = await panelOpen();
  const path = [];
  for (let i = 0; i < 8; i++) {
    const f = await page.evaluate(() => window.__oskTrackpadFix.panel.focus);
    path.push(f);
    if (f === "OSKSet_t_swipe") break;
    await gamepad(10);
  }
  const focus = await page.evaluate(() => window.__oskTrackpadFix.panel.focus);
  await shot("panel-gamepad-focus");
  await gamepad(1);
  const off = (await settings()).swipe;
  await gamepad(1);
  const on = (await settings()).swipe;
  await gamepad(2);
  return {
    ok: open && focus === "OSKSet_t_swipe" && off === false && on === true && !(await panelOpen()),
    detail: `panel ${open} focus ${focus} via ${path} swipe ${off}->${on}`,
  };
});

await scenario("A tap on the emoji key still switches to emoji", async () => {
  await aButton("SwitchKeys_Steam", 30);
  await waitLayoutChange();
  const ls = await layoutState();
  const open = await panelOpen();
  await backToLetters();
  return { ok: ls !== 0 && !open, detail: `layoutState ${ls} panel ${open}` };
});

async function waitLayoutChange() {
  for (let i = 0; i < 100 && (await layoutState()) === 0; i++) await sleep(20);
  await settle(page);
}

const openPanel = async () => {
  await page.evaluate(() => window.__oskTrackpadFix.openSettings());
  if (!(await panelOpen())) throw new Error("panel did not open");
};
const closePanel = async () => {
  await padTap("R", "OSKSet_close");
};

await scenario("swipe typing off: a pad drag types the pressed key instead of a word", async (out) => {
  await openPanel();
  await toggle("swipe");
  const s = await settings();
  await closePanel();
  await padStroke("L", "the");
  const o = await out();
  await openPanel();
  await toggle("swipe");
  await closePanel();
  await page.evaluate(() => {
    window.__keyLog.length = 0;
  });
  await padTap("R", " ");
  await padStroke("L", "the");
  const back = await out();
  return { ok: s.swipe === false && o === "t" && back === " the", detail: `off ${JSON.stringify(o)} back on ${JSON.stringify(back)}` };
});

await scenario("suggestion row off removes the OSKSug keys, keycodes stay aligned; back on restores it", async (out) => {
  const codeList = () =>
    page.$$eval("[data-key]", (els) =>
      els
        .map((e) => [e.getAttribute("data-key"), e.getAttribute("data-keycode")])
        .filter(([k]) => !k.startsWith("OSKSug_"))
        .map((x) => x.join(":"))
        .join(" "),
    );
  const codesBefore = await codeList();
  await openPanel();
  await toggle("suggestions");
  await closePanel();
  await settle(page);
  await shot("keyboard-no-suggestions");
  const keys = await page.$$eval("[data-key]", (els) =>
    els.map((e) => [e.getAttribute("data-key"), e.getAttribute("data-keycode"), e.getAttribute("data-key-row")]),
  );
  const sugGone = !keys.some(([k]) => k.startsWith("OSKSug_"));
  const aligned = (await codeList()) === codesBefore;
  const rows = new Set(keys.map((k) => k[2])).size;
  const codeRows = await kbEval((kb) => kb.state.standardLayout.rgKeycodes.length);
  const escRow = keys.find(([k]) => k === "Escape")?.[2];
  await padTap("L", "a");
  await padTap("R", "o");
  const typed = await out();
  await openPanel();
  await toggle("suggestions");
  await closePanel();
  await page.waitForSelector('[data-key="OSKSug_0"]');
  const nSug = await page.$$eval('[data-key^="OSKSug_"]', (els) => els.length);
  const codesAfter = await codeList();
  const restored = nSug === 3 && codesAfter === codesBefore;
  if (!restored) results.push(`  nSug ${nSug} panel ${await panelOpen()}\n  before ${codesBefore}\n  after  ${codesAfter}`);
  return {
    ok: sugGone && aligned && rows === codeRows && escRow === "0" && typed.trim() === "ao" && restored,
    detail: `gone ${sugGone} aligned ${aligned} rows ${rows}/${codeRows} escRow ${escRow} typed ${JSON.stringify(typed)} restored ${restored}`,
  };
});

await scenario("learn off: a new word typed twice is not learned and nothing is written", async () => {
  await openPanel();
  await toggle("learn");
  const learnOff = (await settings()).learn === false;
  await closePanel();
  await page.evaluate(() => {
    const F = window.__oskTrackpadFix,
      j = F.takeUserWords();
    if (j) F.ackUserWords(JSON.parse(j).rev);
  });
  await padTap("R", " ");
  for (let i = 0; i < 2; i++) {
    for (const k of "blorptex") await padTap("L", k);
    await padTap("R", " ");
  }
  const known = await page.evaluate(() => window.__oskEngine.known("blorptex"));
  const written = await page.evaluate(() => window.__oskTrackpadFix.takeUserWords());
  const sug = await page.evaluate(() => [0, 1, 2].map((i) => document.querySelector(`[data-key="OSKSug_${i}"]`)?.textContent ?? ""));
  await openPanel();
  await toggle("learn");
  await closePanel();
  return {
    ok: learnOff && !known && written === null,
    detail: `learnOff ${learnOff} known ${known} written ${written?.slice(0, 80)} sug ${JSON.stringify(sug)}`,
  };
});

await scenario("autocorrect off: typed text is left alone", async (out) => {
  await openPanel();
  await toggle("autocorrect");
  await closePanel();
  await page.evaluate(() => {
    window.__keyLog.length = 0;
  });
  for (const k of "teh") await padTap("L", k);
  await padTap("R", " ");
  const o = await out();
  await openPanel();
  await toggle("autocorrect");
  await closePanel();
  return { ok: o === "teh ", detail: `text ${JSON.stringify(o)}` };
});

await scenario("auto-space off: two swiped words are not separated", async (out) => {
  await openPanel();
  await toggle("autoSpace");
  await closePanel();
  await page.evaluate(() => {
    window.__keyLog.length = 0;
  });
  await padStroke("L", "the");
  await settle(page);
  await padStroke("R", "job");
  const o = await out();
  await openPanel();
  await toggle("autoSpace");
  await closePanel();
  return { ok: o === "thejob", detail: `text ${JSON.stringify(o)}` };
});

await scenario("swipe trail off: nothing is drawn during a swipe", async () => {
  await openPanel();
  await toggle("trail");
  await closePanel();
  await padTap("R", " ");
  const pts = [await center("t"), await center("h"), await center("e")];
  await padAt("L", pts[0].x, pts[0].y);
  await vgp("vgp_onbuttondown", BTN.L);
  for (const p of pts.slice(1)) {
    await padAt("L", p.x, p.y);
    await sleep(40);
  }
  await sleep(100);
  const painted = await page.evaluate(() => {
    const c = document.getElementById("osk-swipe-trail");
    if (!c || !c.width) return 0;
    return c
      .getContext("2d")
      .getImageData(0, 0, c.width, c.height)
      .data.some((v, i) => i % 4 === 3 && v > 0)
      ? 1
      : 0;
  });
  await vgp("vgp_onbuttonup", BTN.L);
  await padIdle("L");
  await settle(page);
  await openPanel();
  await toggle("trail");
  await closePanel();
  return { ok: painted === 0, detail: `painted ${painted}` };
});

await scenario("LB / RB off: LB no longer holds Ctrl", async () => {
  await openPanel();
  await toggle("bumpers");
  await closePanel();
  await vgp("vgp_onbuttondown", 5);
  await settle(page);
  const ctrl = await kbEval((kb) => kb.state.toggleStates.Control);
  const sent = await page.evaluate(() => [...window.__oskTrackpadFix.sent.keys()]);
  await vgp("vgp_onbuttonup", 5);
  await openPanel();
  await toggle("bumpers");
  await closePanel();
  await vgp("vgp_onbuttondown", 5);
  await settle(page);
  const ctrlOn = await kbEval((kb) => kb.state.toggleStates.Control);
  await vgp("vgp_onbuttonup", 5);
  await settle(page);
  return { ok: !(ctrl & 7) && sent.length === 0 && !!(ctrlOn & 7), detail: `off ctrl ${ctrl} sent ${sent} on ctrl ${ctrlOn}` };
});

await scenario("learned words list: shown with counts, tap forgets one", async () => {
  await page.evaluate(() => {
    const e = window.__oskEngine;
    for (let i = 0; i < 3; i++) e.learn("flumpet", null);
    e.learn("quxbaz", null);
    for (let i = 0; i < 5; i++) e.learn("the", null);
  });
  await openPanel();
  await padTap("L", "OSKSet_tab_words");
  await shot("panel-learned");
  const chips = await items();
  const flump = chips.find(([, t]) => t.startsWith("flumpet"));
  const counted = chips.some(([, t]) => t === "flumpet×3") && chips[0]?.[1].startsWith("the");
  await touchTap(flump[0]);
  const gone = !(await page.evaluate(() => window.__oskEngine.exportUser().words.flumpet));
  const still = (await items()).map((c) => c[1]);
  const undo = await page.evaluate(() => document.querySelector('[data-key="OSKSet_undo"]')?.textContent);
  return {
    ok: counted && gone && !still.some((t) => t.startsWith("flumpet")) && undo === 'Forgot "flumpet" — A to undo',
    detail: `chips ${JSON.stringify(chips.map((c) => c[1]))} forgotten ${gone}`,
  };
});

await scenario("blocked words list: tap unblocks", async () => {
  await page.evaluate(() => {
    window.__oskTrackpadFix.blocked.add("people");
    window.__oskTrackpadFix.blocked.add("gamer");
  });
  await padTap("R", "OSKSet_v_list_1");
  await shot("panel-blocked");
  const chips = await items();
  const people = chips.find(([, t]) => t === "people");
  await padTap("R", people[0]);
  const blocked = await page.evaluate(() => [...window.__oskTrackpadFix.blocked]);
  return {
    ok: !blocked.includes("people") && blocked.includes("gamer"),
    detail: `before ${JSON.stringify(chips.map((c) => c[1]))} after ${JSON.stringify(blocked)}`,
  };
});

await scenario("learned words list pages through every learned word", async () => {
  await page.evaluate(() => {
    for (let i = 0; i < 40; i++) {
      const w = "zq" + String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26));
      for (let n = 0; n <= i; n++) window.__oskEngine.learn(w, null);
    }
  });
  await padTap("L", "OSKSet_v_list_0");
  const count = async () => (await items()).map((c) => c[1]);
  const p1 = await count();
  await shot("panel-learned-pages");
  await padTap("R", "OSKSet_next");
  const p2 = await count();
  const pageNo = await page.evaluate(() => document.querySelector(".osk-set-pageno")?.textContent);
  const pages = Number(String(pageNo).match(/\/\s*(\d+)/)?.[1] ?? 0);
  const lastPage = pages >= 4;
  await padTap("L", "OSKSet_prev");
  const back = await count();
  await page.evaluate(() => {
    for (let i = 0; i < 40; i++)
      window.__oskEngine.forget("zq" + String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26)));
  });
  return {
    ok: p1.length === 12 && p1[0] === "zqbn×40" && p2.length === 12 && p2[0] !== p1[0] && lastPage && back[0] === p1[0],
    detail: `page1 ${p1.slice(0, 3)} page2 ${p2.slice(0, 3)} n ${p1.length}/${p2.length} ${pageNo}`,
  };
});

await scenario("forget everything asks for confirmation", async () => {
  await padTap("L", "OSKSet_tab_system");
  await padTap("R", "OSKSet_forget_all");
  await shot("panel-confirm");
  const first = await page.evaluate(() => [window.__oskEngine.known("quxbaz"), window.__oskTrackpadFix.blocked.size]);
  await padTap("R", "OSKSet_forget_all");
  const second = await page.evaluate(() => [window.__oskEngine.known("quxbaz"), window.__oskTrackpadFix.blocked.size]);
  await closePanel();
  return {
    ok: first[0] === true && first[1] === 1 && second[0] === false && second[1] === 0,
    detail: `after first tap ${first} after second ${second}`,
  };
});

await scenario("closing the keyboard closes the panel", async () => {
  await openPanel();
  await page.evaluate(() => window.__sim.vkm.SetVirtualKeyboardHidden());
  await page.evaluate(() => window.__oskTrackpadFix.tickNow());
  const open = await panelOpen();
  await page.evaluate(() => window.__sim.vkm.SetVirtualKeyboardVisible());
  await waitKeyboard(page);
  return { ok: !open && !(await panelOpen()), detail: `panel after close ${open}` };
});

const focused = () => page.evaluate(() => document.querySelector(".osk-set-focus")?.getAttribute("data-key") ?? null);
async function focusTo(key) {
  for (let i = 0; i < 30; i++) {
    if ((await focused()) === key) return;
    await gamepad(10);
  }
  throw new Error(`could not focus ${key}, at ${await focused()}`);
}
const sliderVal = (k) =>
  page.evaluate((k) => Number(document.querySelector(`[data-key="OSKSet_s_${k}"]`)?.getAttribute("aria-valuenow")), k);

await scenario(
  "Look sliders: defaults, D-pad steps of 5 with a held repeat, clamping, a pad click on the bar, live CSS, Reset look; one-thumb pad widens Steam's right pointer area",
  async () => {
    const d = await settings();
    await openPanel();
    await section("s_spaceAlpha");
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('.osk-set-page.on [role="slider"]')].map((e) => [
        e.getAttribute("data-key"),
        e.getAttribute("aria-valuenow"),
        e.querySelector(".osk-set-val")?.textContent,
      ]),
    );
    const vars = () => page.evaluate(() => document.getElementById("osk-look-vars")?.textContent ?? "");
    const lookCss = () => page.evaluate(() => document.getElementById("osk-look-style")?.textContent ?? "");
    const css0 = await lookCss();
    await focusTo("OSKSet_s_spaceAlpha");
    await gamepad(12);
    const up = (await settings()).spaceAlpha;
    await gamepad(11);
    await gamepad(11);
    const down = (await settings()).spaceAlpha;
    const varsOpen = await vars();
    await closePanel();
    const varsMid = await vars();
    await openPanel();
    await section("s_spaceAlpha");
    await focusTo("OSKSet_s_spaceAlpha");
    await vgp("vgp_onbuttondown", 12);
    await sleep(1000);
    await vgp("vgp_onbuttonup", 12);
    const held = (await settings()).spaceAlpha;
    await sleep(300);
    const after = (await settings()).spaceAlpha;
    const shown = await sliderVal("spaceAlpha");
    const holdUntil = async (button, want) => {
      await vgp("vgp_onbuttondown", button);
      for (let t = 0; t < 100 && (await settings()).spaceAlpha !== want; t++) await sleep(50);
      await sleep(300);
      await vgp("vgp_onbuttonup", button);
      return (await settings()).spaceAlpha;
    };
    const top = await holdUntil(12, 100);
    const bottom = await holdUntil(11, 0);
    await closePanel();
    const varsZero = await vars();
    await openPanel();
    await section("s_spaceAlpha");
    const refused = await page.evaluate(() =>
      [
        ["spaceAlpha", 105],
        ["spaceAlpha", -5],
        ["keyAlpha", 33],
        ["blur", 3],
        ["boardAlpha", "50"],
      ].map(([k, v]) => window.__oskTrackpadFix.setSetting(k, v)),
    );
    const css1 = await lookCss();
    const track = await page.evaluate(() => {
      const row = document.querySelector('[data-key="OSKSet_s_boardAlpha"]');
      row.scrollIntoView({ block: "nearest" });
      const r = row.querySelector(".osk-set-track").getBoundingClientRect();
      return { x: r.left + r.width * 0.7, y: r.top + r.height / 2 };
    });
    await padAt("R", track.x, track.y);
    await vgp("vgp_onbuttondown", BTN.R);
    await sleep(20);
    await vgp("vgp_onbuttonup", BTN.R);
    await padIdle("R");
    const clicked = (await settings()).boardAlpha;
    await focusTo("OSKSet_c_blur");
    await gamepad(12);
    await gamepad(12);
    await gamepad(12);
    const blur = (await settings()).blur;
    await choose("theme", "Steam");
    const label = await chosen("theme");
    await choose("reach", "Right only");
    const narrowOpen = !/width:100% !important/.test(await lookCss());
    await closePanel();
    const blurCss = await vars();
    const wide = /width:100% !important/.test(await lookCss());
    await openPanel();
    await choose("reach", "Own half");
    await section("reset_look");
    await padTap("R", "OSKSet_reset_look");
    const reset = await settings();
    await closePanel();
    const ok =
      d.boardAlpha === 40 &&
      d.keyAlpha === 100 &&
      d.spaceAlpha === 30 &&
      d.stripAlpha === 90 &&
      d.blur === 0 &&
      d.theme === "modern" &&
      !("opacity" in d) &&
      rows.length === 4 &&
      rows[2][2] === "30 %" &&
      rows[3][2] === "90 %" &&
      up === 35 &&
      down === 25 &&
      /--osk-sa:0\.3[;}]/.test(varsOpen) &&
      /--osk-sa:0\.25/.test(varsMid) &&
      held >= 50 &&
      held <= 75 &&
      after === held &&
      shown === held &&
      top === 100 &&
      bottom === 0 &&
      /--osk-sa:0[;}]/.test(varsZero) &&
      refused.every((r) => r === false) &&
      css1 === css0 &&
      clicked === 70 &&
      blur === 2 &&
      /backdrop-filter:blur\(16px\)/.test(blurCss) &&
      label === "Steam" &&
      narrowOpen &&
      wide &&
      reset.theme === "modern" &&
      reset.boardAlpha === 40 &&
      reset.keyAlpha === 100 &&
      reset.spaceAlpha === 30 &&
      reset.stripAlpha === 90 &&
      reset.blur === 0 &&
      reset.reach === 55;
    return {
      ok,
      detail: `defaults ${JSON.stringify([d.theme, d.boardAlpha, d.keyAlpha, d.spaceAlpha, d.stripAlpha, d.blur])} rows ${JSON.stringify(rows)} step ${up}/${down} held ${held} after ${after} shown ${shown} top ${top} bottom ${bottom} refused ${refused} cssSame ${css1 === css0} clicked ${clicked} blur ${blur} label ${label} wide ${wide} reset ${JSON.stringify([reset.theme, reset.boardAlpha, reset.keyAlpha, reset.spaceAlpha, reset.stripAlpha, reset.blur])}`,
    };
  },
);

await scenario(
  "Pad reach chooser: Past the middle widens Steam's pointer areas to 75 %, an invalid value is refused, Own half restores",
  async () => {
    await openPanel();
    await choose("reach", "Past middle");
    const a = await settings();
    const label = await chosen("reach");
    await closePanel();
    const css = await page.evaluate(() => document.getElementById("osk-look-style")?.textContent ?? "");
    await openPanel();
    const wide = (css.match(/width:75% !important/g) ?? []).length;
    const refused = await page.evaluate(() => window.__oskTrackpadFix.setSetting("reach", 60));
    const kept = (await settings()).reach;
    await choose("reach", "Own half");
    const b = await settings();
    await closePanel();
    const css2 = await page.evaluate(() => document.getElementById("osk-look-style")?.textContent ?? "");
    return {
      ok:
        a.reach === 75 &&
        wide === 2 &&
        refused === false &&
        kept === 75 &&
        label === "Past middle" &&
        b.reach === 55 &&
        !/width:\d+% !important/.test(css2),
      detail: `reach ${a.reach} wide ${wide} refused ${refused} kept ${kept} label ${label} back ${b.reach}`,
    };
  },
);

await scenario("Full-width pad up/down shows only while a pad covers the whole keyboard (Whole or Right pad only)", async () => {
  await openPanel();
  const out = {};
  for (const label of ["Own half", "Past middle", "Whole", "Right only"]) {
    await choose("reach", label);
    out[label] = await page.evaluate(() => document.querySelector('[data-key="OSKSet_c_oneAspect"]')?.hidden ?? null);
  }
  const spans = await page.evaluate(() => window.__oskTrackpadFix.modeApi.spans());
  await choose("reach", "Own half");
  await closePanel();
  return {
    ok:
      out["Own half"] === true &&
      out["Past middle"] === true &&
      out.Whole === false &&
      out["Right only"] === false &&
      spans.L === 0.55 &&
      spans.R === 1,
    detail: `${JSON.stringify(out)} right-only spans ${JSON.stringify(spans)}`,
  };
});

await scenario("Swipe threshold chooser: Normal by default, Large and Small apply, an invalid value is refused", async () => {
  await openPanel();
  const first = (await settings()).deadzone;
  await choose("deadzone", "Large");
  const a = await settings();
  const refused = await page.evaluate(() => window.__oskTrackpadFix.setSetting("deadzone", 5));
  const kept = (await settings()).deadzone;
  const label = await chosen("deadzone");
  await choose("deadzone", "Small");
  const b = await settings();
  await choose("deadzone", "Normal");
  const c = await settings();
  await closePanel();
  return {
    ok:
      first === 100 &&
      a.deadzone === 130 &&
      refused === false &&
      kept === 130 &&
      label === "Large" &&
      b.deadzone === 80 &&
      c.deadzone === 100,
    detail: `default ${first} large ${a.deadzone} refused ${refused} kept ${kept} label ${label} small ${b.deadzone} normal ${c.deadzone}`,
  };
});

const ANALOG = { L: 19, R: 21 };
async function padWake() {
  await kbEval((kb) => {
    for (const id of [19, 21]) kb.m_trackpadInput.m_AnalogCallbacks.Dispatch(id, 0, 0.1, 0.1);
  });
  await sleep(80);
}
// Raw pad samples through Steam's analog callback (so the panel's wrapper and hit test run), aimed at a screen point by
// inverting the pad's linear mapping from two corner samples.
const padTo = (side, x, y) =>
  kbEval(
    (kb, id, side, x, y) => {
      const D = kb.m_trackpadInput.m_AnalogCallbacks;
      const pad = side === "L" ? kb.m_leftTrackpad : kb.m_rightTrackpad;
      const at = (u, v) => {
        D.Dispatch(id, 0, u, v);
        D.Dispatch(id, 0, u, v);
        return [pad.x, pad.y];
      };
      const [x0, y0] = at(-1, -1);
      const [x1, y1] = at(1, 1);
      at(-1 + (2 * (x - x0)) / (x1 - x0), -1 + (2 * (y - y0)) / (y1 - y0));
      return pad.lastElement?.getAttribute("data-key") ?? null;
    },
    ANALOG[side],
    side,
    x,
    y,
  );
const padOn = async (side, key, fx = 0.5, fy = 0.5) => {
  const r = await page.evaluate((key) => document.querySelector(`[data-key="${key}"]`)?.getBoundingClientRect().toJSON(), key);
  return padTo(side, r.left + r.width * fx, r.top + r.height * fy);
};
const padOff = () =>
  kbEval((kb) => {
    for (const id of [19, 21]) kb.m_trackpadInput.m_AnalogCallbacks.Dispatch(id, 0, 0, 0);
  });

await scenario("pads reach every control on every tab, with the keyboard full and short, and nothing outside the panel", async () => {
  const out = [];
  for (const short of [false, true]) {
    await page.evaluate((s) => window.__oskTrackpadFix.setSetting("suggestions", !s), short);
    await settle(page);
    await openPanel();
    for (const t of ["typing", "input", "look", "words", "system"]) {
      await page.evaluate((t) => document.querySelector(`[data-key="OSKSet_tab_${t}"]`).click(), t);
      await sleep(60);
      await padWake();
      const r = await kbEval((kb) => {
        const seen = new Set();
        for (const [side, id] of [
          ["L", 19],
          ["R", 21],
        ])
          for (let ux = -1; ux <= 1.001; ux += 0.02)
            for (let uy = -1; uy <= 1.001; uy += 0.02) {
              kb.m_trackpadInput.m_AnalogCallbacks.Dispatch(id, 0, ux, uy);
              kb.m_trackpadInput.m_AnalogCallbacks.Dispatch(id, 0, ux, uy);
              const k = (side === "L" ? kb.m_leftTrackpad : kb.m_rightTrackpad).lastElement?.getAttribute("data-key");
              if (k) seen.add(k);
            }
        const want = [...document.querySelectorAll(".osk-set-page.on [data-key], .osk-set-tabs [data-key]")]
          .filter((e) => e.getClientRects().length)
          .map((e) => e.getAttribute("data-key"));
        const page = document.querySelector(".osk-set-page.on");
        return {
          miss: want.filter((k) => !seen.has(k)),
          outside: [...seen].filter((k) => !k.startsWith("OSKSet_")),
          fits: page.scrollHeight <= page.clientHeight,
          n: want.length,
        };
      });
      await padOff();
      out.push({ t: (short ? "short " : "") + t, ...r });
    }
    await closePanel();
  }
  await page.evaluate(() => window.__oskTrackpadFix.setSetting("suggestions", true));
  await settle(page);
  const bad = out.filter((r) => r.miss.length || r.outside.length || !r.fits || !r.n);
  return { ok: out.length === 10 && !bad.length, detail: JSON.stringify(bad.length ? bad : out.map((r) => `${r.t}:${r.n}`)) };
});

await scenario("a pad on a segment rings it and shows that choice's description in its row until the pad leaves", async () => {
  const mode0 = (await settings()).mode;
  await openPanel();
  await padWake();
  const desc = () => page.evaluate(() => document.querySelector('[data-key="OSKSet_c_mode"] .osk-set-desc').textContent);
  const before = await desc();
  const hit = await padOn("L", "OSKSet_v_mode_0");
  const ring = await page.evaluate(() => document.querySelector('[data-key="OSKSet_v_mode_0"]').classList.contains("osk-set-hover"));
  const peek = await desc();
  const blue = await page.evaluate(() => document.querySelector('[data-key="OSKSet_c_mode"] .osk-set-desc').classList.contains("peek"));
  await padOn("L", "OSKSet_t_swipe");
  const after = await desc();
  const mode = (await settings()).mode;
  await padOff();
  await closePanel();
  return {
    ok: hit === "OSKSet_v_mode_0" && ring && blue && !!before && peek === "Standard: Steam's layout" && after === before && mode === mode0,
    detail: JSON.stringify({ hit, ring, before, peek, blue, after, mode }),
  };
});

await scenario(
  "a pad click on a slider's track sets the value and drags it until release; a click on its label drags from the value",
  async () => {
    await setSetting("keyAlpha", 100);
    await openPanel();
    await section("s_keyAlpha");
    await padWake();
    const val = () => sliderVal("keyAlpha");
    const track = await page.evaluate(() =>
      document.querySelector('[data-key="OSKSet_s_keyAlpha"] .osk-set-track').getBoundingClientRect().toJSON(),
    );
    const ty = track.top + track.height / 2;
    const tx = (f) => track.left + track.width * f;
    await padTo("R", tx(0.2), ty);
    await vgp("vgp_onbuttondown", BTN.R);
    const down = await val();
    const steps = [];
    for (const f of [0.35, 0.5, 0.7]) {
      await padTo("R", tx(f), ty);
      steps.push(await val());
    }
    await vgp("vgp_onbuttonup", BTN.R);
    await padTo("R", tx(0.1), ty);
    const released = await val();
    const label = await page.evaluate(() =>
      document.querySelector('[data-key="OSKSet_s_keyAlpha"] .osk-set-label').getBoundingClientRect().toJSON(),
    );
    const ly = label.top + label.height / 2;
    await padTo("R", label.left + 4, ly);
    await vgp("vgp_onbuttondown", BTN.R);
    const grabbed = await val();
    await padTo("R", label.left + 4 + track.width * 0.25, ly);
    const moved = await val();
    await vgp("vgp_onbuttonup", BTN.R);
    await padOff();
    const focus = await focused();
    await setSetting("keyAlpha", 100);
    await closePanel();
    return {
      ok: down === 20 && steps.join() === "35,50,70" && released === 70 && grabbed === 70 && moved === 95 && focus === "OSKSet_s_keyAlpha",
      detail: JSON.stringify({ down, steps, released, grabbed, moved, focus }),
    };
  },
);

let saved = null;
await scenario(
  "look sliders persist across a restart; an old opacity setting migrates into the background and key alphas; removed modes become Big letter keys and the one-thumb toggle becomes Right pad only",
  async () => {
    await page.evaluate(() => {
      const f = window.__oskTrackpadFix;
      f.setSetting("boardAlpha", 55);
      f.setSetting("keyAlpha", 85);
      f.setSetting("spaceAlpha", 10);
      f.setSetting("stripAlpha", 65);
      f.setSetting("blur", 1);
    });
    const file = JSON.parse(await page.evaluate(() => window.__oskTrackpadFix.takeUserWords()));
    await restartSteam();
    await boot(null);
    const kept = await settings();
    const pick = (s) => [s.theme, s.boardAlpha, s.keyAlpha, s.spaceAlpha, s.stripAlpha, s.blur];
    const migrate = async (stored, fromFile) => {
      await restartSteam();
      await page.evaluate(
        (s) => {
          window.localStorage.clear();
          if (s) window.localStorage.setItem("oskSwipeSettings", JSON.stringify(s));
        },
        fromFile ? null : stored,
      );
      await boot(fromFile ? { ...file, settings: stored } : null);
      const s = await settings();
      return { s: pick(s), opacity: "opacity" in s };
    };
    const m80 = await migrate({ consent: true, tipShown: true, opacity: 80 });
    const m90 = await migrate({ consent: true, tipShown: true, opacity: 90, theme: "oled" }, true);
    const m100 = await migrate({ consent: true, tipShown: true, opacity: 100, theme: "steam" });
    const m70 = await migrate({ consent: true, tipShown: true, opacity: 70 });
    const deck = {
      swipe: true,
      autocorrect: false,
      suggestions: true,
      learn: true,
      trail: true,
      autoSpace: true,
      removeAutoSpace: true,
      bumpers: true,
      onePad: false,
      echo: true,
      slideCursor: true,
      enterCloses: true,
      privateMode: false,
      typingLog: true,
      tipShown: true,
      consent: true,
      logFile: true,
      oneAspect: 1,
      reach: 55,
      deadzone: 100,
      theme: "modern",
      opacity: 80,
      mode: "bigkeys",
    };
    const m023 = await migrate(deck, true);
    const rest = await settings();
    const kept023 = Object.entries(deck).every(([k, v]) => k === "opacity" || k === "onePad" || rest[k] === v);
    const junk = await migrate({ consent: true, tipShown: true, opacity: "x", boardAlpha: 42, spaceAlpha: 300, blur: "on" });
    await migrate({ consent: true, tipShown: true, onePad: true, reach: 75, mode: "sloppy" });
    const removed = await settings();
    await migrate({ consent: true, tipShown: true, mode: "columns" }, true);
    const removed2 = await settings();
    await page.evaluate(() => {
      const f = window.__oskTrackpadFix;
      for (const [k, v] of Object.entries({ theme: "modern", boardAlpha: 40, keyAlpha: 100, spaceAlpha: 30, stripAlpha: 90, blur: 0 }))
        f.setSetting(k, v);
    });
    const j = (x) => JSON.stringify(x);
    return {
      ok:
        file.settings?.spaceAlpha === 10 &&
        j(pick(kept)) === j(["modern", 55, 85, 10, 65, 1]) &&
        j(m80.s) === j(["modern", 30, 100, 30, 90, 0]) &&
        j(m90.s) === j(["oled", 70, 100, 30, 90, 0]) &&
        j(m100.s) === j(["steam", 100, 100, 30, 100, 0]) &&
        j(m70.s) === j(["modern", 30, 100, 30, 90, 0]) &&
        j(m023.s) === j(["modern", 30, 100, 30, 90, 0]) &&
        kept023 &&
        j(junk.s) === j(["modern", 40, 100, 30, 90, 0]) &&
        removed.reach === "right" &&
        removed.mode === "bigkeys" &&
        !("onePad" in removed) &&
        removed2.mode === "bigkeys" &&
        removed2.reach === 55 &&
        ![m80, m90, m100, m70, m023, junk].some((m) => m.opacity),
      detail: `saved ${file.settings?.spaceAlpha} kept ${j(pick(kept))} 80 ${j(m80.s)} oled90 ${j(m90.s)} steam100 ${j(m100.s)} 70 ${j(m70.s)} v0.2.3 deck ${j(m023.s)} rest kept ${kept023} junk ${j(junk.s)} removed ${j([removed.reach, removed.mode, removed2.mode])}`,
    };
  },
);

await scenario("settings are in takeUserWords and come back after a Steam restart", async () => {
  await openPanel();
  await toggle("autocorrect");
  await toggle("trail");
  await toggle("suggestions");
  await choose("reach", "Whole");
  await closePanel();
  await page.evaluate(() => window.__oskEngine.learn("zibbet", null));
  saved = JSON.parse(await page.evaluate(() => window.__oskTrackpadFix.takeUserWords()));
  await restartSteam();
  await page.evaluate(() => window.localStorage.clear());
  await boot(saved);
  const s = await settings();
  const sug = await page.evaluate(() => !!document.querySelector('[data-key^="OSKSug_"]'));
  const known = await page.evaluate(() => window.__oskEngine?.known("zibbet"));
  await openPanel();
  await shot("panel-after-restart-short-keyboard");
  await closePanel();
  return {
    ok:
      saved.settings?.autocorrect === false &&
      s.autocorrect === false &&
      s.trail === false &&
      s.suggestions === false &&
      s.swipe === true &&
      saved.settings?.reach === 100 &&
      s.reach === 100 &&
      !sug &&
      known === true,
    detail: `saved ${JSON.stringify(saved.settings)} loaded ${JSON.stringify(s)} sugRow ${sug} known ${known}`,
  };
});

await scenario("without the file the settings come back from localStorage", async () => {
  await openPanel();
  await toggle("suggestions");
  await toggle("autocorrect");
  await choose("reach", "Own half");
  await closePanel();
  await restartSteam();
  await boot(null);
  const s = await settings();
  const sug = await page.evaluate(() => !!document.querySelector('[data-key="OSKSug_0"]'));
  return {
    ok:
      Object.entries(s).every(([k, v]) =>
        ["trail", "enterCloses", "privateMode", "typingLog", "logFile"].includes(k) ? v === false : typeof v !== "boolean" || v === true,
      ) &&
      s.reach === 55 &&
      sug,
    detail: `loaded ${JSON.stringify(s)} sugRow ${sug}`,
  };
});

await scenario("a setting changed after the last file save wins over the older file copy after a restart", async () => {
  await page.evaluate(() => window.localStorage.clear());
  await restartSteam();
  await boot(null);
  await page.evaluate(() => {
    window.__oskEngine.learn("zibbet", null);
    window.__oskTrackpadFix.setSetting("trail", false);
  });
  const older = JSON.parse(await page.evaluate(() => window.__oskTrackpadFix.takeUserWords()));
  await page.evaluate(() => {
    window.__oskTrackpadFix.setSetting("autocorrect", false);
    window.__oskTrackpadFix.setSetting("reach", 100);
  });
  await restartSteam();
  await boot(older);
  const s = await settings();
  const known = await page.evaluate(() => window.__oskEngine?.known("zibbet"));
  return {
    ok: older.settings.autocorrect === true && s.autocorrect === false && s.reach === 100 && known === true,
    detail: `file copy autocorrect ${older.settings.autocorrect} loaded ${JSON.stringify({ autocorrect: s.autocorrect, reach: s.reach })} word kept ${known}`,
  };
});

await scenario("a newer file copy wins over an older localStorage copy", async () => {
  await page.evaluate(() => window.__oskTrackpadFix.setSetting("trail", true));
  const newer = JSON.parse(await page.evaluate(() => window.__oskTrackpadFix.takeUserWords()));
  await page.evaluate(() => {
    const old = JSON.parse(window.localStorage.getItem("oskSwipeSettings"));
    window.localStorage.setItem("oskSwipeSettings", JSON.stringify({ ...old, trail: false, at: 1 }));
  });
  await restartSteam();
  await boot(newer);
  const s = await settings();
  return {
    ok: s.trail === true && s.autocorrect === false,
    detail: `file at ${newer.settings.at} loaded trail ${s.trail} autocorrect ${s.autocorrect}`,
  };
});

await scenario("a file copy without a timestamp still beats localStorage without one", async () => {
  await page.evaluate(() => window.localStorage.setItem("oskSwipeSettings", JSON.stringify({ consent: true, autocorrect: true })));
  await restartSteam();
  await boot({ words: {}, settings: { consent: true, autocorrect: false } });
  const s = await settings();
  return { ok: s.autocorrect === false, detail: `loaded autocorrect ${s.autocorrect}` };
});

results.push(`status: ${await page.evaluate(() => window.__oskTrackpadFix.status())}`);
console.log(results.join("\n"));
console.log(failures ? `${failures} FAILED` : "ALL PASS");
await browser.close();
process.exit(failures ? 1 : 0);
