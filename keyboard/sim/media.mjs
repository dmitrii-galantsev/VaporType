import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { openSim, inject, settle, waitKeyboard } from "./run.mjs";
import { readRuntime as read } from "../runtime.mjs";
import { pageHelpers, sideOf, sleep } from "./helpers.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const out = path.resolve(process.argv[2] ?? path.join(here, "..", "..", "docs", "media"));
const tmp = process.env.MEDIA_TMP ?? fs.mkdtempSync(path.join(os.tmpdir(), "vaportype-media-"));
const keepTmp = !!process.env.MEDIA_TMP;
const only = process.argv.slice(3);
const SCREEN_H = 534;
const PANEL_H = 128;
const W = 854;
const GIF_W = Number(process.env.MEDIA_W ?? 854);
const FPS = Number(process.env.MEDIA_FPS ?? 15);
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(tmp, { recursive: true });

const BTN = { L: 20, R: 22 };

function stage({ chat, panel, SCREEN_H, PANEL_H }) {
  const css = `
#vt-screen{position:fixed;left:0;top:0;width:100%;height:${SCREEN_H}px;z-index:0;overflow:hidden;
  background:radial-gradient(120% 90% at 75% 10%,#41557a 0%,#1f2a3d 45%,#121822 100%);font:15px/1.45 "Motiva Sans",Arial,sans-serif;color:#dfe6ee}
#vt-chat{position:absolute;left:22px;top:18px;width:470px;padding:10px 14px 12px;border-radius:8px;background:rgba(10,14,20,.72);box-shadow:0 4px 18px rgba(0,0,0,.35)}
#vt-chat .h{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8fa3ba;margin-bottom:6px}
#vt-chat .l{margin:0 0 3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#vt-chat .l b{color:#7fc4ff;font-weight:600}
#vt-chat .l.me b{color:#ffc27a}
#vt-in{margin-top:9px;display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:6px;background:#0b0f15;border:1.5px solid #3c74b8;font-size:19px;min-height:26px;white-space:pre}
#vt-in .p{font-size:13px;color:#7f93a8}
#vt-in .c{display:inline-block;width:2px;height:22px;background:#fff;margin:0 -1px;vertical-align:-4px;animation:vtb 1s steps(1) infinite}
@keyframes vtb{50%{opacity:0}}
#vt-panel{position:fixed;left:0;right:0;bottom:0;height:${PANEL_H}px;z-index:5;background:linear-gradient(#2a2e35,#1d2026);border-top:1px solid #3a3f48;
  font:15px/1.35 "Motiva Sans",Arial,sans-serif;color:#e9eef4;display:flex;align-items:center;justify-content:space-between;padding:0 22px;box-sizing:border-box}
.vt-pad{position:relative;width:88px;height:88px;border-radius:14px;background:#15181d;border:2px solid #3b4049;box-shadow:inset 0 2px 8px rgba(0,0,0,.6);flex:none}
.vt-padw{display:flex;flex-direction:column;align-items:center;gap:5px;flex:none}
.vt-padw .lab{font-size:11px;letter-spacing:.08em;color:#8a94a2}
.vt-pad svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.vt-pad .dot{position:absolute;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;opacity:0;transition:opacity .12s}
.vt-pad.on .dot{opacity:1}
.vt-pad .clk{position:absolute;right:6px;top:5px;font-size:10px;font-weight:700;letter-spacing:.06em;opacity:0}
.vt-pad.down .clk{opacity:1}
#vt-padL .dot{background:rgba(26,159,255,.45);border:2px solid rgb(26,159,255)}
#vt-padR .dot{background:rgba(255,170,60,.45);border:2px solid rgb(255,170,60)}
#vt-padL.down{border-color:rgb(26,159,255)} #vt-padR.down{border-color:rgb(255,170,60)}
#vt-padL.down .dot{background:rgb(26,159,255)} #vt-padR.down .dot{background:rgb(255,170,60)}
#vt-padL .clk{color:rgb(26,159,255)} #vt-padR .clk{color:rgb(255,170,60)}
#vt-cap{flex:1;text-align:center;padding:0 18px}
#vt-cap .m{font-size:19px;font-weight:600}
#vt-cap .s{margin-top:4px;font-size:14px;color:#a9b4c2;min-height:19px}
#vt-cap .m kbd,#vt-cap .s kbd{font:inherit;font-weight:700;padding:0 6px;border-radius:4px;background:#3a414c;color:#fff}
#vt-cap .L{color:rgb(70,178,255)} #vt-cap .R{color:rgb(255,180,85)}
`;
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);
  const scr = document.createElement("div");
  scr.id = "vt-screen";
  const box = document.createElement("div");
  box.id = "vt-chat";
  box.innerHTML = `<div class="h">Party chat</div><div id="vt-log"></div><div id="vt-in"><span class="p">Say:</span><span id="vt-txt"></span></div>`;
  scr.appendChild(box);
  document.body.insertBefore(scr, document.body.firstChild);
  const log = box.querySelector("#vt-log");
  const addLine = (who, msg) => {
    const p = document.createElement("div");
    p.className = "l" + (who === "you" ? " me" : "");
    p.innerHTML = `<b></b> <span></span>`;
    p.firstChild.textContent = who + ":";
    p.lastChild.textContent = msg;
    log.appendChild(p);
    while (log.children.length > 4) log.firstChild.remove();
  };
  for (const [who, msg] of chat) addLine(who, msg);
  document.getElementById("root").style.bottom = panel ? `${PANEL_H}px` : "0";
  document.getElementById("root").style.zIndex = "1";
  if (panel) {
    const pn = document.createElement("div");
    pn.id = "vt-panel";
    const pad = (s) =>
      `<div class="vt-pad" id="vt-pad${s}"><svg viewBox="0 0 88 88"><polyline fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" stroke="${s === "L" ? "rgb(26,159,255)" : "rgb(255,170,60)"}" points=""/></svg><div class="dot"></div><div class="clk">CLICK</div></div>`;
    const padw = (s) => `<div class="vt-padw">${pad(s)}<div class="lab">${s === "L" ? "LEFT PAD" : "RIGHT PAD"}</div></div>`;
    pn.innerHTML = `${padw("L")}<div id="vt-cap"><div class="m"></div><div class="s"></div></div>${padw("R")}`;
    document.body.appendChild(pn);
  }
  const trails = { L: [], R: [] };
  const P = (window.__vt = {
    cap(m, s = "") {
      const c = document.querySelector("#vt-cap");
      if (!c) return;
      c.querySelector(".m").innerHTML = m;
      c.querySelector(".s").innerHTML = s;
    },
    pad(side, x, y, down) {
      const el = document.getElementById(`vt-pad${side}`);
      if (!el) return;
      if (x == null) {
        el.classList.remove("on", "down");
        trails[side] = [];
        el.querySelector("polyline").setAttribute("points", "");
        return;
      }
      const dot = el.querySelector(".dot");
      dot.style.left = `${x * 88}px`;
      dot.style.top = `${y * 88}px`;
      el.classList.add("on");
      el.classList.toggle("down", !!down);
      if (down) trails[side].push(`${(x * 88).toFixed(1)},${(y * 88).toFixed(1)}`);
      else trails[side] = [];
      el.querySelector("polyline").setAttribute("points", trails[side].join(" "));
    },
  });
  const LET = "abcdefghijklmnopqrstuvwxyz";
  const NUM = "1234567890";
  let seen = 0,
    text = "",
    caret = 0,
    shift = false;
  const ins = (s) => {
    text = text.slice(0, caret) + s + text.slice(caret);
    caret += s.length;
  };
  const bs = () => {
    if (!caret) return;
    text = text.slice(0, caret - 1) + text.slice(caret);
    caret--;
  };
  const enter = () => {
    if (text.trim()) addLine("you", text.trim());
    text = "";
    caret = 0;
  };
  const txt = document.getElementById("vt-txt");
  let shown = null;
  const render = () => {
    const k = `${text}\u0000${caret}`;
    if (k === shown) return;
    shown = k;
    txt.replaceChildren(
      document.createTextNode(text.slice(0, caret)),
      Object.assign(document.createElement("span"), { className: "c" }),
      document.createTextNode(text.slice(caret)),
    );
  };
  P.caret = () => caret;
  P.setText = (s) => {
    text = s;
    caret = s.length;
    seen = window.__keyLog.length;
    render();
  };
  const tick = () => {
    const log = window.__keyLog;
    for (; seen < log.length; seen++) {
      const [, kind, v] = log[seen];
      if (kind === "text") {
        for (const ch of String(v)) {
          if (ch === "\u0002") bs();
          else if (ch === "\u0001") enter();
          else if (ch === "\u0003") caret = Math.max(0, caret - 1);
          else if (ch === "\u0004") caret = Math.min(text.length, caret + 1);
          else if (ch < " ") continue;
          else ins(ch);
        }
      } else if (kind === "down") {
        const c = Number(v);
        if (c === 225 || c === 229) shift = true;
        else if (c >= 4 && c <= 29) ins(shift ? LET[c - 4].toUpperCase() : LET[c - 4]);
        else if (c >= 30 && c <= 39) ins(NUM[c - 30]);
        else if (c === 44) ins(" ");
        else if (c === 42) bs();
        else if (c === 40) enter();
        else if (c === 80) caret = Math.max(0, caret - 1);
        else if (c === 79) caret = Math.min(text.length, caret + 1);
      } else if (kind === "up") {
        const c = Number(v);
        if (c === 225 || c === 229) shift = false;
      }
    }
    render();
    requestAnimationFrame(tick);
  };
  render();
  requestAnimationFrame(tick);
}

const CHAT = [
  ["mira", "gg, that last push was close"],
  ["kestrel", "one more round?"],
];

function driver() {
  const el = [...document.querySelectorAll("[data-key]")].find((e) => e.getBoundingClientRect().width > 0);
  const fk = Object.keys(el).find((k) => k.startsWith("__reactFiber"));
  let kb = null;
  for (let f = el[fk]; f; f = f.return)
    if (typeof f.stateNode?.HandleTrackpadClick === "function") {
      kb = f.stateNode;
      break;
    }
  const M = window.__oskModes,
    F = window.__oskTrackpadFix,
    G = M.geometry;
  const map = () =>
    G.padMap(
      (M.modes[F.settings.mode] ?? M.modes.standard).map,
      G.layoutFrom(F.modeApi.keys(kb), kb.m_keyboardDiv.getBoundingClientRect(), F.modeApi.spans()),
    );
  const raw = (side, x, y) => {
    const [px, py] = G.toPad(map(), side, x, y);
    return [(2 * px) / G.PAD_MM - 1, 1 - (2 * py) / G.PAD_MM];
  };
  const clamp = (v) => Math.max(-0.999, Math.min(0.999, v));
  const cur = {};
  const send = (side) => {
    const c = cur[side];
    if (!c) return;
    const [ux, uy] = raw(side, c.x, c.y);
    kb.m_trackpadInput.m_AnalogCallbacks.Dispatch(side === "L" ? 19 : 21, 0, clamp(ux), clamp(uy));
    window.__vt.pad(side, (clamp(ux) + 1) / 2, (1 - clamp(uy)) / 2, c.down);
  };
  setInterval(() => {
    send("L");
    send("R");
  }, 8);
  window.__vtDrive = {
    map,
    at(side, x, y, down) {
      cur[side] = { x, y, down };
      send(side);
    },
    lift(side) {
      delete cur[side];
      kb.m_trackpadInput.m_AnalogCallbacks.Dispatch(side === "L" ? 19 : 21, 0, 0, 0);
      (side === "L" ? kb.m_leftTrackpad : kb.m_rightTrackpad).active = false;
      window.__vt.pad(side, null);
    },
  };
}

async function boot({ chat = CHAT, panel = true, settings = {} } = {}) {
  const sim = await openSim({ height: SCREEN_H + (panel ? PANEL_H : 0) });
  const { page } = sim;
  await page.evaluate(stage, { chat, panel, SCREEN_H, PANEL_H });
  await page.evaluate(["swipe/words.js", "swipe/lm.js", "swipe/engine.js", "modes.js"].map(read).join("\n;\n"));
  await page.evaluate((s) => {
    window.__oskUserWords = null;
    window.localStorage.clear();
    window.localStorage.setItem("oskSwipeSettings", JSON.stringify({ consent: true, tipShown: true, theme: "modern", ...s }));
  }, settings);
  await inject(page, read("patch.js"));
  await waitKeyboard(page);
  await page.evaluate(driver);
  const h = pageHelpers(page);
  const cap = (m, s) => page.evaluate((m, s) => window.__vt.cap(m, s), m, s);
  const state = { L: false, R: false };
  const padAt = (side, x, y) => page.evaluate((a) => window.__vtDrive.at(...a), [side, x, y, state[side]]);
  const press = async (side) => {
    state[side] = true;
    await h.vgp("vgp_onbuttondown", BTN[side]);
  };
  const release = async (side) => {
    state[side] = false;
    await h.vgp("vgp_onbuttonup", BTN[side]);
  };
  const idle = (side) => page.evaluate((s) => window.__vtDrive.lift(s), side);
  const glide = async (side, from, to, ms, steps = 10) => {
    for (let s = 1; s <= steps; s++) {
      await padAt(side, from.x + ((to.x - from.x) * s) / steps, from.y + ((to.y - from.y) * s) / steps);
      await sleep(ms / steps);
    }
  };
  const hover = async (side, key, ms = 350) => {
    const c = await h.center(key);
    if (!c) throw new Error(`no key ${key}`);
    const at = (await page.evaluate((s) => window.__vtAt?.[s], side)) ?? { x: c.x + (side === "L" ? -40 : 40), y: c.y + 20 };
    await glide(side, at, c, ms, 8);
    await page.evaluate((s, c) => ((window.__vtAt ??= {})[s] = c), side, c);
    return c;
  };
  const tap = async (key, side = sideOf(key), { hold = 140, gap = 250, move = 300, lift = true } = {}) => {
    const c = await hover(side, key, move);
    await sleep(80);
    await press(side);
    await padAt(side, c.x, c.y);
    await sleep(hold);
    await release(side);
    await padAt(side, c.x, c.y);
    if (lift) await idle(side);
    await settle(page, { quiet: 0, join: false });
    await sleep(gap);
  };
  const through = async (side, from, letters, perKey, tail) => {
    const pts = [];
    for (const ch of letters) pts.push(await h.center(ch));
    if (tail && pts.length) {
      const a = pts.length > 1 ? pts[pts.length - 2] : from,
        b = pts[pts.length - 1];
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      pts.push({ x: b.x + ((b.x - a.x) / l) * tail, y: b.y + ((b.y - a.y) / l) * tail });
    }
    let prev = from;
    for (const c of pts) {
      await glide(side, prev, c, perKey, Math.max(4, Math.round(perKey / 25)));
      prev = c;
    }
    return prev;
  };
  const letGo = async (side, at) => {
    await sleep(60);
    await release(side);
    await padAt(side, at.x, at.y);
    await settle(page);
  };
  const stroke = async (side, letters, { perKey = 300, release: up = true, tail = 0 } = {}) => {
    const first = await hover(side, letters[0], 260);
    await sleep(40);
    await press(side);
    await padAt(side, first.x, first.y);
    const end = await through(side, first, letters.slice(1), perKey, tail);
    if (up) await letGo(side, end);
  };
  const drag = async (side, letters, { perKey = 300, tail = 0 } = {}) => {
    const end = await through(side, await h.center(letters[0]), letters.slice(1), perKey, tail);
    await letGo(side, end);
  };
  const reset = async () => {
    await page.evaluate(() => window.__vt.setText(""));
    await idle("L");
    await idle("R");
    await page.evaluate(() => (window.__vtAt = {}));
  };
  return { ...sim, h, cap, padAt, press, release, idle, glide, hover, tap, stroke, drag, reset };
}

async function record(page, name, act, { tail = 1600, lead = 500 } = {}) {
  const dir = path.join(tmp, name.replace(/\.\w+$/, ""));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await page.createCDPSession();
  const frames = [];
  cdp.on("Page.screencastFrame", (f) => {
    frames.push({ t: f.metadata.timestamp, data: f.data });
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  await sleep(lead);
  await act();
  await settle(page);
  await sleep(tail);
  await cdp.send("Page.stopScreencast");
  await cdp.detach();
  const end = Date.now() / 1000;
  const lines = ["ffconcat version 1.0"];
  frames.forEach((f, i) => {
    const file = `f${String(i).padStart(5, "0")}.png`;
    fs.writeFileSync(path.join(dir, file), Buffer.from(f.data, "base64"));
    lines.push(`file ${file}`, `duration ${Math.max(0.001, (frames[i + 1]?.t ?? end) - f.t).toFixed(4)}`);
  });
  lines.push(`file f${String(frames.length - 1).padStart(5, "0")}.png`);
  fs.writeFileSync(path.join(dir, "list.txt"), lines.join("\n") + "\n");
  const vf = `fps=${FPS},scale=${GIF_W}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`;
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    path.join(dir, "list.txt"),
    "-vf",
    vf,
    path.join(out, name),
  ]);
  console.log(name, frames.length, "frames", fs.statSync(path.join(out, name)).size, "bytes");
}

async function still(page, name, clip) {
  const file = path.join(tmp, name.replace(/\.\w+$/, "") + ".raw.png");
  await page.screenshot({ path: file, clip });
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-vf", `scale=${clip.width}:-2:flags=lanczos`, path.join(out, name)]);
  console.log(name, fs.statSync(path.join(out, name)).size, "bytes");
}

async function expect(page, name, want) {
  const got = await page.evaluate(() => document.getElementById("vt-txt").textContent);
  if (got !== want) throw new Error(`${name}: chat box shows ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
}
const want = (n) => !only.length || only.includes(n);
const L = (s) => `<span class="L">${s}</span>`;
const R = (s) => `<span class="R">${s}</span>`;

if (want("swipe")) {
  const s = await boot();
  await s.reset();
  const stepLine = (n) =>
    [`${R("Right")} holds <kbd>h</kbd>`, `${L("Left")} taps <kbd>e</kbd>`, `${R("Right")} slides on to <kbd>l</kbd>→<kbd>o</kbd>, lets go`]
      .slice(0, n)
      .join(" &nbsp;·&nbsp; ");
  await record(
    s.page,
    "swipe.gif",
    async () => {
      await s.cap("Swipe one word across both pads", "Click a pad, hold, drag through the letters, let go");
      await sleep(1800);
      await s.cap("Swipe one word across both pads", stepLine(1));
      await s.stroke("R", "h", { release: false });
      await sleep(150);
      await s.cap("Swipe one word across both pads", stepLine(2));
      await s.tap("e", "L", { gap: 0, move: 220, hold: 110 });
      await s.cap("Swipe one word across both pads", stepLine(3));
      await s.drag("R", "hlo", { perKey: 260 });
      await s.cap("Let go: <kbd>hello</kbd> is typed", stepLine(3));
      await sleep(250);
      await s.idle("R");
      await sleep(2000);
      await s.cap(
        "A word on one half takes one pad",
        `${L("Left")} drags <kbd>g</kbd>→<kbd>r</kbd>→<kbd>e</kbd>→<kbd>a</kbd>→<kbd>t</kbd>`,
      );
      await sleep(900);
      await s.stroke("L", "great", { perKey: 300 });
      await s.cap("Let go: <kbd>great</kbd>, with the space added for you", "");
      await sleep(250);
      await s.idle("L");
      await sleep(600);
    },
    { tail: 2200 },
  );
  await expect(s.page, "swipe", "hello great");
  await s.browser.close();
}

if (want("autocorrect")) {
  const s = await boot();
  await s.reset();
  await record(s.page, "autocorrect.gif", async () => {
    await s.cap("Tap: click a pad on a letter", "Here: <kbd>t</kbd> <kbd>e</kbd> <kbd>h</kbd>, a typo");
    await sleep(900);
    for (const ch of "teh") await s.tap(ch, sideOf(ch), { gap: 200, move: 380 });
    await s.cap("The blue suggestion is what Space will type", "The left one is what you typed");
    await sleep(2000);
    await s.cap("Space corrects <kbd>teh</kbd> → <kbd>the</kbd>", "");
    await s.tap(" ", "R", { gap: 0, move: 450 });
    await sleep(1800);
    await s.cap("Backspace right after a correction undoes it", "Your letters come back");
    await sleep(700);
    await s.tap("Backspace", "R", { gap: 0, move: 500 });
    await sleep(1400);
  });
  await expect(s.page, "autocorrect", "teh");
  await s.browser.close();
}

if (want("suggest")) {
  const s = await boot();
  await s.reset();
  await s.page.evaluate(() => window.__vt.setText("see you "));
  await record(s.page, "suggest.gif", async () => {
    await s.cap("Suggestions finish a word", "Tap the first letters: <kbd>t</kbd> <kbd>o</kbd> <kbd>m</kbd>");
    await sleep(900);
    for (const ch of "tom") await s.tap(ch, sideOf(ch), { gap: 200, move: 380 });
    await sleep(500);
    const key = await s.page.evaluate(() =>
      [0, 1, 2]
        .map((i) => document.querySelector(`[data-key="OSKSug_${i}"]`))
        .find((e) => /tomorrow/.test(e?.textContent ?? ""))
        ?.getAttribute("data-key"),
    );
    if (!key) throw new Error("no tomorrow suggestion");
    await s.cap("Click a suggestion with a pad, tap it, or use D-pad + A", "");
    await sleep(1200);
    await s.tap(key, "R", { gap: 0, move: 600, hold: 180 });
    await s.cap("<kbd>tomorrow</kbd> goes in with a space", "");
    await sleep(1200);
  });
  await expect(s.page, "suggest", "see you tomorrow ");
  await s.browser.close();
}

if (want("cursor")) {
  const s = await boot();
  await s.reset();
  await s.page.evaluate(() => window.__vt.setText("see yu soon"));
  await record(
    s.page,
    "cursor.gif",
    async () => {
      await s.cap("Missed a letter? Move the cursor back", "Hold Space and slide");
      await sleep(1600);
      const sp = await s.h.center(" ");
      const start = { x: sp.x + 60, y: sp.y };
      await s.hover("L", " ", 300);
      await s.glide("L", sp, start, 150, 4);
      await s.press("L");
      await s.padAt("L", start.x, start.y);
      await s.cap(`${L("Left pad")} holds Space and slides left`, "");
      await sleep(400);
      let x = start.x;
      for (let i = 0; i < 80 && (await s.page.evaluate(() => window.__vt.caret())) > 5; i++) {
        x -= 4;
        await s.padAt("L", x, start.y);
        await sleep(45);
      }
      await sleep(700);
      await s.release("L");
      await s.idle("L");
      await settle(s.page);
      await s.cap("Let go, then type the missing letter", `${R("Right pad")} taps <kbd>o</kbd>`);
      await sleep(700);
      await s.tap("o", "R", { gap: 0, move: 400 });
      await s.cap("<kbd>yu</kbd> → <kbd>you</kbd>", "");
      await sleep(600);
    },
    { tail: 1800 },
  );
  await expect(s.page, "cursor", "see you soon");
  await s.browser.close();
}

if (want("pads")) {
  const s = await boot({ panel: false });
  await s.page.evaluate(() => {
    const G = window.__oskModes.geometry;
    const map = window.__vtDrive.map();
    const best = new Map();
    for (const e of document.querySelectorAll("[data-key]")) {
      const k = e.getAttribute("data-key");
      const q = e.getBoundingClientRect();
      if ((/^OSK/.test(k) && !/^OSKSug_/.test(k)) || !q.width) continue;
      const a = q.width * q.height;
      if (!best.has(k) || best.get(k)[1] < a) best.set(k, [e, a]);
    }
    const keys = [...best.values()].map(([e]) => e);
    const SZ = 300,
      PAD = G.PAD_MM;
    const col = { L: "26,159,255", R: "255,170,60" };
    const label = (e) => {
      const k = e.getAttribute("data-key");
      if (k.length === 1 && k !== " ") return k;
      if (/^OSKSug_/.test(k)) return "suggestion";
      const names = {
        " ": "space",
        Control: "Ctrl",
        Alt: "Alt",
        Backspace: "⌫",
        Enter: "⏎",
        Escape: "Esc",
        Shift: "⇧",
        CapsLock: "Caps",
        Tab: "Tab",
        SwitchKeys_Steam: "☺⚙",
        SwitchKeys_Layout: "🌐",
        ArrowLeft: "←",
        ArrowRight: "→",
        VKPaste: "Paste",
        VKClose: "hide",
      };
      return names[k] ?? "";
    };
    const wrap = document.createElement("div");
    wrap.id = "vt-pads";
    wrap.style.cssText = `position:fixed;inset:0;z-index:50;background:#14181e;display:flex;gap:46px;align-items:center;justify-content:center;font:13px "Motiva Sans",Arial,sans-serif;color:#e6ecf2`;
    for (const side of ["L", "R"]) {
      const box = document.createElement("div");
      box.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:10px";
      const t = document.createElement("div");
      t.textContent = side === "L" ? "Left pad" : "Right pad";
      t.style.cssText = `font-weight:600;font-size:16px;color:rgb(${col[side]})`;
      const pad = document.createElement("div");
      pad.style.cssText = `position:relative;width:${SZ}px;height:${SZ}px;border-radius:22px;background:#0d1015;border:2px solid rgb(${col[side]});overflow:hidden`;
      for (const e of keys) {
        const q = e.getBoundingClientRect();
        const [ax, ay] = G.toPad(map, side, q.left + 1, q.top + 1);
        const [bx, by] = G.toPad(map, side, q.right - 1, q.bottom - 1);
        const x0 = Math.max(0, Math.min(ax, bx)),
          x1 = Math.min(PAD, Math.max(ax, bx)),
          y0 = Math.max(0, Math.min(ay, by)),
          y1 = Math.min(PAD, Math.max(ay, by));
        if (x1 - x0 < 0.3 || y1 - y0 < 0.3) continue;
        const k = document.createElement("div");
        const letter = /^[a-z]$/.test(e.getAttribute("data-key"));
        k.style.cssText = `position:absolute;box-sizing:border-box;left:${(x0 / PAD) * SZ}px;top:${(y0 / PAD) * SZ}px;width:${((x1 - x0) / PAD) * SZ}px;height:${((y1 - y0) / PAD) * SZ}px;border:1px solid rgba(${col[side]},.55);background:rgba(${col[side]},${letter ? 0.22 : 0.07});display:flex;align-items:center;justify-content:center;font-size:${letter ? 17 : 11}px;font-weight:${letter ? 600 : 400};color:${letter ? "#fff" : "#9aa6b4"}`;
        k.textContent = label(e);
        pad.appendChild(k);
      }
      box.append(t, pad);
      wrap.appendChild(box);
    }
    document.body.appendChild(wrap);
  });
  await sleep(200);
  await still(s.page, "pads.png", { x: 60, y: 70, width: W - 120, height: 400 });
  await s.browser.close();
}

if (want("settings")) {
  const s = await boot({ panel: false });
  await s.page.evaluate(() => window.__oskTrackpadFix.openSettings());
  await sleep(300);
  await settle(s.page);
  const top = await s.page.evaluate(() => {
    const r = document.querySelector(".osk-set")?.getBoundingClientRect();
    return r ? r.top : 250;
  });
  await still(s.page, "settings.png", {
    x: 0,
    y: Math.max(0, Math.round(top - 8)),
    width: W,
    height: Math.round(SCREEN_H - Math.max(0, top - 8)),
  });
  await s.browser.close();
}

if (!keepTmp) fs.rmSync(tmp, { recursive: true, force: true });
console.log(out);
