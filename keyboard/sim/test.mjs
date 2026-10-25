import fs from "node:fs";
import path from "node:path";
import { openSim, inject as injectWait, settle, waitKeyboard } from "./run.mjs";
import { readRuntime as read } from "../runtime.mjs";
import { sleep, withTiming } from "./helpers.mjs";

const patchSrc = read("patch.js");
const preludeSrc = ["swipe/words.js", "swipe/engine.js"].map(read).join("\n;\n");
const shots = process.env.SHOTS;

const NAMES = {
  41: "Esc",
  100: "Alt",
  101: "Shift",
  102: "Win",
  103: "Ctrl",
  105: "RShift",
  43: "Tab",
  40: "Enter",
  42: "Backspace",
  44: "Space",
  46: "=",
  79: "Right",
  80: "Left",
  81: "Down",
  82: "Up",
};
for (let i = 0; i < 26; i++) NAMES[4 + i] = String.fromCharCode(97 + i);
const name = (c) => NAMES[c] ?? `#${c}`;

function hostView(log) {
  const held = new Set();
  const out = [];
  for (const [, kind, v] of log) {
    if (kind === "text") out.push(held.size ? `TEXT-WITH-HELD[${[...held].join("+")}]:${JSON.stringify(v)}` : `text:${JSON.stringify(v)}`);
    else if (kind === "down") {
      const n = name(v);
      if (["Ctrl", "Alt", "Shift", "RShift", "Win"].includes(n)) held.add(n);
      else out.push([...held, n].join("+"));
    } else if (kind === "up") held.delete(name(v));
  }
  if (held.size) out.push(`STILL-HELD[${[...held].join("+")}]`);
  return out;
}

const { browser, page, errors } = await openSim();
let failures = 0;
const results = [];

async function inject() {
  await page.evaluate(preludeSrc);
  return injectWait(page, patchSrc);
}

async function clearLog() {
  await page.evaluate(() => {
    window.__keyLog.length = 0;
  });
}

async function log() {
  return page.evaluate(() => window.__keyLog.slice());
}

async function keyCenter(key, nth = 0) {
  return page.evaluate(
    (key, nth) => {
      const els = [...document.querySelectorAll(`[data-key]`)].filter(
        (e) => e.getAttribute("data-key") === key && e.getBoundingClientRect().width > 0,
      );
      const r = els[nth]?.getBoundingClientRect();
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    },
    key,
    nth,
  );
}

async function vgp(type, button, source = 1) {
  await page.evaluate(
    (type, button, source) => {
      const target = document.querySelector("[data-key]");
      target.dispatchEvent(new CustomEvent(type, { bubbles: true, cancelable: true, detail: { button, source, is_repeat: false } }));
    },
    type,
    button,
    source,
  );
  await sleep(30);
}

async function padMove(side, x, y) {
  await page.evaluate(
    (side, x, y) => {
      const key = document.querySelector("[data-key]");
      const fk = Object.keys(key).find((k) => k.startsWith("__reactFiber"));
      let kb;
      for (let f = key[fk]; f; f = f.return)
        if (typeof f.stateNode?.HandleTrackpadClick === "function") {
          kb = f.stateNode;
          break;
        }
      const pad = side === "L" ? kb.m_leftTrackpad : kb.m_rightTrackpad;
      pad.active = true;
      pad.x = x;
      pad.y = y;
    },
    side,
    x,
    y,
  );
}

async function padPress(side, key, { down = true, up = true } = {}) {
  const c = typeof key === "string" ? await keyCenter(key) : key;
  if (!c) throw new Error(`no key ${key}`);
  await padMove(side, c.x, c.y);
  const btn = side === "L" ? 20 : 22;
  if (down) await vgp("vgp_onbuttondown", btn);
  if (up) {
    await vgp("vgp_onbuttonup", btn);
    await page.evaluate((side) => {
      const key = document.querySelector("[data-key]");
      const fk = Object.keys(key).find((k) => k.startsWith("__reactFiber"));
      for (let f = key[fk]; f; f = f.return)
        if (typeof f.stateNode?.HandleTrackpadClick === "function") {
          (side === "L" ? f.stateNode.m_leftTrackpad : f.stateNode.m_rightTrackpad).active = false;
          return;
        }
    }, side);
  }
}

async function mouseClick(key) {
  const c = await keyCenter(key);
  if (!c) throw new Error(`no key ${key}`);
  await page.mouse.click(c.x, c.y, { delay: 30 });
  await sleep(30);
}

async function toggles() {
  return page.evaluate(() => {
    const key = document.querySelector("[data-key]");
    const fk = Object.keys(key).find((k) => k.startsWith("__reactFiber"));
    for (let f = key[fk]; f; f = f.return)
      if (typeof f.stateNode?.HandleTrackpadClick === "function") return f.stateNode.state.toggleStates;
  });
}

async function reset() {
  await page.evaluate(() => {
    const tr = window.__oskTrackpadFix?.tracker;
    if (tr) Object.assign(tr, { buf: "", prev: null, lastOut: "unknown", fromSwipe: null, autocorr: null });
    const key = document.querySelector("[data-key]");
    const fk = Object.keys(key).find((k) => k.startsWith("__reactFiber"));
    for (let f = key[fk]; f; f = f.return)
      if (typeof f.stateNode?.HandleTrackpadClick === "function") {
        f.stateNode.setState((s) => ({ ...s, toggleStates: { Shift: 0, CapsLock: 0, Control: 0, Alt: 0, AltGr: 0 } }));
        return;
      }
  });
  await settle(page);
  return page.evaluate(() => [...window.__oskTrackpadFix.sent.keys()]);
}

const scenario = withTiming(scenario0);

async function scenario0(title, fn, expected) {
  const stuck = await reset();
  if (stuck.length) {
    failures++;
    results.push(`FAIL keys still held before "${title}": ${stuck}`);
  }
  await clearLog();
  const e0 = errors.length;
  await fn();
  await settle(page);
  const got = hostView(await log());
  const ok = typeof expected === "function" ? expected(got) : JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) failures++;
  const newErr = errors.slice(e0).filter((e) => !/404|Failed to load/.test(e));
  if (process.env.FULLERR) console.log(newErr.join("\n"));
  if (newErr.length) results.push(`  errors during "${title}": ${newErr.map((e) => e.split("\n")[0]).join(" | ")}`);
  results.push(
    `${ok ? "PASS" : "FAIL"} ${title}\n      got      ${JSON.stringify(got)}${ok || typeof expected === "function" ? "" : `\n      expected ${JSON.stringify(expected)}`}`,
  );
}

async function rolledSpace() {
  await padPress("L", "h", { up: false });
  await padPress("R", " ", { up: false });
  await vgp("vgp_onbuttonup", 20);
  await vgp("vgp_onbuttonup", 22);
}
async function belowBottomRow() {
  const c = await page.evaluate(() => {
    const keys = [...document.querySelectorAll("[data-key-row]")];
    const last = Math.max(...keys.map((k) => +k.getAttribute("data-key-row")));
    const r = keys.find((k) => +k.getAttribute("data-key-row") === last && k.getAttribute("data-key-col") === "0").getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.bottom + 20 };
  });
  await padPress("L", c);
}
if (!process.env.PRE_PATCH) {
  await clearLog();
  await rolledSpace();
  await belowBottomRow();
  await settle(page);
  results.push(
    `baseline without patch (expect the bugs: space before h, nothing below the bottom row): ${JSON.stringify(hostView(await log()))}`,
  );
}
if (process.env.PRE_PATCH) results.push(`pre-patch: ${await page.evaluate(fs.readFileSync(process.env.PRE_PATCH, "utf8"))}`);

const before = await page.$$eval("[data-key]", (els) => els.map((e) => e.getAttribute("data-key")));
const status1 = await inject();

const status2 = await inject();
const after = await page.$$eval("[data-key]", (els) => els.map((e) => e.getAttribute("data-key")));
results.push(`inject: ${status1} / again: ${status2}`);
const bottom = await page.evaluate(() => {
  const keys = [...document.querySelectorAll("[data-key-row]")];
  const last = Math.max(...keys.map((k) => +k.getAttribute("data-key-row")));
  return keys
    .filter((k) => +k.getAttribute("data-key-row") === last)
    .map((k) => `${k.getAttribute("data-key")}@${Math.round(k.getBoundingClientRect().width)}:${k.textContent}`);
});
results.push(`bottom row: ${bottom.join("  ")}`);
const top = await page.evaluate(() =>
  [...document.querySelectorAll('[data-key-row="0"]')].map(
    (k) => `${k.getAttribute("data-key")}@${Math.round(k.getBoundingClientRect().width)}`,
  ),
);
results.push(`top row: ${top.join("  ")}`);
const stock = before.filter((k) => !["Escape", "Control", "Alt"].includes(k) && !k.startsWith("OSKSug_"));
const added = after.filter((k) => !stock.includes(k));
if (JSON.stringify(added.sort()) !== JSON.stringify(["Alt", "Control", "Escape", "OSKSug_0", "OSKSug_1", "OSKSug_2"])) {
  failures++;
  results.push(`FAIL added keys ${JSON.stringify(added)}`);
}
if (shots) await page.screenshot({ path: path.join(shots, "patched.png") });

await scenario(
  "plain typing, rolled thumbs (h down, i down, h up, i up)",
  async () => {
    await padPress("L", "h", { up: false });
    await padPress("R", "i", { up: false });
    await vgp("vgp_onbuttonup", 20);
    await vgp("vgp_onbuttonup", 22);
    await padPress("R", " ");
    await padPress("L", "t");
  },
  ['text:"h"', 'text:"i"', 'text:" "', 'text:"t"'],
);

await scenario("rolled thumbs: h down, space down, h up, space up", rolledSpace, ['text:"h"', 'text:" "']);

await scenario(
  "pad overshoot below the bottom-left corner lands on Ctrl",
  async () => {
    await belowBottomRow();
    await padPress("L", "x");
  },
  ["Ctrl+x"],
);

await scenario(
  "Ctrl (pad) then c",
  async () => {
    await padPress("L", "Control");
    await padPress("L", "c");
  },
  ["Ctrl+c"],
);

const tsAfterOneShot = await toggles();
if (tsAfterOneShot.Control !== 0) {
  failures++;
  results.push(`FAIL Control not cleared after one-shot: ${tsAfterOneShot.Control}`);
}

await scenario(
  "Ctrl locked (double tap), a, c, Ctrl off",
  async () => {
    await padPress("L", "Control");
    await padPress("L", "Control");
    await padPress("L", "a");
    await padPress("L", "c");
    await padPress("L", "Control");
  },
  ["Ctrl+a", "Ctrl+c"],
);

await scenario(
  "Alt then Tab",
  async () => {
    await padPress("L", "Alt");
    await padPress("L", "Tab");
  },
  ["Alt+Tab"],
);

await scenario(
  "Esc alone",
  async () => {
    await padPress("L", "Escape");
  },
  ["Esc"],
);

await scenario(
  "Ctrl + Alt + Esc via mouse/touch clicks",
  async () => {
    await mouseClick("Control");
    await mouseClick("Alt");
    await mouseClick("Escape");
  },
  ["Ctrl+Alt+Esc"],
);

await scenario(
  "Ctrl + left-trigger Shift + t",
  async () => {
    await padPress("L", "Control");
    await vgp("vgp_onbuttondown", 7);
    await padPress("R", "t");
    await vgp("vgp_onbuttonup", 7);
  },
  ["Ctrl+Shift+t"],
);

await scenario(
  "LB held = Ctrl: c, v, release",
  async () => {
    await vgp("vgp_onbuttondown", 5);
    await padPress("R", "c");
    await padPress("R", "v");
    await vgp("vgp_onbuttonup", 5);
  },
  ["Ctrl+c", "Ctrl+v"],
);

await scenario(
  "RB held = Alt: Tab, Tab, release",
  async () => {
    await vgp("vgp_onbuttondown", 6);
    await padPress("L", "Tab");
    await padPress("L", "Tab");
    await vgp("vgp_onbuttonup", 6);
  },
  ["Alt+Tab", "Alt+Tab"],
);

const typed = (s) => [...s].map((c) => `text:${JSON.stringify(c)}`);
async function touchTap(key) {
  const c = await keyCenter(key);
  if (!c) throw new Error(`no key ${key}`);
  await page.touchscreen.tap(c.x, c.y);
  await sleep(30);
}

for (const ms of [30, 60]) {
  await scenario(
    `LB pressed ${ms} ms into typeText("whatever"), c, release: the word goes out plain, then Ctrl+c`,
    async () => {
      await page.evaluate(() => window.__oskTrackpadFix.typeText("whatever"));
      await sleep(ms);
      await vgp("vgp_onbuttondown", 5);
      await padPress("R", "c");
      await vgp("vgp_onbuttonup", 5);
    },
    [...typed("whatever"), "Ctrl+c"],
  );
}

await scenario(
  'RB pressed 40 ms into typeText("whatever"), Tab, release: the word goes out plain, then Alt+Tab',
  async () => {
    await page.evaluate(() => window.__oskTrackpadFix.typeText("whatever"));
    await sleep(40);
    await vgp("vgp_onbuttondown", 6);
    await padPress("L", "Tab");
    await vgp("vgp_onbuttonup", 6);
  },
  [...typed("whatever"), "Alt+Tab"],
);

let shiftAfter = null;
await scenario(
  "touch Shift, h, e while 10 characters are still queued: He, Shift released",
  async () => {
    await page.evaluate(() => window.__oskTrackpadFix.typeText("abcdefghij"));
    await touchTap("Shift");
    await touchTap("h");
    await touchTap("e");
    await settle(page);
    shiftAfter = (await toggles()).Shift;
  },
  (got) => JSON.stringify(got) === JSON.stringify(typed("abcdefghijHe")) && shiftAfter === 0,
);
results.push(`      Shift after: ${shiftAfter}`);

await scenario(
  "touch Ctrl, c, h while 10 characters are still queued: Ctrl+c, then a plain h",
  async () => {
    await page.evaluate(() => window.__oskTrackpadFix.typeText("abcdefghij"));
    await touchTap("Control");
    await touchTap("c");
    await settle(page);
    await touchTap("h");
  },
  [...typed("abcdefghij"), "Ctrl+c", 'text:"h"'],
);

await scenario(
  "Ctrl + = and Ctrl + shifted + (Shift key on screen)",
  async () => {
    await padPress("R", "Control");
    await padPress("R", "=");
    await padPress("R", "Control");
    await padPress("L", "Shift");
    await padPress("R", "+");
  },
  ["Ctrl+=", "Ctrl+Shift+="],
);

await scenario(
  "left-trigger Shift + Tab (Shift+Tab)",
  async () => {
    await vgp("vgp_onbuttondown", 7);
    await padPress("L", "Tab");
    await vgp("vgp_onbuttonup", 7);
  },
  ["RShift+Tab"],
);

await scenario(
  "Ctrl + arrow left",
  async () => {
    await padPress("R", "Control");
    await padPress("R", "ArrowLeft");
  },
  ["Ctrl+Left"],
);

await scenario(
  "plain Backspace, Enter, arrow stay on Steam's path",
  async () => {
    await padPress("R", "Backspace");
    await padPress("R", "Enter");
    await padPress("R", "ArrowRight");
  },
  (got) => got.length === 3 && got.every((g) => g.startsWith("text:")),
);

await scenario(
  "Ctrl locked then keyboard hidden: Ctrl released",
  async () => {
    await padPress("L", "Control");
    await padPress("L", "Control");
    await settle(page);
    await page.evaluate(() => window.__sim.vkm.SetVirtualKeyboardHidden());
    await page.evaluate(() => window.__oskTrackpadFix.tickNow());
    await settle(page);
  },
  [],
);

await page.evaluate(() => window.__sim.vkm.SetVirtualKeyboardVisible());
await waitKeyboard(page);

await scenario(
  "keyboard reopened: Esc row still there, Ctrl + z",
  async () => {
    await padPress("L", "Control");
    await padPress("L", "z");
  },
  ["Ctrl+z"],
);

if (shots) {
  await reset();
  await padPress("L", "Control");
  await padPress("L", "Alt");
  await padPress("L", "Alt");
  await settle(page);
  await page.screenshot({ path: path.join(shots, "toggles.png"), clip: { x: 0, y: 700, width: 1280, height: 100 } });
  await reset();
}

await page.evaluate(() => window.__oskTrackpadFix.stop());
await settle(page);
const unpatched = await page.$$eval("[data-key]", (els) => els.map((e) => e.getAttribute("data-key")));
const unpatchOk = JSON.stringify(unpatched) === JSON.stringify(stock);
if (!unpatchOk) failures++;
results.push(`${unpatchOk ? "PASS" : "FAIL"} stop() restores Steam's keyboard (${unpatched.length} keys)`);
await scenario("after stop(): rolled space bug is back (patch fully removed)", rolledSpace, (got) =>
  !process.env.PRE_PATCH ? JSON.stringify(got) === JSON.stringify(['text:" "', 'text:"h"']) : true,
);
results.push(`re-inject after stop: ${await inject()}`);

await scenario(
  "re-injected: Ctrl + c",
  async () => {
    await padPress("L", "Control");
    await padPress("L", "c");
  },
  ["Ctrl+c"],
);

const status3 = await page.evaluate(() => window.__oskTrackpadFix.status());
results.push(`status: ${status3}`);
console.log(results.join("\n"));
const relevant = errors.filter((e) => /osk|patch|TypeKey|Toggle/i.test(e));
if (relevant.length) {
  failures++;
  console.log("page errors:\n" + relevant.join("\n"));
}
console.log(failures ? `${failures} FAILED` : "ALL PASS");
await browser.close();
process.exit(failures ? 1 : 0);
