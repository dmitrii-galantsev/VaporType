import fs from "node:fs";
import { openSim, settle } from "./run.mjs";
import { readRuntime as read } from "../runtime.mjs";

export const TICK = 8;
export const LEFT = "asdfgqwertzxcvb";
export const RIGHT = "hjklyuiopnm";

export async function openTwoPad({ patch = process.env.PATCH, settings = {}, modes = process.env.WITH_MODES !== "0" } = {}) {
  const src = patch ? fs.readFileSync(patch, "utf8") : read("patch.js");
  const sim = await openSim();
  const { page } = sim;
  await page.evaluate(["swipe/words.js", "swipe/lm.js", "swipe/engine.js"].map(read).join("\n;\n"));
  if (modes) await page.evaluate(process.env.MODES ? fs.readFileSync(process.env.MODES, "utf8") : read("modes.js"));
  await page.evaluate(() => {
    window.__oskUserWords = null;
    window.localStorage.clear();
    window.localStorage.setItem("oskSwipeSettings", JSON.stringify({ consent: true, tipShown: true }));
  });
  await page.evaluate(src);
  await page.waitForFunction(() => /keyboard=patched/.test(window.__oskTrackpadFix?.status?.() ?? ""), { timeout: 10000, polling: 20 });
  await page.evaluate((s) => {
    for (const [k, v] of Object.entries(s)) window.__oskTrackpadFix.setSetting(k, v);
  }, settings);
  await page.waitForFunction(() => window.__oskTrackpadFix.idle?.() !== false && window.__oskEngine, { timeout: 15000, polling: 50 });
  await settle(page);
  await new Promise((r) => setTimeout(r, 700));
  await page.evaluate(installDriver);
  return sim;
}

function installDriver() {
  const key = document.querySelector("[data-key]");
  const findKb = () => {
    const el = [...document.querySelectorAll("[data-key]")].find((e) => e.getBoundingClientRect().width > 0) ?? key;
    const fiber = Object.keys(el).find((k) => k.startsWith("__reactFiber"));
    for (let f = el[fiber]; f; f = f.return) if (typeof f.stateNode?.HandleTrackpadClick === "function") return f.stateNode;
    return null;
  };
  let kb = findKb();
  const cbs = [];
  const timed = (fn, kind) =>
    function (...a) {
      const t = performance.now();
      try {
        return fn.apply(this, a);
      } finally {
        const d = performance.now() - t;
        cbs.push([t, d, d > 10 ? `${kind} ${String(fn).slice(0, 48).replace(/\s+/g, " ")}` : kind]);
      }
    };
  const st = window.setTimeout;
  window.setTimeout = function (fn, ms, ...a) {
    return st.call(this, typeof fn === "function" ? timed(fn, "timer") : fn, ms, ...a);
  };
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = function (fn) {
    return raf.call(this, timed(fn, "raf"));
  };
  const sends = [];
  const inp = SteamClient.Input;
  const orig = inp.ControllerKeyboardSendText;
  inp.ControllerKeyboardSendText = function (t) {
    sends.push([performance.now(), t]);
    return orig.call(this, t);
  };
  const center = (k) => {
    const el = [...document.querySelectorAll("[data-key]")].find(
      (e) => e.getAttribute("data-key") === k && e.getBoundingClientRect().width > 0,
    );
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const raw = (k, side) => {
    const c = center(k);
    const r = kb.m_keyboardDiv.getBoundingClientRect();
    const M = window.__oskModes,
      F = window.__oskTrackpadFix;
    const onePad = side === "R" && F.settings?.reach === "right";
    if (M && F?.modeApi) {
      const mode = M.modes[F.settings.mode] ?? M.modes.standard;
      const G = M.geometry;
      const L = G.layoutFrom(F.modeApi.keys(kb), r, F.modeApi.spans());
      const [px, py] = G.toPad(G.padMap(mode.map, L), side, c.x, c.y);
      return [(2 * px) / G.PAD_MM - 1, 1 - (2 * py) / G.PAD_MM];
    }
    const span = onePad ? 1 : 0.55;
    const left = side === "L" || onePad ? r.left : r.right - r.width * span;
    return [(2 * (c.x - left)) / (r.width * span) - 1, 1 - (2 * (c.y - r.top)) / r.height];
  };
  const vgp = (type, button) => {
    const t0 = performance.now();
    (document.querySelector("[data-key]") ?? document.body).dispatchEvent(
      new CustomEvent(type, { bubbles: true, cancelable: true, detail: { button, source: 1, is_repeat: false } }),
    );
    return performance.now() - t0;
  };
  const act = {
    hide: () => {
      window.__sim.vkm.SetVirtualKeyboardHidden();
      window.__oskTrackpadFix.tickNow();
    },
    btnDown: (b) => vgp("vgp_onbuttondown", b),
    btnUp: (b) => vgp("vgp_onbuttonup", b),
    typeText: (s) => window.__oskTrackpadFix.typeText(s),
  };
  async function reopen() {
    window.__sim.vkm.SetVirtualKeyboardVisible();
    window.__oskTrackpadFix.tickNow();
    for (let i = 0; i < 300; i++) {
      const g = [...document.querySelectorAll('[data-key="g"]')].some((e) => e.getBoundingClientRect().width > 0);
      if (g) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    kb = findKb();
    window.__tp.kb = kb;
  }
  let seed = 1;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const at = (path, t) => {
    if (t <= path[0][0]) return [path[0][1], path[0][2]];
    for (let i = 1; i < path.length; i++)
      if (t <= path[i][0]) {
        const [ta, xa, ya] = path[i - 1],
          [tb, xb, yb] = path[i];
        const f = tb > ta ? (t - ta) / (tb - ta) : 1;
        return [xa + (xb - xa) * f, ya + (yb - ya) * f];
      }
    const l = path[path.length - 1];
    return [l[1], l[2]];
  };
  async function drive(plan) {
    seed = plan.seed ?? 1;
    const F = window.__oskTrackpadFix;
    const sides = Object.keys(plan.pads);
    const out = { samples: [], downs: [], ups: [], frames: [], sends: [], acts: [] };
    const acts = [...(plan.acts ?? [])].sort((a, b) => a[0] - b[0]);
    let ai = 0;
    const k0 = window.__keyLog.length;
    const events = sides
      .flatMap((s) =>
        (plan.pads[s].presses ?? []).flatMap(([d, u]) => [
          [d, s, "down"],
          [u, s, "up"],
        ]),
      )
      .sort((a, b) => a[0] - b[0] || (a[2] === "up" ? -1 : 1));
    let ei = 0;
    const s0 = sends.length;
    let frames = true,
      lastFrame = 0;
    const loop = (t) => {
      if (lastFrame) out.frames.push([performance.now() - out.t0, t - lastFrame]);
      lastFrame = t;
      if (frames) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    let muts = 0;
    const mo = new MutationObserver((m) => (muts += m.length));
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    const t0 = performance.now();
    out.t0 = t0;
    let k = 0,
      n = sends.length,
      since = t0;
    for (;;) {
      const t = plan.stepped ? k * 8 : performance.now() - t0;
      const touching = sides.filter((s) => {
        const p = plan.pads[s];
        return p.touch && t >= p.touch[0] && t < p.touch[1];
      });
      for (const s of sides) {
        const p = plan.pads[s];
        const on = touching.includes(s);
        if (on) {
          const [ux, uy] = at(p.path, t);
          const j = p.jitter ?? 0.002;
          const a = performance.now();
          kb.m_trackpadInput.m_AnalogCallbacks.Dispatch(s === "L" ? 19 : 21, 0, ux + j * rnd(), uy + j * rnd());
          out.samples.push([a - t0, s, performance.now() - a, touching.length]);
        }
      }
      while (ei < events.length && events[ei][0] <= t) {
        const [, s, type] = events[ei++];
        const a = performance.now();
        const h = vgp(type === "down" ? "vgp_onbuttondown" : "vgp_onbuttonup", s === "L" ? 20 : 22);
        out[type === "down" ? "downs" : "ups"].push([a - t0, s, h]);
      }
      while (ai < acts.length && acts[ai][0] <= t) {
        const [, name, arg, after] = acts[ai++];
        const fire = () => {
          out.acts.push([performance.now() - t0, name, arg, window.__keyLog.length - k0]);
          act[name](arg);
        };
        if (after === undefined) fire();
        else setTimeout(fire, after);
      }
      if (sends.length !== n || F.idle?.() === false) {
        n = sends.length;
        since = performance.now();
      }
      if (
        t >= plan.end &&
        ei >= events.length &&
        ai >= acts.length &&
        (performance.now() - since > (plan.quiet ?? 300) || t > plan.end + (plan.wait ?? 1500))
      )
        break;
      k++;
      await new Promise((r) => setTimeout(r, Math.max(0, t0 + k * 8 - performance.now())));
    }
    frames = false;
    mo.disconnect();
    out.mutations = muts;
    out.sends = sends.slice(s0).map(([t, x]) => [t - t0, x]);
    out.keys = window.__keyLog.slice(k0).map(([, kind, v]) => [kind, v]);
    out.callbacks = cbs.filter(([t]) => t >= t0).map(([t, d, k]) => [t - t0, d, k]);
    cbs.length = 0;
    out.decodeMs = F.lastDecodeMs;
    return out;
  }
  window.__tp = { kb, raw, drive, sends, reopen };
}

export const raw = (page, keys, side) => page.evaluate((keys, side) => [...keys].map((k) => window.__tp.raw(k, side)), keys, side);

export const rest = async (page, k, side) => (await raw(page, k, side))[0];

export async function swipePath(page, word, side, t, segMs = 64) {
  const pts = await raw(page, word, side);
  return pts.map(([x, y], i) => [t + i * segMs, x, y]);
}

export function restAt(pt, t0 = 0, t1 = 1e9, jitter = 0.002) {
  return { path: [[0, pt[0], pt[1]]], touch: [t0, t1], presses: [], jitter };
}

export async function swipePad(page, word, side, { start = 40, segMs = 64, liftAfter = 20, restAfter = false, restFrom } = {}) {
  const path = await swipePath(page, word, side, start, segMs);
  const end = path[path.length - 1][0];
  const pre = restFrom
    ? [
        [0, ...restFrom],
        [Math.max(0, start - 30), path[0][1], path[0][2]],
      ]
    : [[0, path[0][1], path[0][2]]];
  return {
    path: [...pre, ...path],
    touch: [0, restAfter ? 1e9 : end + liftAfter],
    presses: [[start, end]],
    release: end,
  };
}

export function sent(out, from = -Infinity) {
  let s = "";
  for (const [t, x] of out.sends) {
    if (t < from) continue;
    if (x === "\u0002") s = s.slice(0, -1);
    else if (x === "\u0001") s += "\n";
    else s += x;
  }
  return s;
}

export function lastUp(out, side) {
  const u = out.ups.filter(([, s]) => !side || s === side);
  return u.length ? u[u.length - 1][0] : NaN;
}

export function lastSample(out, side) {
  const s = out.samples.filter(([, x]) => x === side);
  return s.length ? s[s.length - 1][0] : NaN;
}

export function firstSendAfter(out, t) {
  const s = out.sends.find(([at]) => at >= t);
  return s ? s[0] - t : NaN;
}

export const pct = (v, p) => {
  const s = v.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN;
};

export async function reset(page) {
  await settle(page, { join: false });
  await page.waitForFunction(() => !window.__tp.kb.m_leftTrackpad.active && !window.__tp.kb.m_rightTrackpad.active, {
    timeout: 3000,
    polling: 10,
  });
  await new Promise((r) => setTimeout(r, 250));
  await settle(page, { join: false });
}
