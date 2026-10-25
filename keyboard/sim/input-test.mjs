import path from "node:path";
import { openSim, inject, settle, waitKeyboard } from "./run.mjs";
import { readRuntime as read } from "../runtime.mjs";
import { pageHelpers, sleep, withTiming } from "./helpers.mjs";

const shots = process.env.SHOTS;

const { browser, page, errors } = await openSim();
let failures = 0;
const results = [];

await page.evaluate(["swipe/words.js", "swipe/lm.js", "swipe/engine.js", "modes.js"].map(read).join("\n;\n"));
await page.evaluate(() => {
  window.__oskUserWords = null;
  window.localStorage.clear();
});
results.push(`inject: ${await inject(page, read("patch.js"))}`);

const { kbEval, vgp, padAt, padIdle, labels, setSetting } = pageHelpers(page);

async function center(key) {
  return page.evaluate((key) => {
    const el = [...document.querySelectorAll("[data-key]")].find(
      (e) => e.getAttribute("data-key") === key && e.getBoundingClientRect().width > 0,
    );
    const r = el?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height } : null;
  }, key);
}

const BTN = { L: 20, R: 22 };

async function padTap(side, key) {
  const c = await center(key);
  await padAt(side, c.x, c.y);
  await vgp("vgp_onbuttondown", BTN[side]);
  await sleep(20);
  await vgp("vgp_onbuttonup", BTN[side]);
  await padIdle(side);
  await sleep(30);
}

async function padSlide(side, key, dxKeys, { steps = 12, ms = 25, from = 0 } = {}) {
  const c = await center(key);
  const kw = (await center("g")).w;
  const x0 = c.x + from * kw;
  await padAt(side, x0, c.y);
  await vgp("vgp_onbuttondown", BTN[side]);
  for (let i = 1; i <= steps; i++) {
    await padAt(side, x0 + (dxKeys * kw * i) / steps, c.y);
    await sleep(ms);
  }
  const t = await page.evaluate(() => performance.now());
  await vgp("vgp_onbuttonup", BTN[side]);
  await padIdle(side);
  return t;
}

let touchId = 10;
async function touchSlide(key, dxKeys, { steps = 12, ms = 25, from = 0 } = {}) {
  const c = await center(key);
  const kw = (await center("g")).w;
  const x0 = c.x + from * kw;
  const id = ++touchId;
  const send = (type, x, y) =>
    page.evaluate(
      (type, x, y, id) => {
        window.__touchTarget = type === "touchstart" ? document.elementFromPoint(x, y) : window.__touchTarget;
        const t = new Touch({ identifier: id, target: window.__touchTarget, clientX: x, clientY: y });
        const ev = new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          touches: type === "touchend" ? [] : [t],
          targetTouches: type === "touchend" ? [] : [t],
          changedTouches: [t],
        });
        window.__touchTarget.dispatchEvent(ev);
      },
      type,
      x,
      y,
      id,
    );
  await send("touchstart", x0, c.y);
  let x = x0;
  for (let i = 1; i <= steps; i++) {
    x = x0 + (dxKeys * kw * i) / steps;
    await send("touchmove", x, c.y);
    await sleep(ms);
  }
  await send("touchend", x, c.y);
}

const ARROWS = { "\u0003": "←", "\u0004": "→" };
function view(log) {
  return log
    .filter(([, k]) => k === "text")
    .map(([, , v]) => ARROWS[v] ?? (v === "\u0001" ? "⏎" : v === "\u0002" ? "⌫" : v))
    .join("");
}
const arrows = (out) => (out.match(/[←→]/g) ?? []).length;

const scenario = withTiming(scenario0);

async function scenario0(title, fn, check) {
  const e0 = errors.length;
  await page.evaluate(() => {
    window.__keyLog.length = 0;
  });
  let extra;
  try {
    extra = await fn();
  } catch (e) {
    extra = { error: String(e.stack ?? e) };
  }
  await settle(page);
  const log = await page.evaluate(() => window.__keyLog.slice());
  const out = view(log);
  const multi = log.filter(([, kind, v]) => kind === "text" && [...v].length !== 1);
  const texts = log.filter(([, kind]) => kind === "text");
  const fast = [];
  for (let i = 1; i < texts.length; i++)
    if (texts[i][2] === texts[i - 1][2] && texts[i][0] - texts[i - 1][0] < 32)
      fast.push(`${JSON.stringify(texts[i][2])} ${texts[i][0] - texts[i - 1][0]}ms`);
  const sug = await labels();
  let ok = false;
  try {
    ok = !!(await check(out, sug, extra)) && !multi.length && !fast.length && !extra?.error;
  } catch (e) {
    extra = { ...extra, checkError: String(e) };
  }
  const newErr = errors.filter((e, i) => i >= e0 && !/404|Failed to load|Transport|passive event listener|cancel a touchend/.test(e));
  if (newErr.length) ok = false;
  if (!ok) failures++;
  results.push(
    `${ok ? "PASS" : "FAIL"} ${title}\n      sent ${JSON.stringify(out)}  suggestions ${JSON.stringify(sug)}${extra !== undefined ? `  ${JSON.stringify(extra)}` : ""}${fast.length ? `\n      same key under 32 ms ${fast.join(", ")}` : ""}${multi.length ? `\n      multi-char ${JSON.stringify(multi)}` : ""}${newErr.length ? `\n      errors ${newErr.join(" | ")}` : ""}`,
  );
}

const overlayBlank = () =>
  page.evaluate(() => {
    const c = document.getElementById("osk-mode-overlay");
    if (!c) return "no overlay";
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
    return n;
  });

await scenario(
  "Big letter keys (default): no outline drawn while no pad is touched, no dashed stroke in modes.js",
  async () => {
    await settle(page);
    return { painted: await overlayBlank(), mode: await page.evaluate(() => window.__oskTrackpadFix.settings.mode) };
  },
  (o, s, x) => x.painted === 0 && x.mode === "bigkeys" && !/setLineDash|strokeRect/.test(read("modes.js")),
);

async function gains(label) {
  await setSetting("reach", "right");
  await settle(page);
  await kbEval((kb) => kb.m_trackpadInput.m_AnalogCallbacks.Dispatch(21, 0, 0, 0));
  await sleep(40);
  const g = await kbEval((kb) => {
    const at = (ux, uy) => {
      kb.m_trackpadInput.m_AnalogCallbacks.Dispatch(21, 0, ux, uy);
      const p = kb.m_rightTrackpad;
      return { x: p.x, y: p.y, key: p.lastElement?.getAttribute("data-key") ?? null };
    };
    at(0, 0);
    const r = kb.m_keyboardDiv.getBoundingClientRect();
    const c = at(0, 0),
      dx = at(0.2, 0),
      up = at(0, 0.2),
      top = at(0, 0.98),
      bottom = at(0, -0.98),
      left = at(-0.9, 0.05),
      right = at(0.5, 0.05);
    return {
      dx: +(dx.x - c.x).toFixed(1),
      dy: +(c.y - up.y).toFixed(1),
      centre: c.key,
      top: top.key,
      bottomY: Math.round(r.bottom - bottom.y),
      bottom: bottom.key,
      left: left.key,
      right: right.key,
    };
  });
  return { label, ...g };
}

for (const [mode, aspect] of [
  ["standard", 1],
  ["standard", 2],
  ["bigkeys", 1],
  ["bigkeys", 2],
  ["standard", 3],
]) {
  await scenario(
    `Right pad only, ${mode}, shape ${aspect}:1 through Steam's raw pad mapping`,
    async () => {
      await setSetting("mode", mode);
      await setSetting("oneAspect", aspect);
      return gains(`${mode} ${aspect}`);
    },
    (o, s, g) => {
      const ratio = g.dx / g.dy;
      const shapeOk = aspect === 3 ? ratio > 2.4 : Math.abs(ratio - aspect) < 0.15 * aspect;
      return (
        shapeOk &&
        /^[a-z]$/.test(g.centre) &&
        /^([0-9=-]|Escape|Backspace|OSKSug_\d)$/.test(g.top) &&
        g.bottomY <= 12 &&
        g.left !== null &&
        g.right !== null
      );
    },
  );
}
await setSetting("oneAspect", 2);
await setSetting("mode", "bigkeys");
await setSetting("reach", 55);
await settle(page);

async function rawHover(side, ux, uy) {
  const dispatch = () =>
    kbEval((kb, side, ux, uy) => kb.m_trackpadInput.m_AnalogCallbacks.Dispatch(side === "L" ? 19 : 21, 0, ux, uy), side, ux, uy);
  await dispatch();
  await sleep(30);
  await dispatch();
  return kbEval((kb, side) => {
    const p = side === "L" ? kb.m_leftTrackpad : kb.m_rightTrackpad;
    const r = kb.m_keyboardDiv.getBoundingClientRect();
    return { key: p.lastElement?.getAttribute("data-key") ?? null, fx: +((p.x - r.left) / r.width).toFixed(3) };
  }, side);
}

async function rawOf(key, side) {
  const c = await center(key);
  return kbEval(
    (kb, c, side) => {
      const r = kb.m_keyboardDiv.getBoundingClientRect();
      const M = window.__oskModes,
        F = window.__oskTrackpadFix;
      const mode = M.modes[F.settings.mode] ?? M.modes.standard;
      const G = M.geometry;
      const L = G.layoutFrom(F.modeApi.keys(kb), r, F.modeApi.spans());
      const [px, py] = G.toPad(G.padMap(mode.map, L), side, c.x, c.y);
      return { ux: (2 * px) / G.PAD_MM - 1, uy: 1 - (2 * py) / G.PAD_MM };
    },
    c,
    side,
  );
}

async function reaches(side, key) {
  const raw = await rawOf(key, side);
  return (await rawHover(side, Math.max(-1, Math.min(1, raw.ux)), raw.uy)).key === key;
}

async function rowsAt(ux, side) {
  const out = {};
  for (const [row, probe] of [
    ["top", "q"],
    ["home", "a"],
    ["bottom", "z"],
  ])
    out[row] = await rawHover(side, ux, (await rawOf(probe, side)).uy);
  return out;
}

for (const mode of ["bigkeys", "standard"]) {
  await scenario(
    `pad reach 55 (default), ${mode}: left pad at its far right stays left of the middle, right pad at its far left stays right of it`,
    async () => {
      await setSetting("mode", mode);
      await setSetting("reach", 55);
      await settle(page);
      return {
        left: await rowsAt(0.95, "L"),
        right: await rowsAt(-0.95, "R"),
        pLeft: await reaches("L", "p"),
        qRight: await reaches("R", "q"),
      };
    },
    (o, s, x) =>
      ["top", "home", "bottom"].every(
        (row) => /^[a-z]$/.test(x.left[row].key) && x.left[row].fx < 0.55 && /^[a-z]$/.test(x.right[row].key) && x.right[row].fx > 0.45,
      ) &&
      !"iopkl".includes(x.left.top.key) &&
      !"iopkl".includes(x.left.home.key) &&
      !x.pLeft &&
      !x.qRight,
  );
  await scenario(
    `pad reach 75, ${mode}: left pad at its far right reaches i, o and p, right pad at its far left reaches w, e, r and d`,
    async () => {
      await setSetting("reach", 75);
      await settle(page);
      const left = await rowsAt(0.95, "L"),
        right = await rowsAt(-0.95, "R");
      return {
        left,
        right,
        o: await reaches("L", "o"),
        i: await reaches("L", "i"),
        e: await reaches("R", "e"),
        r: await reaches("R", "r"),
        d: await reaches("R", "d"),
        p: await reaches("L", "p"),
      };
    },
    (o, s, x) =>
      "iop".includes(x.left.top.key) &&
      x.left.top.fx > 0.7 &&
      "kl;".includes(x.left.home.key) &&
      "wer".includes(x.right.top.key) &&
      "sdf".includes(x.right.home.key) &&
      x.right.top.fx < 0.3 &&
      x.o &&
      x.i &&
      x.e &&
      x.r &&
      x.d &&
      x.p,
  );
  await scenario(
    `pad reach 100, ${mode}: either pad reaches q and p, z and m; up and down still reach the top and bottom letter rows`,
    async () => {
      await setSetting("reach", 100);
      await settle(page);
      const out = {};
      for (const side of ["L", "R"]) for (const k of ["q", "p", "a", "l", "z", "m", "g"]) out[`${side}${k}`] = await reaches(side, k);
      const probe = {};
      for (const side of ["L", "R"]) {
        const g = await rawOf("g", side);
        probe[side] = [
          (await rawHover(side, g.ux, (await rawOf("t", side)).uy)).key,
          (await rawHover(side, g.ux, (await rawOf("b", side)).uy)).key,
        ];
      }
      return { out, probe };
    },
    (o, s, x) =>
      Object.values(x.out).every(Boolean) &&
      ["L", "R"].every((side) => "qwertyuiop".includes(x.probe[side][0]) && "zxcvbnm".includes(x.probe[side][1])),
  );
}
await setSetting("reach", 55);
await setSetting("mode", "bigkeys");
await settle(page);

await scenario(
  "Enter with Steam's dismiss-on-Enter set: keyboard stays open (setting off, default)",
  async () => {
    await page.evaluate(() => window.__sim.vkm.SetDismissOnEnterKey(true));
    await padTap("R", "Enter");
    await settle(page);
    return {
      showing: await page.evaluate(() => window.__sim.vkm.m_bIsVirtualKeyboardShowing.Value),
      def: await page.evaluate(() => window.__oskTrackpadFix.settings.enterCloses),
    };
  },
  (o, s, x) => o === "⏎" && x.showing === true && x.def === false,
);
await scenario(
  "Enter with the setting turned on later: Steam's own dismiss-on-Enter is restored and closes the keyboard",
  async () => {
    await setSetting("enterCloses", true);
    await padTap("R", "Enter");
    await settle(page);
    const showing = await page.evaluate(() => window.__sim.vkm.m_bIsVirtualKeyboardShowing.Value);
    await setSetting("enterCloses", false);
    await page.evaluate(() => window.__sim.vkm.SetVirtualKeyboardVisible());
    await waitKeyboard(page);
    return { showing };
  },
  (o, s, x) => o === "⏎" && x.showing === false,
);

await scenario(
  "plain space by pad still types a space (on release)",
  () => padTap("R", " "),
  (o) => o === " ",
);
await scenario(
  "plain space by touch still types a space",
  () => touchSlide(" ", 0, { steps: 0 }),
  (o) => o === " ",
);
await scenario(
  "pad: hold space and slide 3 keys left = arrows left, no space",
  async () => {
    await padTap("L", "h");
    await padTap("R", "e");
    return { buf: (await padSlide("L", " ", -3), await page.evaluate(() => window.__oskTrackpadFix.tracker.buf)) };
  },
  (o, s, x) => /^he←{3,8}$/.test(o) && x.buf === "",
);
await scenario(
  "pad: hold space and slide 2 keys right = arrows right",
  async () => {
    await padSlide("R", " ", 2, { from: 1 });
  },
  (o) => /^→{2,6}$/.test(o),
);
await scenario(
  "pad: slide right then back left cancels or reverses, never a space",
  () =>
    padSlide("R", " ", 0, { steps: 1 }).then(async () => {
      const c = await center(" ");
      const kw = (await center("g")).w;
      await padAt("R", c.x + kw, c.y);
      await vgp("vgp_onbuttondown", BTN.R);
      for (let i = 1; i <= 10; i++) {
        await padAt("R", c.x + kw + (2 * kw * i) / 10, c.y);
        await sleep(25);
      }
      for (let i = 1; i <= 10; i++) {
        await padAt("R", c.x + 3 * kw - (2 * kw * i) / 10, c.y);
        await sleep(25);
      }
      await vgp("vgp_onbuttonup", BTN.R);
      await padIdle("R");
    }),
  (o) => /^ →+←+$/.test(o),
);
await scenario(
  "touch: slide on the space bar = arrows, Steam types no space",
  async () => {
    await touchSlide(" ", -3, { from: 1 });
  },
  (o) => /^←{3,8}$/.test(o),
);
const slideArrows = async (kind, reach, dxKeys) => {
  await setSetting("reach", reach);
  await settle(page);
  await page.evaluate(() => {
    window.__keyLog.length = 0;
  });
  if (kind === "touch") await touchSlide(" ", dxKeys, { steps: 24, ms: 60, from: 1 });
  else await padSlide("L", " ", dxKeys, { steps: 24, ms: 60, from: 1 });
  const n = arrows(view(await page.evaluate(() => window.__keyLog.slice())));
  await page.evaluate(() => {
    window.__keyLog.length = 0;
  });
  return n;
};

await scenario(
  "touch: a space-bar slide is unscaled by pad reach, so the same travel walks the same arrows at 55 and 100",
  async () => {
    const n55 = await slideArrows("touch", 55, -6);
    const n100 = await slideArrows("touch", 100, -6);
    const pad = await slideArrows("pad", 55, -6);
    await setSetting("reach", 55);
    await settle(page);
    return { n55, n100, pad55: pad };
  },
  (o, s, x) => x.n55 >= 4 && x.n55 === x.n100 && x.pad55 === x.n55,
);
await scenario(
  "pad: a space-bar slide at reach 100 walks 1.82x fewer arrows than at 55 for the same travel",
  async () => {
    const n55 = await slideArrows("pad", 55, -6);
    const n100 = await slideArrows("pad", 100, -6);
    await setSetting("reach", 55);
    await settle(page);
    return { n55, n100, ratio: Math.round((n55 / Math.max(1, n100)) * 100) / 100 };
  },
  (o, s, x) => x.n55 >= 4 && x.n100 >= 2 && Math.abs(x.n55 / x.n100 - 100 / 55) < 0.15,
);
await scenario(
  "touch: tap a, b then slide right resets the word tracker",
  async () => {
    await touchSlide("a", 0, { steps: 0 });
    await sleep(40);
    await touchSlide("b", 0, { steps: 0 });
    await sleep(40);
    await touchSlide(" ", 2);
    return { buf: await page.evaluate(() => window.__oskTrackpadFix.tracker.buf) };
  },
  (o, s, x) => /^ab→{2,6}$/.test(o) && x.buf === "",
);
await scenario(
  "fast long slide (8 keys in 160 ms): output catches up within 150 ms of the last move",
  async () => {
    const t = await padSlide("L", " ", -8, { steps: 16, ms: 10, from: 2 });
    const lag = await page.evaluate(async (t) => {
      const O = window.__oskTrackpadFix.output;
      while (O.busy || O.queue.length) await new Promise((r) => setTimeout(r, 2));
      return performance.now() - t;
    }, t);
    return { lag: Math.round(lag), dropped: await page.evaluate(() => window.__oskTrackpadFix.slide.dropped) };
  },
  (o, s, x) => /^←{4,}$/.test(o) && x.lag <= 160,
);
await scenario(
  "Right pad only: right pad slides left from space",
  async () => {
    await setSetting("reach", "right");
    await settle(page);
    await padSlide("R", " ", -3, { from: 1 });
    await setSetting("reach", 55);
    await settle(page);
  },
  (o) => /^←{2,8}$/.test(o),
);
await scenario(
  "setting off: slide on space just types a space",
  async () => {
    await setSetting("slideCursor", false);
    await padSlide("R", " ", 3);
    await setSetting("slideCursor", true);
  },
  (o) => o === " ",
);
await scenario(
  "rolled: space held, next letter pressed before release = space then letter",
  async () => {
    await padTap("R", "o");
    const sp = await center(" ");
    await padAt("L", sp.x, sp.y);
    await vgp("vgp_onbuttondown", BTN.L);
    await sleep(20);
    await padTap("R", "k");
    await vgp("vgp_onbuttonup", BTN.L);
    await padIdle("L");
  },
  (o) => o === "o k",
);

await padTap("R", " ");
await scenario(
  "typing lpl: middle suggestion lol, literal kept in the left slot",
  async () => {
    for (const k of "lpl") await padTap("R", k);
  },
  (o, s) => o === "lpl" && s[1] === "lol" && /lpl/.test(s[0]),
);
await scenario(
  "pick the middle: lpl -> lol and a space",
  () => padTap("L", "OSKSug_1"),
  (o) => o === "⌫⌫⌫lol ",
);
await scenario(
  "typing lpl again and picking the literal keeps it",
  async () => {
    for (const k of "lpl") await padTap("R", k);
    await padTap("L", "OSKSug_0");
  },
  (o) => o === "lpl ",
);
await scenario(
  "Backspace still undoes autocorrect: teh + space -> the, Backspace -> teh",
  async () => {
    for (const k of "teh") await padTap("R", k);
    await padTap("R", " ");
    await settle(page);
    await padTap("R", "Backspace");
  },
  (o) => /^teh(⌫+the )?(⌫+teh)?$/.test(o) || o === "teh⌫⌫⌫the ⌫⌫⌫⌫teh",
);

if (shots) await page.screenshot({ path: path.join(shots, "input.png") });
console.log(results.join("\n"));
console.log(failures ? `${failures} FAILED` : "ALL PASS");
await browser.close();
process.exit(failures ? 1 : 0);
