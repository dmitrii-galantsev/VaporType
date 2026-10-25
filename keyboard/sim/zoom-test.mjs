import path from "node:path";
import { openSim, inject, settle } from "./run.mjs";
import { readRuntime as read } from "../runtime.mjs";
import { pageHelpers, sleep } from "./helpers.mjs";

const shots = process.env.SHOTS;
const ZOOM = 1.5;
const PASSES = [
  ["legacy zoom", ["--disable-blink-features=StandardizedBrowserZoom"], true],
  ["standard zoom", [], false],
];

let failures = 0;
const results = [];

for (const [name, args, legacy] of PASSES) {
  const { browser, page, errors } = await openSim({ width: 1280, height: 720, scale: 1, args });
  await page.evaluate((z) => {
    const root = document.getElementById("root");
    root.classList.add("BasicUI", "GamepadMode");
    root.style.zoom = String(z);
  }, ZOOM);
  if (legacy) await page.evaluate(() => (window.__sim.req(5757).oy.WindowStore.BHasStandaloneKeyboard = () => true));
  await page.evaluate(async () => {
    let last = "",
      same = 0;
    for (let i = 0; i < 200 && same < 4; i++) {
      await new Promise((r) => setTimeout(r, 25));
      const r = document.querySelector('[data-key="a"]')?.getBoundingClientRect();
      const k = r ? `${r.left},${r.top},${r.width}` : "";
      same = k && k === last ? same + 1 : 0;
      last = k;
    }
  });
  await page.evaluate(["swipe/words.js", "swipe/lm.js", "swipe/engine.js", "modes.js"].map(read).join("\n;\n"));
  await page.evaluate(() => {
    window.__oskUserWords = null;
    window.localStorage.clear();
    localStorage.setItem("oskSwipeSettings", JSON.stringify({ consent: true, tipShown: true }));
  });
  results.push(`${name}: inject: ${await inject(page, read("patch.js"))}`);

  const scale = await page.evaluate(() => innerWidth / document.getElementById("root").getBoundingClientRect().width);
  const geo = await page.evaluate((scale) => {
    const out = {};
    for (const el of document.querySelectorAll("[data-key]")) {
      const k = el.getAttribute("data-key");
      const r = el.getBoundingClientRect();
      if (r.width > 0 && !(k in out))
        out[k] = {
          rx: r.left + r.width / 2,
          ry: r.top + r.height / 2,
          x: (r.left + r.width / 2) * scale,
          y: (r.top + r.height / 2) * scale,
        };
    }
    return out;
  }, scale);
  const kbBox = await page.evaluate((scale) => {
    const els = [...document.querySelectorAll("[data-key]")].map((e) => e.getBoundingClientRect()).filter((r) => r.width);
    const l = Math.min(...els.map((r) => r.left)),
      t = Math.min(...els.map((r) => r.top)),
      r = Math.max(...els.map((r) => r.right)),
      b = Math.max(...els.map((r) => r.bottom));
    return { l: l * scale, t: t * scale, r: r * scale, b: b * scale };
  }, scale);
  const hitOk = await page.evaluate(
    (c) => document.elementFromPoint(c.x, c.y)?.closest("[data-key]")?.getAttribute("data-key") === "t",
    geo.t,
  );
  results.push(
    `${hitOk ? "PASS" : "FAIL"} ${name}: test geometry: rect scale ${scale.toFixed(3)}, key t on screen at ${geo.t.x.toFixed(0)},${geo.t.y.toFixed(0)}`,
  );
  if (!hitOk) failures++;

  const textOut = (log) =>
    log
      .filter(([, kind]) => kind === "text")
      .map(([, , v]) => v)
      .join("");
  async function scenario(title, fn, check) {
    await page.evaluate(() => {
      window.__keyLog.length = 0;
    });
    const e0 = errors.length;
    const detail = await fn();
    await settle(page);
    const out = textOut(await page.evaluate(() => window.__keyLog.slice()));
    const newErr = errors.filter((e, i) => i >= e0 && !/404|Failed to load|Transport|passive event listener|cancel a touchend/.test(e));
    const ok = (await check(out, detail)) && !newErr.length;
    if (!ok) failures++;
    results.push(
      `${ok ? "PASS" : "FAIL"} ${name}: ${title}\n      text ${JSON.stringify(out)}${detail ? `  ${JSON.stringify(detail)}` : ""}${newErr.length ? `\n      errors ${newErr.join(" | ")}` : ""}`,
    );
  }

  async function touchSwipe(letters) {
    const pts = [...letters].map((ch) => geo[ch]);
    return page.evaluate(async (pts) => {
      const target = document.elementFromPoint(pts[0].x, pts[0].y);
      const send = (type, p) => {
        const t = new Touch({ identifier: 1, target, clientX: p.x, clientY: p.y });
        target.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            touches: type === "touchend" ? [] : [t],
            targetTouches: type === "touchend" ? [] : [t],
            changedTouches: [t],
          }),
        );
      };
      send("touchstart", pts[0]);
      let last = pts[0],
        trail = null;
      for (let i = 1; i < pts.length; i++) {
        for (let s = 1; s <= 6; s++) {
          const f = s / 6;
          last = { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f };
          send("touchmove", last);
          await new Promise((r) => setTimeout(r, 12));
        }
      }
      await new Promise((r) => requestAnimationFrame(r));
      const c = document.getElementById("osk-swipe-trail");
      if (c) {
        const r = c.getBoundingClientRect();
        trail = { l: r.left, t: r.top, r: r.right, b: r.bottom };
      }
      send("touchend", last);
      return trail;
    }, pts);
  }

  const { kbEval, vgp } = pageHelpers(page);
  const padAt = (x, y) =>
    kbEval(
      (kb, x, y) => {
        kb.m_leftTrackpad.active = true;
        kb.m_leftTrackpad.x = x;
        kb.m_leftTrackpad.y = y;
      },
      x,
      y,
    );
  const near = (a, b, tol = 3) => !!a && Math.abs(a.l - b.l) <= tol && Math.abs(a.r - b.r) <= tol && a.t <= b.t + tol && a.b >= b.b - tol;

  await scenario(
    "touch taps land on the touched keys",
    async () => {
      for (const k of "ok") {
        await page.touchscreen.tap(geo[k].x, geo[k].y);
        await sleep(40);
      }
    },
    (o) => o === "ok",
  );
  await page.evaluate(() => window.__oskTrackpadFix.typeText(" "));
  await settle(page);
  let trailBox = null;
  await scenario(
    "touch swipe p-o-w-e-r on the top row decodes power",
    async () => {
      trailBox = await touchSwipe("power");
      return { trail: trailBox, keyboard: kbBox };
    },
    (o) => o.trim() === "power",
  );
  await scenario(
    "swipe trail canvas covers the keyboard on screen",
    async () => ({ trail: trailBox }),
    () => near(trailBox, kbBox, 40),
  );
  await scenario(
    "touch swipe typing",
    () => touchSwipe("typing"),
    (o) => o.trim() === "typing",
  );
  await scenario(
    "left trackpad swipe the",
    async () => {
      const pts = [..."the"].map((ch) => geo[ch]);
      await padAt(pts[0].rx, pts[0].ry);
      await vgp("vgp_onbuttondown", 20);
      for (let i = 1; i < pts.length; i++)
        for (let s = 1; s <= 6; s++) {
          const f = s / 6;
          await padAt(pts[i - 1].rx + (pts[i].rx - pts[i - 1].rx) * f, pts[i - 1].ry + (pts[i].ry - pts[i - 1].ry) * f);
          await sleep(8);
        }
      await vgp("vgp_onbuttonup", 20);
      await kbEval((kb) => {
        kb.m_leftTrackpad.active = false;
      });
    },
    (o) => o.trim() === "the",
  );
  await scenario(
    "mode overlay canvas sits on the keyboard on screen",
    () =>
      page.evaluate(() => {
        const c = document.getElementById("osk-mode-overlay");
        if (!c || c.style.display === "none") return null;
        const r = c.getBoundingClientRect();
        return { l: r.left, t: r.top, r: r.right, b: r.bottom };
      }),
    (o, box) => box === null || near(box, kbBox, 40),
  );
  await scenario(
    "settings panel spans the keyboard on screen",
    async () => {
      await page.evaluate(() => window.__oskTrackpadFix.openSettings());
      await settle(page);
      if (shots) await page.screenshot({ path: path.join(shots, `zoom-${name.split(" ")[0]}-panel.png`) });
      const probes = [
        [kbBox.l + 6, (kbBox.t + kbBox.b) / 2],
        [kbBox.r - 6, (kbBox.t + kbBox.b) / 2],
        [(kbBox.l + kbBox.r) / 2, kbBox.t + 6],
        [(kbBox.l + kbBox.r) / 2, kbBox.b - 6],
      ];
      const hits = await page.evaluate((probes) => probes.map(([x, y]) => !!document.elementFromPoint(x, y)?.closest(".osk-set")), probes);
      const box = await page.evaluate(() => {
        const r = document.querySelector(".osk-set")?.getBoundingClientRect();
        return r ? [r.left, r.top, r.width, r.height].map(Math.round) : null;
      });
      return { hits, box };
    },
    (o, d) => d.hits.every(Boolean),
  );
  const closeAt = () =>
    page.evaluate((legacy) => {
      const el = document.querySelector('[data-key="OSKSet_close"]');
      if (!el) return null;
      let z = 1;
      for (let n = el; legacy && n; n = n.parentElement) z *= parseFloat(getComputedStyle(n).zoom) || 1;
      const r = el.getBoundingClientRect();
      return { x: (r.left + r.width / 2) * z, y: (r.top + r.height / 2) * z };
    }, legacy);
  await scenario(
    "trackpad click on the panel's close button closes it",
    async () => {
      const c = await closeAt();
      if (c) {
        await padAt(c.x / scale, c.y / scale);
        await vgp("vgp_onbuttondown", 20);
        await sleep(20);
        await vgp("vgp_onbuttonup", 20);
        await kbEval((kb) => {
          kb.m_leftTrackpad.active = false;
        });
      }
      await sleep(60);
      const open = await page.evaluate(() => !!document.querySelector(".osk-set"));
      await page.evaluate(() => window.__oskTrackpadFix.openSettings());
      await settle(page);
      return { open };
    },
    (o, d) => !d.open,
  );
  await scenario(
    "touch tap on the panel's close button closes it",
    async () => {
      const c = await closeAt();
      if (c) await page.touchscreen.tap(c.x, c.y);
      await sleep(60);
      return { open: await page.evaluate(() => !!document.querySelector(".osk-set")) };
    },
    (o, d) => !d.open,
  );
  await scenario(
    "first-run tip sits above the keyboard on screen",
    async () => {
      await page.evaluate(() => {
        window.__oskTrackpadFix.setSetting("tipShown", false);
        window.__oskTrackpadFix.tickNow();
      });
      await page.waitForSelector(".osk-toast", { timeout: 3000 }).catch(() => null);
      return page.evaluate((legacy) => {
        const el = document.querySelector(".osk-toast");
        if (!el) return null;
        let z = 1;
        for (let n = el; legacy && n; n = n.parentElement) z *= parseFloat(getComputedStyle(n).zoom) || 1;
        const r = el.getBoundingClientRect();
        return { l: r.left * z, t: r.top * z, r: r.right * z, b: r.bottom * z };
      }, legacy);
    },
    (o, box) => !!box && box.l >= kbBox.l && box.r <= kbBox.r && box.b <= kbBox.t && box.b > kbBox.t - 40,
  );
  if (shots) await page.screenshot({ path: path.join(shots, `zoom-${name.split(" ")[0]}.png`) });
  await browser.close();
}

console.log(results.join("\n"));
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
