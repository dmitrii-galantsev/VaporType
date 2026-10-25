import fs from "node:fs";
import { openSim, inject, settle } from "./run.mjs";
import { readRuntime as read } from "../runtime.mjs";
import { sleep } from "./helpers.mjs";

const patchSrc = process.env.PATCH_SRC ? fs.readFileSync(process.env.PATCH_SRC, "utf8") : read("patch.js");
const { browser, page, errors } = await openSim();
let failures = 0;
const results = [];
const check = (ok, title, detail = "") => {
  if (!ok) failures++;
  results.push(`${ok ? "PASS" : "FAIL"} ${title}${detail ? `\n      ${detail}` : ""}`);
};

await page.evaluate(["swipe/words.js", "swipe/lm.js", "swipe/engine.js", "modes.js"].map(read).join("\n;\n"));
await page.evaluate(() => {
  window.__oskUserWords = null;
  window.localStorage.clear();
});
results.push(`inject: ${await inject(page, patchSrc)}`);

await page.evaluate(() => {
  const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const pe = (window.__pe = {
    kb() {
      const key = document.querySelector("[data-key]");
      const fk = Object.keys(key).find((k) => k.startsWith("__reactFiber"));
      for (let f = key[fk]; f; f = f.return) if (typeof f.stateNode?.HandleTrackpadClick === "function") return f.stateNode;
      return null;
    },
    pad: (side) => (side === "L" ? pe.kb().m_leftTrackpad : pe.kb().m_rightTrackpad),
    dispatch: (side, ux, uy) => pe.kb().m_trackpadInput.m_AnalogCallbacks.Dispatch(side === "L" ? 19 : 21, 0, ux, uy),
    async move(side, ux, uy) {
      pe.dispatch(side, ux, uy);
      if (!pe.pad(side).active) {
        await frame();
        pe.dispatch(side, ux, uy);
      }
    },
    async lift(side) {
      for (let i = 0; i < 40 && pe.pad(side).active; i++) await wait(20);
    },
    btn(side, type) {
      (document.querySelector("[data-key]") ?? document.body).dispatchEvent(
        new CustomEvent(type, { bubbles: true, cancelable: true, detail: { button: side === "L" ? 20 : 22, source: 1, is_repeat: false } }),
      );
    },
    live(el) {
      const k = el?.getAttribute?.("data-key");
      if (!k) return null;
      if (k.startsWith("OSKSug_") && !el.textContent.trim()) return null;
      return k;
    },
    async probe(side, ux, uy) {
      await pe.move(side, ux, uy);
      const kb = pe.kb(),
        pad = pe.pad(side);
      let hit = null;
      try {
        hit = kb.getElementFromPointWorkaround(pad.x, pad.y, side === "L" ? 20 : 22);
      } catch (e) {}
      return { hover: pe.live(pad.lastElement), press: pe.live(hit), x: Math.round(pad.x), y: Math.round(pad.y) };
    },
    rawOf(side, ch) {
      const F = window.__oskTrackpadFix,
        G = window.__oskModes.geometry;
      const keys = {};
      for (const el of document.querySelectorAll("[data-key]")) {
        const k = el.getAttribute("data-key");
        const r = el.getBoundingClientRect();
        if (/^[a-z]$/.test(k) && r.width && !keys[k])
          keys[k] = { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
      }
      const mode = F.settings.mode;
      const kind = mode === "bigkeys" ? "big" : "standard";
      const L = G.layoutFrom(keys, pe.kb().m_keyboardDiv.getBoundingClientRect(), F.modeApi.spans());
      const [px, py] = G.toPad(G.padMap(kind, L), side, keys[ch].x, keys[ch].y);
      return [2 * (px / G.PAD_MM) - 1, 1 - 2 * (py / G.PAD_MM)];
    },
    async click(side, ux, uy) {
      window.__keyLog.length = 0;
      const p = await pe.probe(side, ux, uy);
      pe.btn(side, "vgp_onbuttondown");
      await wait(30);
      await pe.move(side, ux, uy);
      pe.btn(side, "vgp_onbuttonup");
      await pe.lift(side);
      await wait(30);
      const log = window.__keyLog.map(([, kind, v]) => `${kind}:${v}`);
      return { ...p, log };
    },
    async swipe(side, word, overshoot) {
      window.__keyLog.length = 0;
      const pts = [...word].map((ch) => pe.rawOf(side, ch));
      await pe.move(side, ...pts[0]);
      await wait(40);
      pe.btn(side, "vgp_onbuttondown");
      const path = [];
      for (let i = 1; i < pts.length; i++)
        for (let s = 1; s <= 8; s++)
          path.push([pts[i - 1][0] + ((pts[i][0] - pts[i - 1][0]) * s) / 8, pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * s) / 8]);
      if (overshoot) {
        const [ex, ey] = pts[pts.length - 1];
        for (let s = 1; s <= 6; s++) path.push([ex, ey + ((1 - ey) * s) / 6]);
      }
      for (const p of path) {
        await wait(8);
        pe.dispatch(side, ...p);
      }
      pe.btn(side, "vgp_onbuttonup");
      await pe.lift(side);
    },
  });
});

const set = (cfg) =>
  page.evaluate((cfg) => {
    for (const [k, v] of Object.entries({
      mode: "bigkeys",
      reach: 55,
      oneAspect: 2,
      deadzone: 100,
      echo: true,
      suggestions: true,
      ...cfg,
    }))
      window.__oskTrackpadFix.setSetting(k, v);
  }, cfg);
const typed = () =>
  page.evaluate(() => {
    let t = "";
    for (const [, kind, v] of window.__keyLog) if (kind === "text") t = v === "\u0002" ? t.slice(0, -1) : t + v;
    return t;
  });

const CONFIGS = [
  ["Standard", { mode: "standard" }],
  ["Big letter keys", { mode: "bigkeys" }],
  ["Standard reach 75", { mode: "standard", reach: 75 }],
  ["Big letter keys reach 100", { mode: "bigkeys", reach: 100 }],
  ["Big letter keys right pad only 2:1", { mode: "bigkeys", reach: "right" }],
  ["Standard right pad only 3:1", { mode: "standard", reach: "right", oneAspect: 3 }],
  ["Big letter keys right pad only 1:1", { mode: "bigkeys", reach: "right", oneAspect: 1 }],
  ["Big letter keys deadzone 130", { mode: "bigkeys", deadzone: 130 }],
  ["Standard, typed-text field off", { mode: "standard", echo: false }],
  ["Big letter keys, suggestion row off", { mode: "bigkeys", suggestions: false }],
];
const EDGE = [];
for (const uy of [1, 0.98, -0.98, -1]) for (const ux of [-1, -0.5, 0, 0.5, 1]) EDGE.push([ux, uy]);
for (const ux of [-1, -0.98, 0.98, 1]) EDGE.push([ux, 0]);
const TOP_ROW = new Set(["Escape", ..."1234567890-=", "Backspace"]);
const topKey = (k) => TOP_ROW.has(k) || /^OSKSug_\d$/.test(k ?? "");
const BOTTOM_ROW = new Set([
  "Control",
  "Alt",
  "SwitchKeys_Steam",
  "SwitchKeys_Layout",
  " ",
  "ArrowLeft",
  "ArrowRight",
  "VKPaste",
  "VKClose",
]);

for (const [name, cfg] of CONFIGS) {
  await set(cfg);
  await settle(page);
  for (const side of ["L", "R"]) {
    const bad = [];
    const seen = [];
    for (const [ux, uy] of EDGE) {
      const p = await page.evaluate((side, ux, uy) => window.__pe.probe(side, ux, uy), side, ux, uy);
      const fits = uy > 0.9 ? topKey(p.press) : uy < -0.9 ? BOTTOM_ROW.has(p.press) : true;
      seen.push(`(${ux},${uy}) ${p.press}`);
      if (!p.press || p.hover !== p.press || !fits) bad.push(`(${ux},${uy}) hover ${p.hover} press ${p.press} at ${p.x},${p.y}`);
    }
    await page.evaluate((side) => window.__pe.lift(side), side);
    check(
      !bad.length,
      `${name}, ${side} pad: every edge point hovers and presses a real key (top row or a shown suggestion at the top, bottom row at the bottom)`,
      bad.length ? bad.join("; ") : seen.join(" "),
    );
    const clicks = [];
    for (const ux of [-1, 0, 1])
      for (const uy of [1, 0.98]) clicks.push(await page.evaluate((side, ux, uy) => window.__pe.click(side, ux, uy), side, ux, uy));
    await settle(page);
    const dead = clicks.filter((c) => !c.log.length || !topKey(c.press));
    check(
      !dead.length,
      `${name}, ${side} pad: a click at the top edge (uy 1 and 0.98, ux -1/0/1) presses the top-row key or shown suggestion under the pointer`,
      clicks.map((c) => `${c.press}@${c.x},${c.y} -> ${c.log.join(" ") || "nothing"}`).join("; "),
    );
  }
}

for (const [name, cfg, side, word] of [
  ["Standard", { mode: "standard" }, "L", "were"],
  ["Big letter keys", { mode: "bigkeys" }, "R", "you"],
  ["Big letter keys reach 100", { mode: "bigkeys", reach: 100 }, "L", "type"],
  ["Big letter keys right pad only 1:1", { mode: "bigkeys", reach: "right", oneAspect: 1 }, "R", "type"],
  ["Standard right pad only 3:1", { mode: "standard", reach: "right", oneAspect: 3 }, "R", "were"],
]) {
  await set(cfg);
  await settle(page);
  await page.evaluate((side, word) => window.__pe.swipe(side, word, true), side, word);
  await settle(page);
  await sleep(50);
  const t = await typed();
  const sug = await page.evaluate(() => [0, 1, 2].map((i) => document.querySelector(`[data-key="OSKSug_${i}"]`)?.textContent ?? ""));
  check(
    t.trim() === word,
    `${name}, ${side} pad: "${word}" swiped along the top row and off the top edge still decodes`,
    `typed ${JSON.stringify(t)} chips ${JSON.stringify(sug)}`,
  );
  const top = await page.evaluate((side) => window.__pe.probe(side, 0, 1), side);
  await page.evaluate((side) => window.__pe.lift(side), side);
  check(
    top.hover === top.press && topKey(top.press),
    `${name}, ${side} pad: with suggestions showing, the top edge centre hovers a suggestion or a top-row key`,
    JSON.stringify(top),
  );
}

await set({});
await settle(page);
const bad = errors.filter(
  (e) => !/404|Transport|passive event listener|cancel a touchend|activeOutputDeviceId|AddOnDisconnectCallback/.test(e),
);
if (bad.length) {
  failures++;
  results.push(`errors ${bad.join(" | ")}`);
}
console.log(results.join("\n"));
console.log(failures ? `${failures} FAILED` : "ALL PASS");
await browser.close();
process.exit(failures ? 1 : 0);
