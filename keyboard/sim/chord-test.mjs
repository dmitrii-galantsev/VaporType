import { openSim, inject, settle, waitKeyboard } from "./run.mjs";
import { readRuntime as read } from "../runtime.mjs";
import { sleep } from "./helpers.mjs";

const PRELUDE = ["swipe/words.js", "swipe/lm.js", "swipe/engine.js", "modes.js"].map(read).join("\n;\n");
const PATCH = process.env.PATCH ? (await import("node:fs")).readFileSync(process.env.PATCH, "utf8") : read("patch.js");
const X = 3;
const B = 2;
const PAD = { L: 20, R: 22 };

const { browser } = await openSim();
let failures = 0;
const results = [];
const check = (ok, what, detail) => {
  if (!ok) failures++;
  results.push(`${ok ? "PASS" : "FAIL"} ${what}${detail !== undefined ? `\n      ${JSON.stringify(detail)}` : ""}`);
};

async function fresh({ consent }) {
  const { page, errors } = await openSim({ browser });
  await page.evaluate(PRELUDE);
  await page.evaluate(() => window.localStorage.clear());
  await inject(page, PATCH, { consent });
  const vgp = (type, button) =>
    page.evaluate(
      (type, button) => {
        const t = document.querySelector("[data-key]");
        t.dispatchEvent(new CustomEvent(type, { bubbles: true, cancelable: true, detail: { button, source: 1, is_repeat: false } }));
      },
      type,
      button,
    );
  const pad = (side, fields) =>
    page.evaluate(
      (side, fields) => {
        const key = document.querySelector("[data-key]");
        const fk = Object.keys(key).find((k) => k.startsWith("__reactFiber"));
        for (let f = key[fk]; f; f = f.return)
          if (typeof f.stateNode?.HandleTrackpadClick === "function")
            return (Object.assign(side === "L" ? f.stateNode.m_leftTrackpad : f.stateNode.m_rightTrackpad, fields), undefined);
      },
      side,
      fields,
    );
  const center = (k) =>
    page.evaluate((k) => {
      const e = [...document.querySelectorAll("[data-key]")].find(
        (e) => e.getAttribute("data-key") === k && e.getBoundingClientRect().width > 0,
      );
      const r = e.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, k);
  const padTap = async (side, k) => {
    const c = await center(k);
    await pad(side, { active: true, x: c.x, y: c.y });
    await vgp("vgp_onbuttondown", PAD[side]);
    await sleep(30);
    await vgp("vgp_onbuttonup", PAD[side]);
    await pad(side, { active: false });
    await settle(page);
  };
  const touchTap = async (k) => {
    const c = await center(k);
    await page.touchscreen.tap(c.x, c.y);
    await settle(page);
  };
  const text = () => page.evaluate(() => window.__keyLog.filter((x) => x[1] === "text").map((x) => x[2]));
  const clear = () => page.evaluate(() => (window.__keyLog.length = 0));
  const hide = async () => {
    await page.evaluate(() => window.__sim.vkm.SetVirtualKeyboardHidden());
    await page.evaluate(() => window.__oskTrackpadFix.tickNow());
  };
  const show = () => page.evaluate(() => window.__sim.vkm.SetVirtualKeyboardVisible());
  const tick = () => page.evaluate(() => window.__oskTrackpadFix.tickNow());
  const panelOpen = () => page.evaluate(() => !!document.querySelector(".osk-set")?.isConnected);
  const typeHey = async () => {
    await clear();
    await padTap("R", "h");
    await padTap("L", "e");
    await touchTap("y");
    await sleep(700);
    await settle(page);
    return text();
  };
  return { page, errors, vgp, pad, padTap, touchTap, text, clear, hide, show, tick, panelOpen, typeHey };
}

{
  const s = await fresh({ consent: false });
  await s.hide();
  await s.vgp("vgp_onbuttondown", X);
  await s.show();
  await s.tick();
  const card = await s.panelOpen();
  await s.vgp("vgp_onbuttonup", X);
  await s.vgp("vgp_onbuttondown", B);
  await s.vgp("vgp_onbuttonup", B);
  await waitKeyboard(s.page);
  const got = await s.typeHey();
  check(
    card && JSON.stringify(got) === '["h","e","y"]',
    "Steam+X: X released after the first-use card came up, card closed with B: pads and touch type, no Backspace repeat",
    { card, got },
  );
  await s.page.close();
}

{
  const s = await fresh({ consent: true });
  await s.page.evaluate(() => window.__oskTrackpadFix.openSettings());
  await settle(s.page);
  await s.pad("R", { active: true });
  await s.vgp("vgp_onbuttondown", PAD.R);
  await s.vgp("vgp_onbuttondown", X);
  await s.hide();
  await s.show();
  await waitKeyboard(s.page);
  const got = await s.typeHey();
  const idle = await s.page.evaluate(() => window.__oskTrackpadFix.idle());
  check(
    JSON.stringify(got) === '["h","e","y"]' && idle,
    "pad and X pressed on the settings panel, released while the keyboard was closed: reopened keyboard types",
    { got, idle },
  );
  await s.page.close();
}

{
  const s = await fresh({ consent: true });
  await s.page.evaluate(() => window.__oskTrackpadFix.openSettings());
  await settle(s.page);
  await s.vgp("vgp_onbuttondown", X);
  await s.vgp("vgp_onbuttonup", X);
  const open = await s.panelOpen();
  await s.vgp("vgp_onbuttondown", B);
  await s.vgp("vgp_onbuttonup", B);
  await settle(s.page);
  await s.clear();
  await sleep(700);
  const quiet = await s.text();
  const closed = !(await s.panelOpen());
  check(open && closed && quiet.length === 0, "X and B on the open settings panel still go to the panel only", { open, closed, quiet });
  await s.page.close();
}

{
  const s = await fresh({ consent: true });
  await s.touchTap("t");
  await s.touchTap("h");
  const c = await s.page.evaluate(() => {
    const e = [...document.querySelectorAll('[data-key="OSKSug_1"]')].find((e) => e.getBoundingClientRect().width > 0);
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await s.pad("R", { active: true, x: c.x, y: c.y });
  await s.vgp("vgp_onbuttondown", PAD.R);
  await settle(s.page, { max: 300 });
  await s.hide();
  await s.pad("R", { active: false });
  await s.show();
  await waitKeyboard(s.page);
  await s.clear();
  await s.padTap("R", "s");
  await settle(s.page, { max: 1500 });
  const got = await s.text();
  const st = await s.page.evaluate(() => ({ idle: window.__oskTrackpadFix.idle(), sugHold: !!window.__oskTrackpadFix.session.sugHold }));
  check(
    JSON.stringify(got) === '["s"]' && st.idle && !st.sugHold,
    "pad held on a suggestion chip while the keyboard closed, release lost: the same pad types after reopening",
    { got, ...st },
  );
  await s.page.close();
}

console.log(results.join("\n"));
console.log(failures ? `${failures} FAILED` : "ALL PASS");
await browser.close();
process.exit(failures ? 1 : 0);
