import { openSim, inject, settle } from "./run.mjs";
import { readRuntime as read } from "../runtime.mjs";
import { lum, makeCheck, sleep } from "./helpers.mjs";

let failures = 0;
const results = [];
const check = makeCheck(
  (line) => results.push(line),
  () => failures++,
);

const { browser, page, errors } = await openSim({ backdrop: true });
await page.evaluate(() => {
  window.__oskUserWords = null;
  window.localStorage.clear();
  window.localStorage.setItem("oskSwipeSettings", JSON.stringify({ consent: true, tipShown: true }));
});
await page.evaluate(["swipe/words.js", "swipe/lm.js", "swipe/engine.js"].map(read).join("\n;\n"));
results.push(`inject: ${await inject(page, read("patch.js"))}`);
await page.waitForSelector('[data-key="Escape"]');
await settle(page);

const set = async (o) => {
  const ok = await page.evaluate((o) => Object.entries(o).map(([k, v]) => window.__oskTrackpadFix.setSetting(k, v)), o);
  await settle(page);
  return ok.every(Boolean);
};
const DEFAULT_LOOK = { boardAlpha: 40, keyAlpha: 100, spaceAlpha: 30, stripAlpha: 90, blur: 0 };

const look = () =>
  page.evaluate(() => {
    const parse = (c) => {
      const m = c.match(/[\d.]+/g).map(Number);
      return [m[0], m[1], m[2], m.length > 3 ? m[3] : 1];
    };
    const keyOf = (k) =>
      [...document.querySelectorAll(`[data-key="${k}"]`)].find((e) => e.getBoundingClientRect().width > 0)?.firstElementChild;
    const space = keyOf(" ");
    const board = space.closest(".DefaultTheme");
    const label = [...space.querySelectorAll("span")].find((s) => s.textContent.trim());
    const echo = space.parentElement.querySelector(".osk-echo.space:not([hidden])");
    const slide = getComputedStyle(space.parentElement, "::after");
    let strip = document.querySelector('[data-key="OSKSug_0"]')?.parentElement;
    while (strip && !strip.getBoundingClientRect().width) strip = strip.parentElement;
    const row = document.querySelector(".osk-echo.row:not([hidden])");
    return {
      strip: strip ? parse(getComputedStyle(strip).backgroundColor) : null,
      row: row ? { color: parse(getComputedStyle(row).color), field: parse(getComputedStyle(row).backgroundColor) } : null,
      board: parse(getComputedStyle(board).backgroundColor),
      key: parse(getComputedStyle(keyOf("a")).backgroundColor),
      meta: parse(getComputedStyle(keyOf("Shift")).backgroundColor),
      space: parse(getComputedStyle(space).backgroundColor),
      label: label ? parse(getComputedStyle(label).color) : null,
      echo: echo ? parse(getComputedStyle(echo).color) : null,
      slide: slide.content !== "none" ? parse(slide.color) : null,
      blur: getComputedStyle(board).backdropFilter,
    };
  });

const over = (top, under) => top.slice(0, 3).map((c, i) => c * top[3] + under[i] * (1 - top[3]));
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return +((x + 0.05) / (y + 0.05)).toFixed(2);
};
const BACKDROPS = { black: [0, 0, 0], grey: [128, 128, 128] };
const contrast = (fg, ...layers) =>
  Math.min(
    ...Object.values(BACKDROPS).map((b) => {
      const bg = layers.reduceRight((under, top) => over(top, under), b);
      return ratio(over(fg, bg), bg);
    }),
  );
const near = (a, b) => Math.abs(a - b) < 0.006;
const MIN_CONTRAST = 4.5;

for (const theme of ["modern", "steam", "oled"]) {
  await set({ theme, ...DEFAULT_LOOK });
  const d = await look();
  check(
    d.space[3] <= 0.35 && d.key[3] - d.space[3] >= 0.5 && near(d.board[3], 0.4) && near(d.key[3], 1),
    `${theme}: at the defaults the space bar is far more see-through than the keys`,
    { board: d.board, key: d.key, space: d.space },
  );
  const label = contrast(d.label, d.space, d.board);
  check(label >= MIN_CONTRAST, `${theme}: the space-bar label stays readable at the default space alpha (>= ${MIN_CONTRAST}:1)`, {
    label: d.label,
    contrast: label,
  });
  check(near(d.strip[3], 0.9), `${theme}: the top strip defaults to 90 %`, { strip: d.strip });
  const rowText = d.row && contrast(d.row.color, d.row.field, d.strip, d.board);
  check(rowText >= MIN_CONTRAST, `${theme}: the typed-text field in the top strip stays readable at the default strip alpha`, {
    row: d.row,
    contrast: rowText,
  });
  await set({ boardAlpha: 70, keyAlpha: 55, spaceAlpha: 15, stripAlpha: 60 });
  const t = await look();
  check(
    near(t.board[3], 0.7) &&
      near(t.key[3], 0.55) &&
      near(t.space[3], 0.15) &&
      near(t.strip[3], 0.6) &&
      t.meta[3] <= t.key[3] &&
      t.meta[3] > 0.5,
    `${theme}: board, key, space-bar and top-strip alphas follow their own settings`,
    { board: t.board, key: t.key, meta: t.meta, space: t.space, strip: t.strip },
  );
  await set({ boardAlpha: 0, keyAlpha: 0, spaceAlpha: 0, stripAlpha: 0 });
  const z = await look();
  await set({ boardAlpha: 100, keyAlpha: 100, spaceAlpha: 100, stripAlpha: 100 });
  const f = await look();
  check(
    z.board[3] === 0 &&
      z.key[3] === 0 &&
      z.space[3] === 0 &&
      z.strip[3] === 0 &&
      f.board[3] === 1 &&
      f.key[3] === 1 &&
      f.space[3] === 1 &&
      f.meta[3] === 1 &&
      f.strip[3] === 1,
    `${theme}: 0 and 100 give fully clear and fully solid`,
    { zero: [z.board[3], z.key[3], z.space[3], z.strip[3]], full: [f.board[3], f.key[3], f.meta[3], f.space[3], f.strip[3]] },
  );
}

await set({ theme: "modern", ...DEFAULT_LOOK });
await page.evaluate(() => {
  const el = [...document.querySelectorAll('[data-key=" "]')].find((e) => e.getBoundingClientRect().width > 0);
  el.classList.add("osk-sliding");
});
for (const theme of ["modern", "steam", "oled"]) {
  await set({ theme });
  const s = await look();
  const c = s.slide && contrast(s.slide, s.space, s.board);
  check(c >= MIN_CONTRAST, `${theme}: the "◂ cursor ▸" text stays readable on the default space bar`, { color: s.slide, contrast: c });
}
await page.evaluate(() => document.querySelector(".osk-sliding")?.classList.remove("osk-sliding"));

await set({ theme: "modern", suggestions: false });
await page.evaluate(() => window.__oskTrackpadFix.typeText("hello"));
await settle(page);
await sleep(200);
for (const theme of ["modern", "steam", "oled"]) {
  await set({ theme });
  const e = await look();
  const c = e.echo && contrast(e.echo, e.space, e.board);
  check(
    c >= MIN_CONTRAST && near(e.space[3], 0.3),
    `${theme}: typed text echoed in the space bar stays readable, the bar keeps the space-bar alpha`,
    { echo: e.echo, space: e.space, contrast: c },
  );
}
await set({ theme: "modern", suggestions: true });

const blurs = [];
for (const b of [1, 2, 0]) {
  await set({ blur: b });
  blurs.push((await look()).blur);
}
check(
  blurs[0] === "blur(6px)" && blurs[1] === "blur(16px)" && blurs[2] === "none",
  "glass blur Light / Strong / Off on the board only",
  blurs,
);

const live = await page.evaluate(() => {
  const f = window.__oskTrackpadFix;
  const lookSheet = document.getElementById("osk-look-style");
  const before = lookSheet.textContent;
  const writes = { look: 0, vars: 0 };
  const mo = new MutationObserver((ms) => {
    for (const m of ms) {
      const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (t?.id === "osk-look-style") writes.look++;
      if (t?.id === "osk-look-vars") writes.vars++;
    }
  });
  mo.observe(document.head, { subtree: true, childList: true, characterData: true });
  const t0 = performance.now();
  let n = 0;
  for (let i = 0; i < 60; i++) if (f.setSetting("spaceAlpha", (i % 21) * 5)) n++;
  const ms = performance.now() - t0;
  mo.takeRecords().forEach((m) => {
    const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
    if (t?.id === "osk-look-style") writes.look++;
    if (t?.id === "osk-look-vars") writes.vars++;
  });
  mo.disconnect();
  f.setSetting("spaceAlpha", 30);
  return { n, ms: +ms.toFixed(2), writes, same: lookSheet.textContent === before };
});
check(
  live.n === 60 && live.writes.look === 0 && live.writes.vars === 60 && live.same,
  "60 slider changes rewrite only the small variables sheet, once per change, never the look stylesheet",
  live,
);

const idle = await page.evaluate(async () => {
  let mut = 0;
  const mo = new MutationObserver((m) => (mut += m.length));
  mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  await new Promise((r) => setTimeout(r, 1500));
  mo.disconnect();
  return mut;
});
check(idle === 0, "an idle keyboard with the new look changes no DOM", { mutations: idle });

const errs = errors.filter((e) => !/404|Transport|passive event listener|activeOutputDeviceId|AddOnDisconnectCallback/.test(e));
check(errs.length === 0, "no page errors", errs.slice(0, 3));
results.push(`status: ${await page.evaluate(() => window.__oskTrackpadFix.status())}`);
console.log(results.join("\n"));
console.log(failures ? `${failures} FAILED` : "ALL PASS");
await browser.close();
process.exit(failures ? 1 : 0);
