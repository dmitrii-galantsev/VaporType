import fs from "node:fs";
import path from "node:path";
import { openSim, inject, settle } from "./run.mjs";
import { readRuntime as read } from "../runtime.mjs";
import { pageHelpers, sideOf, sleep, textOut, withTiming } from "./helpers.mjs";

const shots = process.env.SHOTS;

function patchSource() {
  return process.env.PATCH_JS ? fs.readFileSync(process.env.PATCH_JS, "utf8") : read("patch.js");
}

const { browser, page, errors } = await openSim();
let failures = 0;
const results = [];

await page.evaluate(read("swipe/words.js") + "\n;\n" + read("swipe/lm.js") + "\n;\n" + read("swipe/engine.js"));
await page.evaluate(read("modes.js"));
await page.evaluate(() => {
  window.__oskUserWords = null;
  window.localStorage.clear();
});
results.push(`inject: ${await inject(page, patchSource())}`);

await page.evaluate(() => {
  const mt = (window.__mt = {
    kb() {
      const key = document.querySelector("[data-key]");
      const fk = Object.keys(key).find((k) => k.startsWith("__reactFiber"));
      for (let f = key[fk]; f; f = f.return) if (typeof f.stateNode?.HandleTrackpadClick === "function") return f.stateNode;
      return null;
    },
    keys() {
      const out = {};
      for (const el of document.querySelectorAll("[data-key]")) {
        const k = el.getAttribute("data-key");
        if (!/^[a-z]$/.test(k) || out[k]) continue;
        const r = el.getBoundingClientRect();
        if (r.width) out[k] = { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
      }
      return out;
    },
    linear(side, u, v) {
      const r = mt.kb().m_keyboardDiv.getBoundingClientRect();
      const W = r.width * window.__oskTrackpadFix.modeApi.spans()[side];
      const x0 = side === "L" ? r.left : r.right - W;
      return [x0 + u * W, r.top + v * r.height];
    },
    aim(side, ch, kind, dmx = 0, dmy = 0) {
      const G = window.__oskModes.geometry;
      const L = G.layoutFrom(mt.keys(), mt.kb().m_keyboardDiv.getBoundingClientRect(), window.__oskTrackpadFix.modeApi.spans());
      const map = G.padMap(kind, L);
      const k = L.keys[ch];
      const [px, py] = G.toPad(map, side, k.x, k.y);
      return [Math.min(Math.max((px + dmx) / G.PAD_MM, 0), 1), Math.min(Math.max((py + dmy) / G.PAD_MM, 0), 1)];
    },
    move(side, u, v) {
      const [x, y] = mt.linear(side, u, v);
      const kb = mt.kb();
      if (side === "L") kb.OnLeftTrackpadAnalog(true, x, y, 0);
      else kb.OnRightTrackpadAnalog(true, x, y, 0);
    },
    lift(side) {
      const kb = mt.kb();
      if (side === "L") kb.OnLeftTrackpadAnalog(false, 0, 0, 0);
      else kb.OnRightTrackpadAnalog(false, 0, 0, 0);
    },
    pad(side) {
      const p = side === "L" ? mt.kb().m_leftTrackpad : mt.kb().m_rightTrackpad;
      return { x: p.x, y: p.y, active: p.active };
    },
    keyAt(x, y) {
      return document.elementFromPoint(x, y)?.closest?.("[data-key]")?.getAttribute("data-key") ?? null;
    },
  });
});

const BTN = { L: 20, R: 22 };
const Y_BTN = 4,
  X_BTN = 3;

const { vgp, labels } = pageHelpers(page);

async function press(button) {
  await vgp("vgp_onbuttondown", button);
  await sleep(15);
  await vgp("vgp_onbuttonup", button);
  await sleep(25);
}

async function rawTap(side, u, v) {
  await page.evaluate((side, u, v) => window.__mt.move(side, u, v), side, u, v);
  await vgp("vgp_onbuttondown", BTN[side]);
  await sleep(15);
  await vgp("vgp_onbuttonup", BTN[side]);
  await sleep(20);
}

async function aimTap(ch, kind, dmx = 0, dmy = 0, side = sideOf(ch)) {
  const [u, v] = await page.evaluate((side, ch, kind, a, b) => window.__mt.aim(side, ch, kind, a, b), side, ch, kind, dmx, dmy);
  await rawTap(side, u, v);
}

async function aimSwipe(word, kind, side) {
  const pts = [];
  for (const ch of word) pts.push(await page.evaluate((side, ch, kind) => window.__mt.aim(side, ch, kind), side, ch, kind));
  await page.evaluate((side, u, v) => window.__mt.move(side, u, v), side, ...pts[0]);
  await vgp("vgp_onbuttondown", BTN[side]);
  for (let i = 1; i < pts.length; i++)
    for (let s = 1; s <= 6; s++) {
      const f = s / 6;
      await page.evaluate(
        (side, u, v) => window.__mt.move(side, u, v),
        side,
        pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f,
        pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f,
      );
      await sleep(8);
    }
  await vgp("vgp_onbuttonup", BTN[side]);
}

const status = () => page.evaluate(() => window.__oskTrackpadFix.status());
const setMode = (id) => page.evaluate((id) => window.__oskTrackpadFix.setMode(id), id);

async function shot(name) {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  const file = path.join(shots, `${name}.png`);
  await page.screenshot({ path: file });
  results.push(`  screenshot ${file}`);
}

const scenario = withTiming(scenario0);

async function scenario0(title, fn, check) {
  const e0 = errors.length;
  await page.evaluate(() => {
    window.__keyLog.length = 0;
  });
  let extra;
  try {
    extra = (await fn()) ?? "";
  } catch (e) {
    extra = `threw ${e.message}`;
  }
  await settle(page);
  const log = await page.evaluate(() => window.__keyLog.slice());
  const out = textOut(log);
  const sug = await labels();
  const multi = log.filter(([, kind, v]) => kind === "text" && [...v].length !== 1);
  let ok = false;
  try {
    ok = (await check(out, sug, extra)) && multi.length === 0;
  } catch (e) {
    extra += ` check threw ${e.message}`;
  }
  if (multi.length) results.push(`  multi-character SendText calls: ${JSON.stringify(multi.map((x) => x[2]))}`);
  const newErr = errors.filter((e, i) => i >= e0 && !/404|Failed to load|Transport|passive event listener|cancel a touchend/.test(e));
  const st = await page.evaluate(() => window.__oskTrackpadFix.errors ?? []);
  if (!ok || newErr.length) failures++;
  results.push(
    `${ok && !newErr.length ? "PASS" : "FAIL"} ${title}\n      text ${JSON.stringify(out)}  suggestions ${JSON.stringify(sug)}${extra ? `  ${extra}` : ""}${newErr.length ? `\n      errors ${newErr.join(" | ")}` : ""}${st.length ? `\n      patch errors ${st.join(" | ")}` : ""}`,
  );
}

await scenario(
  "modes.js loaded, Big letter keys is the default mode",
  async () => status(),
  (o, s, st) => /mode=bigkeys/.test(st),
);

await scenario(
  "switching to standard mode",
  async () => {
    await setMode("standard");
    return status();
  },
  (o, s, st) => /mode=standard/.test(st),
);

await scenario(
  "standard: a raw pad point a quarter down the pad is the number row (types 2)",
  async () => {
    await rawTap("L", 0.38, 0.25);
  },
  (o) => o === "2",
);

await scenario(
  "big keys: the same raw point types a top-row letter (letter rows fill 70 % of the pad)",
  async () => {
    await setMode("bigkeys");
    await press(X_BTN);
    await settle(page);
    await page.evaluate(() => {
      window.__keyLog.length = 0;
    });
    await rawTap("L", 0.38, 0.25);
    return status();
  },
  (o, s, st) => /^[qwert]$/.test(o) && /mode=bigkeys/.test(st),
);

await scenario(
  "big keys: pad pointer mapped into the letter block, overlay drawn",
  async () => {
    await press(X_BTN);
    await page.evaluate(() => {
      window.__keyLog.length = 0;
    });
    await page.evaluate(() => window.__mt.move("R", 0.5, 0.5));
    await page.evaluate(() => window.__mt.move("L", 0.3, 0.55));
    await sleep(120);
    await shot("mode-bigkeys");
    const r = await page.evaluate(() => {
      const p = window.__mt.pad("R"),
        q = window.__mt.pad("L");
      return {
        r: window.__mt.keyAt(p.x, p.y),
        l: window.__mt.keyAt(q.x, q.y),
        canvas: !!document.getElementById("osk-mode-overlay"),
        hide: window.__oskModes.debug().pointerClass,
        css: document.getElementById("osk-mode-style")?.textContent ?? "",
      };
    });
    await page.evaluate(() => {
      window.__mt.lift("L");
      window.__mt.lift("R");
    });
    return JSON.stringify(r);
  },
  (o, s, e) => {
    const r = JSON.parse(e);
    return o === "" && /^[a-z]$/.test(r.r) && /^[a-z]$/.test(r.l) && r.canvas && !!r.hide && r.css.includes(r.hide);
  },
);

await scenario(
  "big keys: aimed taps type literally (h e y)",
  async () => {
    for (const ch of "hey") await aimTap(ch, "big");
  },
  (o) => o === "hey",
);

await scenario(
  "big keys: one-pad swipe through mapped points decodes (the, left pad)",
  async () => {
    await press(Y_BTN);
    await page.evaluate(() => {
      window.__keyLog.length = 0;
    });
    await aimSwipe("the", "big", "L");
  },
  (o) => o.trim() === "the",
);

await scenario(
  "big keys + Pad reach 'Right pad only': the right pad reaches the left letters (a s), the left pad keeps its half",
  async () => {
    await press(Y_BTN);
    await page.evaluate(() => window.__oskTrackpadFix.setSetting("reach", "right"));
    await settle(page);
    await page.evaluate(() => {
      window.__keyLog.length = 0;
    });
    for (const ch of "as") await aimTap(ch, "big", 0, 0, "R");
    const spans = await page.evaluate(() => window.__oskTrackpadFix.modeApi.spans());
    await page.evaluate(() => window.__oskTrackpadFix.setSetting("reach", 55));
    await settle(page);
    return JSON.stringify(spans);
  },
  (o, s, e) => {
    const sp = JSON.parse(e);
    return o === "as" && sp.R === 1 && sp.L === 0.55;
  },
);

await scenario(
  "panel: the Typing mode row shows the mode as the selected segment; tapping Standard sets it in one press",
  async () => {
    await page.evaluate(() => window.__oskTrackpadFix.openSettings());
    await settle(page);
    const on = () => page.evaluate(() => document.querySelector('[data-key="OSKSet_c_mode"] .osk-set-segbtn.on')?.textContent ?? "");
    const before = await on();
    const hidden = await page.evaluate(() => document.getElementById("osk-mode-overlay")?.style.display === "none");
    await shot("mode-settings-panel");
    await page.evaluate(() => document.querySelector('[data-key="OSKSet_v_mode_0"]').click());
    await settle(page);
    const after = await on();
    await page.evaluate(() => window.__oskTrackpadFix.closeSettings());
    return JSON.stringify([before, after, await status(), hidden]);
  },
  (o, s, e) => {
    const [b, a, st, hidden] = JSON.parse(e);
    return /Big keys/.test(b) && /Standard/.test(a) && /mode=standard/.test(st) && hidden;
  },
);

await scenario(
  "standard again: overlay removed, taps literal",
  async () => {
    await page.evaluate(() => {
      window.__keyLog.length = 0;
    });
    await settle(page);
    for (const ch of "ab") await aimTap(ch, "standard");
    return String(await page.evaluate(() => !!document.getElementById("osk-mode-overlay")));
  },
  (o, s, c) => o === "ab" && c === "false",
);

await scenario(
  "only Standard and Big letter keys exist; the setting persists in oskSwipeSettings and stop() removes the overlay",
  async () => {
    const refused = await page.evaluate(() => window.__oskTrackpadFix.setSetting("mode", "sloppy"));
    await setMode("bigkeys");
    await settle(page);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("oskSwipeSettings") ?? "{}").mode);
    await page.evaluate(() => window.__oskTrackpadFix.stop());
    await settle(page);
    const left = await page.evaluate(() => !!document.getElementById("osk-mode-overlay") || !!document.getElementById("osk-mode-style"));
    return JSON.stringify([saved, left, refused]);
  },
  (o, s, e) => {
    const [m, left, refused] = JSON.parse(e);
    return m === "bigkeys" && left === false && refused === false;
  },
);

await browser.close();
console.log(results.join("\n"));
console.log(failures ? `${failures} FAILED` : "all passed");
process.exit(failures ? 1 : 0);
