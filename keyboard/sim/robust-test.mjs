import path from "node:path";
import puppeteer from "puppeteer-core";
import { openSim, inject, settle, waitKeyboard } from "./run.mjs";
import { readRuntime as read } from "../runtime.mjs";
import { makeCheck, pageHelpers, sleep } from "./helpers.mjs";

const shots = process.env.SHOTS;
const PRELUDE = ["swipe/words.js", "swipe/lm.js", "swipe/engine.js", ...(process.env.WITH_MODES === "0" ? [] : ["modes.js"])]
  .map(read)
  .join("\n;\n");
const PATCH = read("patch.js");

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
let failures = 0;
const results = [];
const check = makeCheck(
  (line) => results.push(line),
  () => failures++,
);

async function fresh({ before } = {}) {
  const sim = await openSim({ browser });
  await sim.page.evaluate(PRELUDE);
  await sim.page.evaluate(() => {
    window.__oskUserWords = null;
    window.localStorage.clear();
    window.__oskInstall = { date: "2026-10-23" };
  });
  if (before) await sim.page.evaluate(before);
  const status = await inject(sim.page, PATCH);

  return { ...sim, status };
}

function helpers(page) {
  const { kbEval, center, vgp, padAt, padIdle } = pageHelpers(page);
  const BTN = { L: 20, R: 22 };
  const padTapAt = async (side, x, y, hold = 20) => {
    await padAt(side, x, y);
    await vgp("vgp_onbuttondown", BTN[side]);
    await sleep(hold);
    await vgp("vgp_onbuttonup", BTN[side]);
    await padIdle(side);
    await sleep(30);
  };
  const padTap = async (side, key, dx = 0, dy = 0) => {
    const c = await center(key);
    await padTapAt(side, c.x + dx, c.y + dy);
  };
  const padStroke = async (side, letters, tail = 0) => {
    const pts = [];
    for (const ch of letters) pts.push(await center(ch));
    if (tail) {
      const a = pts[pts.length - 2],
        b = pts[pts.length - 1];
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      pts.push({ x: b.x + ((b.x - a.x) / l) * tail * 60, y: b.y + ((b.y - a.y) / l) * tail * 60 });
    }
    await padAt(side, pts[0].x, pts[0].y);
    await vgp("vgp_onbuttondown", BTN[side]);
    for (let i = 1; i < pts.length; i++)
      for (let s = 1; s <= 6; s++) {
        await padAt(side, pts[i - 1].x + ((pts[i].x - pts[i - 1].x) * s) / 6, pts[i - 1].y + ((pts[i].y - pts[i - 1].y) * s) / 6);
        await sleep(8);
      }
    await vgp("vgp_onbuttonup", BTN[side]);
    await padIdle(side);
    await settle(page);
  };
  const touch = (type, x, y) =>
    page.evaluate(
      async (type, x, y) => {
        for (let i = 0; type === "touchstart" && i < 20; i++) {
          window.__tt = document.elementFromPoint(x, y);
          if (window.__tt) break;
          window.__ttMiss = (window.__ttMiss ?? 0) + 1;
          await new Promise((r) => setTimeout(r, 25));
        }
        const t = new Touch({ identifier: 5, target: window.__tt, clientX: x, clientY: y });
        window.__tt.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            touches: type === "touchend" ? [] : [t],
            targetTouches: type === "touchend" ? [] : [t],
            changedTouches: [t],
          }),
        );
      },
      type,
      x,
      y,
    );
  const text = async () =>
    (await page.evaluate(() => window.__keyLog.filter(([, k]) => k === "text").map(([, , v]) => v)))
      .map((v) => (v === "\u0002" ? "⌫" : v === "\u0001" ? "⏎" : v))
      .join("");
  const clear = () =>
    page.evaluate(() => {
      window.__keyLog.length = 0;
    });
  const F = (fn, ...a) => page.evaluate(fn, ...a);
  return { kbEval, center, vgp, padAt, padIdle, padTap, padTapAt, padStroke, touch, text, clear, F };
}

async function mainBlock() {
  const { page, errors, status } = await fresh();
  const h = helpers(page);
  check(/^v31 layouts=\d+ keyboard=patched/.test(status) || /^v31 layouts=\d+ keyboard=waiting/.test(status), "patch loads", status);

  await h.F(() => {
    const eng = window.__oskEngine;
    window.__calls = [];
    for (const name of ["suggest", "correct"]) {
      const orig = eng[name];
      if (typeof orig !== "function") continue;
      eng[name] = function (buf, ctx, ...rest) {
        window.__calls.push([name, buf, ctx?.taps ?? null]);
        return orig.call(this, buf, ctx, ...rest);
      };
    }
  });
  await h.padTap("R", " ");
  await h.F(() => {
    window.__calls.length = 0;
  });
  await h.padTap("L", "t", 6, -3);
  await h.padTap("R", "h");
  const tc = await h.center("e");
  await h.touch("touchstart", tc.x - 4, tc.y + 2);
  await h.touch("touchend", tc.x - 4, tc.y + 2);
  await sleep(80);
  const calls = await h.F(() => window.__calls.filter((c) => c[1] === "the"));
  const taps = calls.find((c) => c[0] === "suggest")?.[2] ?? calls[0]?.[2];
  const t0 = await h.center("t");
  check(
    Array.isArray(taps) &&
      taps.length === 3 &&
      Math.abs(taps[0].x - (t0.x + 6)) < 1.5 &&
      Math.abs(taps[0].y - (t0.y - 3)) < 1.5 &&
      taps[1] &&
      Math.abs(taps[2].x - (tc.x - 4)) < 1.5,
    "suggest/correct get ctx.taps aligned with the buffer (pad, pad, touch)",
    { calls: calls.map((c) => c[0]), taps },
  );

  await h.F(() => {
    window.__oskTrackpadFix.setSetting("typingLog", true);
  });
  await h.padTap("R", " ");
  await settle(page);
  for (const k of "teh") await h.padTap("R", k);
  await h.padTap("R", " ");
  await h.padTap("R", "Backspace");
  await h.padTap("R", " ");
  for (const k of "lpl") await h.padTap("R", k);
  await h.padTap("L", "OSKSug_1");
  await h.padStroke("R", "pol", 1.5);
  await h.padTap("R", "Backspace");
  for (const k of "pool") await h.padTap("R", k);
  await h.padTap("R", " ");
  for (const k of "secret") await h.padTap("R", k);
  await h.padTap("R", "Enter");
  await h.F(() => window.__oskTrackpadFix.flushLog());
  const log = JSON.parse((await h.F(() => window.__oskTrackpadFix.takeTypingLog())) ?? '{"lines":[]}');
  const recs = log.lines.map((l) => JSON.parse(l));
  const words = recs
    .filter((r) => r.type === "word")
    .map((r) => `${r.kind}:${r.typed ?? ""}>${r.committed}:${r.outcome}${r.next ? `>${r.next}` : ""}`);
  const env = recs.find((r) => r.type === "env");
  const geo = recs.find((r) => r.type === "geo");
  check(
    words.includes("tap:the>the:kept") &&
      words.includes("tap:teh>the:autocorrect-undone") &&
      words.some((w) => w.startsWith("tap:lpl>lol:picked")) &&
      words.some((w) => /^swipe:>\w+:deleted>pool$/.test(w)) &&
      words.includes("tap:pool>pool:kept") &&
      !words.some((w) => /secret/.test(w)),
    "typing log: kept, autocorrect undone, picked, swipe deleted with the next word, Enter-ended word not logged",
    words,
  );
  const tapRec = recs.find((r) => r.type === "word" && r.kind === "tap" && r.committed === "pool");
  const swipeRec = recs.find((r) => r.kind === "swipe");
  check(
    env?.versions?.keyboard === 31 &&
      env.versions.engine > 0 &&
      env.versions.installed === "2026-10-23" &&
      env.settings?.mode &&
      geo?.keys?.a?.length === 4 &&
      tapRec?.taps?.length === 4 &&
      tapRec.taps.every((t) => typeof t.x === "number") &&
      swipeRec?.trace?.length > 5 &&
      swipeRec.top?.length > 0,
    "log has versions, settings, key geometry, tap positions, swipe trace and candidates",
    {
      env,
      geo: geo && Object.keys(geo.keys).length,
      tapTaps: tapRec?.taps?.length,
      trace: swipeRec?.trace?.length,
      top: swipeRec?.top?.slice(0, 2),
    },
  );
  const again = await h.F(() => window.__oskTrackpadFix.takeTypingLog());
  await h.F((u) => window.__oskTrackpadFix.ackTypingLog(u), log.upTo);
  const afterAck = await h.F(() => window.__oskTrackpadFix.takeTypingLog());
  check(again !== null && afterAck === null, "typing log stays pending until acknowledged");

  await h.F(() => window.__oskTrackpadFix.setSetting("privateMode", true));
  await settle(page);
  const echo = await h.F(() => document.querySelector(".osk-echo")?.textContent ?? null);
  await h.padTap("R", " ");
  for (const k of "teh") await h.padTap("R", k);
  await h.clear();
  await h.padTap("R", " ");
  await settle(page);
  for (const k of "zogwash") await h.padTap("R", k);
  await h.padTap("R", " ");
  for (const k of "zogwash") await h.padTap("R", k);
  await h.padTap("R", " ");
  await h.F(() => window.__oskTrackpadFix.flushLog());
  const priv = {
    sent: await h.text(),
    learned: await h.F(() => window.__oskEngine.known("zogwash")),
    log: await h.F(() => window.__oskTrackpadFix.takeTypingLog()),
    echo,
  };
  check(
    priv.sent.startsWith(" ") &&
      !priv.sent.includes("the") &&
      priv.learned === false &&
      priv.log === null &&
      /Private mode/.test(priv.echo ?? ""),
    "private mode: no autocorrect, no learning, no log, echo shows Private mode",
    priv,
  );

  const er = await h.F(() => {
    const r = document.querySelector(".osk-echo.row")?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  });
  const hold = async (ms) => {
    await h.touch("touchstart", er.x, er.y);
    await sleep(ms);
    await h.touch("touchend", er.x, er.y);
    return h.F(() => window.__oskTrackpadFix.settings.privateMode);
  };
  const off = await hold(620);
  await h.clear();
  const on = await hold(620);
  const short = await hold(60);
  const typed = await h.text();
  check(
    off === false && on === true && short === true && typed === "",
    "touch hold on the typed-text field toggles private mode (off, then on), a short touch does nothing and types nothing",
    { off, on, short, typed },
  );
  await h.F(() => window.__oskTrackpadFix.setSetting("privateMode", false));

  await h.F(() => window.__oskTrackpadFix.openSettings());
  await settle(page);
  await h.padTap("R", "OSKSet_tab_system");
  const vline = await h.F(() => document.querySelector(".osk-set-version")?.textContent);
  const toggles = await h.F(() =>
    ["privateMode", "typingLog"]
      .map((k) => !!document.querySelector(`[data-key="OSKSet_t_${k}"]`))
      .concat(!!document.querySelector('[data-key="OSKSet_clear_log"]')),
  );
  if (shots) await page.screenshot({ path: path.join(shots, "panel-v31.png") });
  check(
    /^VaporType v31 · engine v\d+ · words v\d+ · pairs v\d+ · modes v\d+ · installed 2026-10-23$/.test(vline ?? "") &&
      toggles.every(Boolean),
    "settings panel: version line, private mode and typing log switches, clear log button",
    { vline, toggles },
  );
  await h.padTap("R", "OSKSet_clear_log");
  await h.F(() => window.__oskTrackpadFix.closeSettings());
  const req1 = await h.F(() => window.__oskTrackpadFix.takeRequests());
  await h.F(() => {
    window.__oskTrackpadFix.swipeLog.push({ x: 1 });
    window.__oskTrackpadFix.forgetAll();
  });
  const req2 = await h.F(() => window.__oskTrackpadFix.takeRequests());
  const swipeLogLen = await h.F(() => window.__oskTrackpadFix.swipeLog.length);
  check(
    JSON.parse(req1 ?? "{}").clearLog === true &&
      JSON.parse(req2 ?? "{}").clearLog === true &&
      JSON.parse(req2).removeBackup === true &&
      swipeLogLen === 0,
    "Clear typing log and forgetAll ask inject.mjs to delete files; forgetAll clears the swipe log",
    { req1, req2, swipeLogLen },
  );

  await h.clear();
  const atHide = await h.F(
    () =>
      new Promise((res) => {
        const sent = () => window.__keyLog.filter(([, k]) => k === "text").length;
        const origPush = window.__keyLog.push;
        window.__keyLog.push = function (...items) {
          const r = origPush.apply(this, items);
          if (items.some(([, k]) => k === "text") && this.push !== origPush) {
            this.push = origPush;
            queueMicrotask(() => {
              window.__sim.vkm.SetVirtualKeyboardHidden();
              window.__oskTrackpadFix.tickNow();
              res(sent());
            });
          }
          return r;
        };
        window.__oskTrackpadFix.typeText("abcdefghijklmnopqrstuvwxyz");
      }),
  );
  await sleep(400);
  const closed = (await h.text()).length;
  await h.F(() => window.__sim.vkm.SetVirtualKeyboardVisible());
  await waitKeyboard(page);
  check(atHide === 1 && closed === 1, "closing the keyboard drops queued output", `sent ${closed} of 26 (hidden after ${atHide})`);

  await h.clear();
  await h.padTap("L", "Control");
  await h.padTap("L", "Control");
  await settle(page);
  await h.F(() => window.__oskTrackpadFix.typeText("abcdefghijklmnopqrstuvwxyz"));
  await sleep(50);
  const desc0 = await h.kbEval((kb) => typeof Object.getOwnPropertyDescriptor(kb.m_rightTrackpad, "x")?.get);
  await h.F(() => window.__oskTrackpadFix.stop());
  const n0 = (await h.text()).length;
  await sleep(150);
  const n1 = (await h.text()).length;
  const keyEvents = await h.F(() => window.__keyLog.filter(([, k]) => k !== "text").map(([, k, v]) => `${k}${v}`));
  const after = await h.kbEval((kb) => {
    const d = Object.getOwnPropertyDescriptor(kb.m_rightTrackpad, "x");
    kb.m_rightTrackpad.x = 123;
    return { get: typeof d?.get, value: kb.m_rightTrackpad.x, clampFlag: "__oskClamp" in kb.m_rightTrackpad };
  });
  const keys = await h.F(() => [...document.querySelectorAll("[data-key]")].map((e) => e.getAttribute("data-key")));
  check(
    desc0 === "function" &&
      n1 === n0 &&
      after.get === "undefined" &&
      after.value === 123 &&
      !after.clampFlag &&
      keyEvents[keyEvents.length - 1] === "up103" &&
      !keys.includes("Escape"),
    "stop(): queued output cancelled, pad x/y back to plain properties, Ctrl released last, stock keyboard",
    { n0, n1, after, keyEvents, desc0 },
  );
  const errs = errors.filter(
    (e) =>
      !/404|Transport|passive event listener|cancel a touchend|activeOutputDeviceId|AddOnDisconnectCallback|PushState|PopState/.test(e),
  );
  check(errs.length === 0, "no page errors", errs.slice(0, 3));
  await page.close();
}

async function missingMethod() {
  const { page } = await fresh({ before: "window.__ok = 1" });
  await page.evaluate(() => window.__oskTrackpadFix.stop());
  await page.evaluate(() => {
    const key = document.querySelector("[data-key]");
    const fk = Object.keys(key).find((k) => k.startsWith("__reactFiber"));
    for (let f = key[fk]; f; f = f.return)
      if (typeof f.stateNode?.HandleTrackpadClick === "function") {
        const p = Object.getPrototypeOf(f.stateNode);
        delete p.TypeKeyInternal;
        break;
      }
    window.__oskTrackpadFix = null;
  });
  const st = await inject(page, PATCH);

  const st2 = await page.evaluate(() => window.__oskTrackpadFix.status());
  const keys = await page.$$eval("[data-key]", (els) => els.map((e) => e.getAttribute("data-key")));
  const wrapped = await page.evaluate(() => {
    const key = document.querySelector("[data-key]");
    const fk = Object.keys(key).find((k) => k.startsWith("__reactFiber"));
    for (let f = key[fk]; f; f = f.return)
      if (typeof f.stateNode?.HandleTrackpadClick === "function") return !!Object.getPrototypeOf(f.stateNode).TypeKeyInternal?.__oskVersion;
  });
  const again = await page.evaluate(PATCH);
  check(
    /unsupported Steam build: keyboard TypeKeyInternal/.test(st2) && !keys.includes("Escape") && !wrapped && again === st2,
    "preflight: a missing keyboard method leaves Steam stock and reports it (re-inject does not retry)",
    { st, st2, wrapped },
  );
  await page.close();
}

async function missingInput() {
  const { page } = await fresh({ before: "window.__realInput = SteamClient.Input; 0" });
  await page.evaluate(() => {
    window.__oskTrackpadFix.stop();
    window.__oskTrackpadFix = null;
  });
  const st = await page.evaluate((src) => {
    const I = window.SteamClient.Input;
    const keep = I.ControllerKeyboardSetKeyState;
    window.SteamClient = new Proxy(window.SteamClient, {
      get: (t, p) => (p === "Input" ? new Proxy(I, { get: (a, q) => (q === "ControllerKeyboardSetKeyState" ? undefined : a[q]) }) : t[p]),
    });
    const r = (0, eval)(src);
    window.__keep = keep;
    return r;
  }, PATCH);
  await page.waitForFunction(() => /unsupported/.test(window.__oskTrackpadFix?.status?.() ?? ""), { timeout: 5000, polling: 20 });
  const st2 = await page.evaluate(() => window.__oskTrackpadFix.status());
  const keys = await page.$$eval("[data-key]", (els) => els.map((e) => e.getAttribute("data-key")));
  check(
    /unsupported Steam build: SteamClient.Input.ControllerKeyboardSetKeyState/.test(st2) && !keys.includes("Escape"),
    "preflight: a missing SteamClient.Input call patches nothing",
    { st, st2 },
  );
  await page.close();
}

async function throwingStep() {
  const { page } = await fresh();
  await page.evaluate(() => {
    window.__oskTrackpadFix.stop();
    window.__oskTrackpadFix = null;
  });
  await page.evaluate(() => {
    const key = document.querySelector("[data-key]");
    const fk = Object.keys(key).find((k) => k.startsWith("__reactFiber"));
    for (let f = key[fk]; f; f = f.return)
      if (typeof f.stateNode?.HandleTrackpadClick === "function") {
        Object.defineProperty(f.stateNode, "m_leftTrackpad", {
          get() {
            return window.__trapOn
              ? (() => {
                  throw new Error("boom");
                })()
              : this.__lt;
          },
          set(v) {
            this.__lt = v;
          },
          configurable: true,
        });
        f.stateNode.__lt = f.stateNode.__lt ?? { x: 0, y: 0 };
        break;
      }
  });
  await page.evaluate(() => {
    const key = document.querySelector("[data-key]");
    const fk = Object.keys(key).find((k) => k.startsWith("__reactFiber"));
    for (let f = key[fk]; f; f = f.return)
      if (typeof f.stateNode?.HandleTrackpadClick === "function") {
        const kb = f.stateNode;
        window.__trapCount = 0;
        Object.defineProperty(kb, "m_rightTrackpad", {
          get() {
            if (/tickPatched/.test(new Error().stack.split("\n")[2]) && ++window.__trapCount > 3) throw new Error("boom");
            return this.__rt ?? (this.__rt = { x: 0, y: 0 });
          },
          set(v) {
            this.__rt = v;
          },
          configurable: true,
        });
        break;
      }
  });
  await inject(page, PATCH);
  await page.waitForFunction(() => /unsupported/.test(window.__oskTrackpadFix.status()), { timeout: 5000, polling: 50 }).catch(() => {});

  const st = await page.evaluate(() => window.__oskTrackpadFix.status());
  const keys = await page.$$eval("[data-key]", (els) => els.map((e) => e.getAttribute("data-key")));
  const wrapped = await page.evaluate(() => {
    const key = document.querySelector("[data-key]");
    const fk = Object.keys(key).find((k) => k.startsWith("__reactFiber"));
    for (let f = key[fk]; f; f = f.return)
      if (typeof f.stateNode?.HandleTrackpadClick === "function") return !!Object.getPrototypeOf(f.stateNode).TypeKeyInternal.__oskVersion;
  });
  check(
    /unsupported Steam build: patch failed: boom/.test(st) && !keys.includes("Escape") && !wrapped,
    "a step that throws during patching rolls back to stock",
    { st, wrapped },
  );
  await page.close();
}

await Promise.all([mainBlock(), missingMethod(), missingInput(), throwingStep()]);

console.log(results.join("\n"));
console.log(failures ? `${failures} FAILED` : "ALL PASS");
await browser.close();
process.exit(failures ? 1 : 0);
