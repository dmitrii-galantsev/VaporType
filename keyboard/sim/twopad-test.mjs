import { openTwoPad, rest, swipePad, restAt, sent, firstSendAfter, lastUp, reset } from "./twopad.mjs";

const { browser, page, errors } = await openTwoPad();
const bootErrors = errors.length;
const cdp = await page.createCDPSession();
let failures = 0;
const check = (ok, what, detail) => {
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${what}${detail !== undefined ? `\n      ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`,
  );
};

const drive = async (pads, end, acts = []) => {
  const out = await page.evaluate((plan) => window.__tp.drive(plan), { pads, end, acts, stepped: true });
  await reset(page);
  return out;
};
const words = (out) => sent(out).trim().split(/\s+/).filter(Boolean);
const single = (out) => out.sends.every(([, x]) => [...x].length === 1);

for (const [first, second, lead] of [
  ["great", "only", "L"],
  ["join", "start", "R"],
]) {
  const sideA = lead,
    sideB = lead === "L" ? "R" : "L";
  const A = await swipePad(page, first, sideA, { segMs: 150 });
  const B = await swipePad(page, second, sideB, { segMs: 150, start: 190 });
  const out = await drive({ [sideA]: A, [sideB]: B }, Math.max(A.release, B.release) + 40);
  check(
    words(out).join(" ") === `${first} ${second}` && single(out),
    `two pressed swipes at once (${sideA} ${first}, then ${sideB} ${second}) type both words in press order`,
    sent(out),
  );
}

{
  const L = await swipePad(page, "great", "L", { segMs: 750 });
  const R = await swipePad(page, "only", "R", { segMs: 1000, start: 190 });
  const out = await drive({ L, R }, Math.max(L.release, R.release) + 40);
  const lat = firstSendAfter(out, lastUp(out));
  check(
    words(out).join(" ") === "great only" && lat < 100,
    "3 s two-pad swipes at 120 Hz: both words, first letter within 100 ms of the last release",
    {
      text: sent(out),
      ms: Math.round(lat),
    },
  );
}

for (const [name, restAfter, other] of [
  ["one pad, thumb lifted", false, false],
  ["other thumb resting on its pad", false, true],
  ["both thumbs resting", true, true],
]) {
  const lat = [];
  const got = [];
  for (const w of ["you", "only", "join"]) {
    const R = await swipePad(page, w, "R", { restAfter });
    const pads = { R };
    if (other) pads.L = restAt(await rest(page, "s", "L"));
    const out = await drive(pads, R.release + 300);
    lat.push(Math.round(firstSendAfter(out, lastUp(out, "R"))));
    got.push(words(out).join(" "));
  }
  check(
    got.join(" ") === "you only join" && lat.every((x) => x < 100),
    `swipe commit is not held back (${name}): first letter within 100 ms of release`,
    {
      got,
      lat,
    },
  );
}

for (const [rate, hold] of [
  [8, 40],
  [12, 35],
  [12, 110],
]) {
  const gap = 1000 / rate;
  const pads = {
    L: { path: [[0, ...(await rest(page, "d", "L"))]], touch: [0, 1e9], presses: [] },
    R: { path: [[0, ...(await rest(page, "k", "R"))]], touch: [0, 1e9], presses: [] },
  };
  let expect = "";
  for (let j = 0; j < 20; j++) {
    const side = j % 2 ? "R" : "L";
    const k = (side === "L" ? "asdfwer" : "jklouin")[(j * 3) % 7];
    expect += k;
    const t = 120 + j * gap;
    const [x, y] = await rest(page, k, side);
    const p = pads[side];
    const prev = p.path[p.path.length - 1];
    p.path.push([Math.max(prev[0], t - 40), prev[1], prev[2]], [t - 12, x, y], [t + hold, x, y]);
    p.presses.push([t, t + hold]);
  }
  const out = await drive(pads, 120 + 20 * gap + hold + 60);
  const lat = out.ups.map(([t], j) => out.sends.filter(([, x]) => x !== " ")[j]?.[0] - t);
  const maxMs = Math.round(Math.max(...lat.filter(Number.isFinite)));
  check(
    sent(out).trim() === expect && single(out) && maxMs < 120,
    `alternating two-thumb taps at ${rate}/s, ${hold} ms holds${hold > gap ? " (rolled, overlapping)" : ""}: every letter, in order, each within 120 ms of its release`,
    { got: sent(out).trim(), expect, maxMs },
  );
}

for (const gap of [30, 120]) {
  const L = await swipePad(page, "drag", "L", { restAfter: true });
  const R = await swipePad(page, "on", "R", { start: L.release + gap, restAfter: true, restFrom: await rest(page, "k", "R") });
  const out = await drive({ L, R }, R.release + 40);
  check(
    sent(out).trim() === "dragon",
    `a word swiped across both pads still joins when the second press comes ${gap} ms after the first release`,
    sent(out),
  );
}

{
  const L = await swipePad(page, "the", "L", { restAfter: true });
  const R = await swipePad(page, "only", "R", { start: L.release + 100, restAfter: true, restFrom: await rest(page, "k", "R") });
  const out = await drive({ L, R }, R.release + 40);
  check(
    words(out).join(" ") === "the only" && !out.sends.some(([, x]) => x === "\u0002"),
    "two quick words on alternating pads stay two words without retyping the first",
    sent(out),
  );
}

const keysView = (out) =>
  out.keys
    .map(([kind, v]) =>
      kind === "text"
        ? ({ "\u0002": "⌫", "\u0001": "⏎" }[v] ?? v)
        : `[${kind === "down" ? "+" : "-"}${{ 103: "ctrl", 100: "alt", 101: "shift" }[v] ?? v}]`,
    )
    .join("")
    .replace(/^ /, "");
const reopen = async () => {
  await page.evaluate(() => window.__tp.reopen());
  await reset(page);
};
const twoSwipes = async () => {
  const L = await swipePad(page, "great", "L", { segMs: 150 });
  const R = await swipePad(page, "only", "R", { segMs: 150, start: 190 });
  return { pads: { L, R }, last: Math.max(L.release, R.release), want: "great only" };
};
const oneSwipe = async () => {
  const L = await swipePad(page, "great", "L");
  return { pads: { L }, last: L.release, want: "great" };
};

for (const [name, make] of [
  ["one-pad swipe", oneSwipe],
  ["two-pad swipe", twoSwipes],
]) {
  const got = [];
  for (const d of [0, 20, 40, 60]) {
    const { pads, last, want } = await make();
    const out = await drive(pads, last + d + 200, [[last, "hide", null, d]]);
    got.push([d, keysView(out), want]);
    await reopen();
  }
  check(
    got.every(([, v, want]) => v.trim() === want),
    `${name}, keyboard closed 0/20/40/60 ms after the release: the whole word(s), never a fragment, nothing else`,
    got.map(([d, v]) => `${d} ms: ${JSON.stringify(v)}`).join(", "),
  );
}

{
  const { pads, last } = await oneSwipe();
  const out = await drive(pads, last + 250, [
    [last, "typeText", "xyzxyz", 30],
    [last, "hide", null, 40],
  ]);
  await reopen();
  check(
    keysView(out).trim() === "great",
    "keyboard closed while a word and other output are queued: the word finishes, the rest is dropped",
    keysView(out),
  );
}

{
  const L = await swipePad(page, "great", "L", { segMs: 150 });
  const R = await swipePad(page, "only", "R", { segMs: 150, start: L.release + 300 });
  const out = await drive({ L, R }, R.release + 250, [
    [L.release, "typeText", "xyz".repeat(20), 30],
    [R.release, "hide", null, 40],
  ]);
  await reopen();
  const v = keysView(out).trim();
  check(
    v.startsWith("great") && /only$/.test(v) && !/only.*[xyz]/.test(v),
    "keyboard closed with a word, other output, then a second word queued: both words finish, the output between them is dropped",
    v,
  );
}

{
  const out = await drive({}, 240, [
    [0, "typeText", "abcdefghij"],
    [40, "hide"],
  ]);
  await reopen();
  const v = keysView(out);
  check(v.length >= 1 && v.length <= 3 && "abcdefghij".startsWith(v), "keyboard closed with no swipe pending still drops queued output", v);
}

for (const [bn, b, tail] of [
  ["LB", 5, /^\[\+ctrl\]\[-ctrl\]$/],
  ["RB", 6, /^\[\+alt\]\[-alt\]$/],
  ["Y", 4, /^ $/],
  ["X", 3, /^⌫+$/],
  ["RT", 8, /^(⏎| y)$/],
]) {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const got = [];
  for (const d of [0, 10, 20, 40]) {
    const { pads, last, want } = await twoSwipes();
    const up = bn.endsWith("B") ? 700 : 15;
    const out = await drive(pads, last + d + up + 200, [
      [last, "btnDown", b, d],
      [last, "btnUp", b, d + up],
    ]);
    const v = keysView(out);
    got.push([d, v, v.startsWith(want) && tail.test(v.slice(want.length))]);
  }
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  check(
    got.every(([, , ok]) => ok),
    `${bn} pressed 0/10/20/40 ms after a two-pad swipe at 4x CPU: both words first, then the ${bn} output once`,
    got.map(([d, v]) => `${d} ms: ${JSON.stringify(v)}`).join(", "),
  );
}

const fresh = errors.slice(bootErrors).filter((e) => !/Transport Error/.test(e));
check(!fresh.length, "no page errors", fresh.slice(0, 3));
console.log(failures ? `${failures} FAILED` : "ALL PASS");
await browser.close();
process.exit(failures ? 1 : 0);
