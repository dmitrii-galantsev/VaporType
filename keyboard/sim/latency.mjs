import fs from "node:fs";
import { openSim } from "./run.mjs";
import { pct } from "./twopad.mjs";
import { readRuntime as read } from "../runtime.mjs";
import { sleep } from "./helpers.mjs";

const patchSrc = process.env.PATCH ? fs.readFileSync(process.env.PATCH, "utf8") : read("patch.js");
const N = Number(process.env.N ?? 20);

const { browser, page } = await openSim();
await page.evaluate(
  ["swipe/words.js", "swipe/lm.js", "swipe/engine.js", ...(process.env.WITH_MODES === "0" ? [] : ["modes.js"])].map(read).join("\n;\n"),
);
await page.evaluate(() => {
  window.__oskUserWords = null;
  window.localStorage.clear();
});
console.log("inject:", await page.evaluate(patchSrc));
await sleep(800);
if (process.env.SETTINGS)
  await page.evaluate((s) => {
    for (const [k, v] of Object.entries(JSON.parse(s))) window.__oskTrackpadFix.setSetting(k, v);
  }, process.env.SETTINGS);
await sleep(300);

await page.evaluate(() => {
  const key = document.querySelector("[data-key]");
  const fk = Object.keys(key).find((k) => k.startsWith("__reactFiber"));
  for (let f = key[fk]; f; f = f.return)
    if (typeof f.stateNode?.HandleTrackpadClick === "function") {
      window.__kb = f.stateNode;
      break;
    }
  const inp = SteamClient.Input;
  const orig = inp.ControllerKeyboardSendText;
  window.__sendAt = [];
  inp.ControllerKeyboardSendText = function (t) {
    window.__sendAt.push([performance.now(), t]);
    return orig.call(this, t);
  };
  window.__sugAt = [];
  new MutationObserver(() => {
    const el = document.querySelector('[data-key="OSKSug_1"]');
    window.__sugAt.push([performance.now(), el?.textContent ?? ""]);
  }).observe(document.querySelector("[data-key]").closest("[role=grid]") ?? document.body, {
    subtree: true,
    childList: true,
    characterData: true,
  });
  window.__vgp = (type, button) => {
    const t0 = performance.now();
    (document.querySelector("[data-key]") ?? document.body).dispatchEvent(
      new CustomEvent(type, { bubbles: true, cancelable: true, detail: { button, source: 1, is_repeat: false } }),
    );
    return performance.now() - t0;
  };
  window.__center = (k) => {
    const el = [...document.querySelectorAll("[data-key]")].find(
      (e) => e.getAttribute("data-key") === k && e.getBoundingClientRect().width > 0,
    );
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  window.__raw = (k, side, onePad) => {
    const c = window.__center(k);
    const r = window.__kb.m_keyboardDiv.getBoundingClientRect();
    const M = window.__oskModes,
      F = window.__oskTrackpadFix;
    if (M && F?.modeApi) {
      const mode = M.modes[F.settings.mode] ?? M.modes.standard;
      const G = M.geometry;
      const L = G.layoutFrom(F.modeApi.keys(window.__kb), r, F.modeApi.spans());
      const [px, py] = G.toPad(G.padMap(mode.map, L), side, c.x, c.y);
      return { ux: (2 * px) / G.PAD_MM - 1, uy: 1 - (2 * py) / G.PAD_MM };
    }
    const left = onePad ? r.left : side === "L" ? r.left : r.right - r.width * 0.55;
    const w = onePad ? r.width : r.width * 0.55;
    return { ux: (2 * (c.x - left)) / w - 1, uy: 1 - (2 * (c.y - r.top)) / r.height };
  };
  window.__sample = (side, ux, uy) => {
    const t0 = performance.now();
    window.__kb.m_trackpadInput.m_AnalogCallbacks.Dispatch(side === "L" ? 19 : 21, 0, ux, uy);
    return performance.now() - t0;
  };
});

async function tapRun(key, side) {
  return page.evaluate(
    async (key, side) => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const p = window.__raw(key, side, window.__oskTrackpadFix.settings?.reach === "right" && side === "R");
      window.__sample(side, p.ux, p.uy);
      await wait(30);
      window.__sample(side, p.ux, p.uy);
      window.__sendAt.length = 0;
      const tDown = performance.now();
      const hDown = window.__vgp("vgp_onbuttondown", side === "L" ? 20 : 22);
      await wait(25);
      const tUp = performance.now();
      const hUp = window.__vgp("vgp_onbuttonup", side === "L" ? 20 : 22);
      await wait(80);
      const first = window.__sendAt[0]?.[0];
      return { down: first - tDown, up: first - tUp, hDown, hUp, sent: window.__sendAt.map((x) => x[1]).join("") };
    },
    key,
    side,
  );
}

async function swipeRun(word, side, onePad) {
  return page.evaluate(
    async (word, side, onePad) => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const pts = [...word].map((k) => window.__raw(k, side, onePad));
      window.__sample(side, pts[0].ux, pts[0].uy);
      await wait(20);
      window.__sample(side, pts[0].ux, pts[0].uy);
      window.__vgp("vgp_onbuttondown", side === "L" ? 20 : 22);
      const per = [];
      for (let i = 1; i < pts.length; i++) {
        for (let s = 1; s <= 8; s++) {
          const f = s / 8;
          per.push(window.__sample(side, pts[i - 1].ux + (pts[i].ux - pts[i - 1].ux) * f, pts[i - 1].uy + (pts[i].uy - pts[i - 1].uy) * f));
          await wait(8);
        }
      }
      window.__sendAt.length = 0;
      window.__sugAt.length = 0;
      const tUp = performance.now();
      const hUp = window.__vgp("vgp_onbuttonup", side === "L" ? 20 : 22);
      const t1 = performance.now();
      while (performance.now() - t1 < 700) {
        await wait(5);
        const text = window.__sendAt
          .map((x) => x[1])
          .join("")
          .trim();
        if (text.length >= word.length - 1 && window.__sugAt.some(([, l]) => l && text.endsWith(l))) break;
      }
      await wait(60);
      const text = window.__sendAt
        .map((x) => x[1])
        .join("")
        .trim();
      const sug = window.__sugAt.find(([, l]) => l && text.endsWith(l));
      await wait(80);
      window.__sample(side, pts[0].ux, pts[0].uy);
      return {
        queued: window.__sendAt[0]?.[0] - tUp,
        last: window.__sendAt.at(-1)?.[0] - tUp,
        sug: sug ? sug[0] - tUp : null,
        hUp,
        per,
        text,
        decodeMs: window.__oskTrackpadFix.lastDecodeMs,
      };
    },
    word,
    side,
    onePad,
  );
}

const fmt = (name, v) =>
  `${name.padEnd(44)} p50 ${pct(v, 0.5).toFixed(1).padStart(6)} ms  p95 ${pct(v, 0.95).toFixed(1).padStart(6)} ms  (n=${v.filter(Number.isFinite).length})`;

const onePad = !!(await page.evaluate(() => window.__oskTrackpadFix.settings?.reach === "right"));
const taps = [];
for (let i = 0; i < N; i++) {
  taps.push(await tapRun("jklio"[i % 5], "R"));
  if (i % 5 === 4) {
    taps.push(await tapRun(" ", "R"));
  }
}
const letters = taps.filter((t) => t.sent.trim());
const words = onePad ? ["hello", "great", "people", "thanks", "nice", "game"] : ["you", "look", "only", "pool", "join", "milk"];
const swipes = [];
for (let i = 0; i < N; i++) {
  swipes.push(await swipeRun(words[i % words.length], "R", onePad));
  await tapRun(" ", "R");
}
const lines = [
  `patch ${process.env.PATCH ?? "patch.js"} settings ${process.env.SETTINGS ?? "{}"}`,
  fmt(
    "pad tap: press -> first SendText",
    letters.map((t) => t.down),
  ),
  fmt(
    "pad tap: release -> first SendText",
    letters.map((t) => t.up),
  ),
  fmt(
    "pad tap: release handler blocking time",
    letters.map((t) => t.hUp),
  ),
  fmt(
    "swipe: release -> word's first SendText",
    swipes.map((s) => s.queued),
  ),
  fmt(
    "swipe: release -> word's last SendText",
    swipes.map((s) => s.last),
  ),
  fmt(
    "swipe: release -> suggestion row shows word",
    swipes.map((s) => s.sug),
  ),
  fmt(
    "swipe: release handler blocking time",
    swipes.map((s) => s.hUp),
  ),
  fmt(
    "swipe: per pad sample handler time",
    swipes.flatMap((s) => s.per),
  ),
  fmt(
    "swipe: decode (lastDecodeMs)",
    swipes.map((s) => s.decodeMs),
  ),
  `tap release handler ms: ${letters.map((t) => t.hUp.toFixed(1)).join(" ")}`,
  `swiped: ${swipes.map((s) => s.text).join(" | ")}`,
];
console.log(lines.join("\n"));
await browser.close();
