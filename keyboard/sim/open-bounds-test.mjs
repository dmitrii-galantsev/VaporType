import fs from "node:fs";
import { openSim, inject, settle } from "./run.mjs";
import { readRuntime as read } from "../runtime.mjs";
import { sleep } from "./helpers.mjs";

const patchSrc = process.env.PATCH_SRC ? fs.readFileSync(process.env.PATCH_SRC, "utf8") : read("patch.js");
const modesSrc = process.env.MODES_SRC ? fs.readFileSync(process.env.MODES_SRC, "utf8") : read("modes.js");
const prelude = ["swipe/words.js", "swipe/lm.js", "swipe/engine.js"].map(read).join("\n;\n") + "\n;\n" + modesSrc;
const { browser, page, errors } = await openSim();
let failures = 0;
const results = [];
const check = (ok, title, detail = "") => {
  if (!ok) failures++;
  results.push(`${ok ? "PASS" : "FAIL"} ${title}${detail ? `\n      ${detail}` : ""}`);
};

const HELPERS = () => {
  const pe = (window.__pe = {
    kb() {
      const key = document.querySelector("[data-key]");
      const fk = Object.keys(key).find((k) => k.startsWith("__reactFiber"));
      for (let f = key[fk]; f; f = f.return) if (typeof f.stateNode?.HandleTrackpadClick === "function") return f.stateNode;
      return null;
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
    aim() {
      const row = {
        L: ["q", "a", "z", "w", "s", "x", "e", "d", "c", "r", "f", "v"],
        R: ["u", "j", "m", "i", "k", "o", "l", "p", "h", "n"],
      };
      pe.targets = {};
      for (const side of ["L", "R"])
        pe.targets[side] = row[side].map((c) => [c, pe.rawOf(side, c)]).filter(([, [u, v]]) => Math.abs(u) <= 1 && Math.abs(v) <= 1);
    },
    async run(ms) {
      const out = [];
      const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      window.__sim.vkm.SetVirtualKeyboardVisible();
      const t0 = performance.now();
      let i = 0;
      while (performance.now() - t0 < ms) {
        await new Promise((r) => setTimeout(r, 30));
        const kb = pe.kb();
        if (!kb?.m_trackpadInput) continue;
        const sides = ["L", "R"].filter((s) => pe.targets[s].length);
        const picks = sides.map((side) => {
          const list = pe.targets[side];
          const [ch, [u, v]] = list[i % list.length];
          return { side, ch, u, v };
        });
        i++;
        const top0 = Math.round(document.querySelector('[data-key=" "]')?.getBoundingClientRect().top ?? -1);
        const d = (p) => kb.m_trackpadInput.m_AnalogCallbacks.Dispatch(p.side === "L" ? 19 : 21, 0, p.u, p.v);
        for (const p of picks) d(p);
        await frame();
        for (const p of picks) d(p);
        const top = Math.round(document.querySelector('[data-key=" "]')?.getBoundingClientRect().top ?? -1);
        for (const p of picks) {
          const pad = p.side === "L" ? kb.m_leftTrackpad : kb.m_rightTrackpad;
          let hit = null;
          try {
            hit = kb.getElementFromPointWorkaround(pad.x, pad.y, p.side === "L" ? 20 : 22)?.getAttribute?.("data-key");
          } catch (e) {}
          out.push({ t: Math.round(performance.now() - t0), side: p.side, want: p.ch, hit, top, still: top0 === top });
        }
      }
      return out;
    },
  });
};

async function boot(stock) {
  const { page: pg } = stock ? await openSim({ browser }) : { page };
  await pg.evaluate(prelude);
  await pg.evaluate(() => {
    window.__oskUserWords = null;
    localStorage.clear();
  });
  if (stock) {
    await pg.evaluate(() => {
      localStorage.setItem("oskSwipeSettings", JSON.stringify({ consent: true, tipShown: true }));
      window.__oskTrackpadFix = {
        tickNow() {},
        settings: { mode: "standard" },
        modeApi: { spans: () => ({ L: 0.55, R: 0.55, aspect: 2 }) },
      };
    });
  } else await inject(pg, patchSrc);
  await pg.evaluate(HELPERS);
  return pg;
}

const trial = async (pg, cfg) => {
  if (cfg) {
    await pg.evaluate((cfg) => {
      for (const [k, v] of Object.entries({ mode: "standard", reach: 55, oneAspect: 2, deadzone: 100, ...cfg }))
        window.__oskTrackpadFix.setSetting(k, v);
    }, cfg);
    await settle(pg);
  }
  await pg.evaluate(() => window.__pe.aim());
  await pg.evaluate(() => {
    window.__sim.vkm.SetVirtualKeyboardHidden();
    window.__oskTrackpadFix?.tickNow?.();
  });
  await sleep(300);
  return pg.evaluate(() => window.__pe.run(1000));
};

const analyse = (res) => {
  const final = res[res.length - 1].top;
  let settledAt = res[0].t;
  for (let i = 0; i < res.length; i++) if (res[i].top !== final || !res[i].still) settledAt = res[i].t;
  if (process.env.DUMP) console.log(JSON.stringify(res.map((r) => [r.t, r.side, r.want, r.hit, r.top])));
  const wrong = res.filter((r) => r.hit !== r.want);
  const after = wrong.filter((r) => r.t > settledAt);
  return { settledAt, wrong, after, last: wrong.length ? wrong[wrong.length - 1].t : 0, n: res.length };
};

const stockPage = await boot(true);
await page.bringToFront();
await boot(false);
await page.evaluate(() => window.__oskTrackpadFix.tickNow());
await settle(page);
const CONFIGS = [
  ["Standard", { mode: "standard" }],
  ["Big letter keys", { mode: "bigkeys" }],
  ["Standard reach 75", { mode: "standard", reach: 75 }],
  ["Big letter keys reach 100", { mode: "bigkeys", reach: 100 }],
  ["Big letter keys right pad only 2:1", { mode: "bigkeys", reach: "right" }],
  ["Standard right pad only 3:1", { mode: "standard", reach: "right", oneAspect: 3 }],
];
for (const [name, cfg] of CONFIGS) {
  await stockPage.bringToFront();
  const stock = analyse(await trial(stockPage, null));
  const stockLast = stock.last;
  await page.bringToFront();
  const a = analyse(await trial(page, cfg));
  check(
    a.settledAt > 0 && a.n > 40,
    `${name}: the sim keyboard slides in and the probe sampled it`,
    `${a.n} samples, space bar stopped at ${a.settledAt} ms`,
  );
  check(
    !a.after.length,
    `${name}: after the keyboard stops moving every pad press lands on the aimed key`,
    `${a.after.length} wrong of ${a.n} after ${a.settledAt} ms: ${a.after
      .slice(0, 6)
      .map((r) => `${r.t}ms ${r.side} ${r.want}->${r.hit}`)
      .join(", ")}`,
  );
  check(
    a.last <= stockLast + 50,
    `${name}: the last wrong press is no later than stock Steam's (${stockLast} ms) + 50 ms`,
    `${a.wrong.length} wrong of ${a.n}, last at ${a.last} ms; stock ${stock.wrong.length} wrong of ${stock.n}`,
  );
}

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
