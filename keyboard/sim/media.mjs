import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { openSim, inject, settle } from "./run.mjs";
import { readRuntime as read } from "../runtime.mjs";
import { pageHelpers, sideOf, sleep } from "./helpers.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const out = path.resolve(process.argv[2] ?? path.join(here, "..", "..", "docs", "media"));
const tmp = process.env.MEDIA_TMP ?? fs.mkdtempSync(path.join(os.tmpdir(), "vaportype-media-"));
const only = process.argv.slice(3);
const WIDTH = Number(process.env.MEDIA_W ?? 854);
const FPS = Number(process.env.MEDIA_FPS ?? 18);
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(tmp, { recursive: true });

const CHAT = [
  "[Party chat]",
  "alex: anyone up for one more round?",
  "sam: sure, give me a minute",
  "alex: cool, I'll start the queue",
  "jo: good game last time, that ending was close",
  "sam: next map has a long bridge, stick together",
  "jo: sounds good, I'll take the left side",
];

const { browser, page } = await openSim({ backdrop: true });
await page.evaluate((lines) => {
  const d = document.getElementById("sim-backdrop");
  d.replaceChildren(
    ...lines.map((l) => {
      const p = document.createElement("div");
      p.textContent = l;
      p.style.margin = "0 0 6px";
      return p;
    }),
  );
}, CHAT);
await page.evaluate(["swipe/words.js", "swipe/lm.js", "swipe/engine.js", "modes.js"].map(read).join("\n;\n"));
await page.evaluate(() => {
  window.__oskUserWords = null;
  window.localStorage.clear();
  window.localStorage.setItem("oskSwipeSettings", JSON.stringify({ consent: true, tipShown: true, theme: "modern" }));
});
await inject(page, read("patch.js"));

const F = (fn, ...a) => page.evaluate(fn, ...a);
const { center, vgp, padAt, padIdle } = pageHelpers(page);
const BTN = { L: 20, R: 22 };

async function tap(key, side = sideOf(key), gap = 260) {
  const c = await center(key);
  if (!c) throw new Error(`no key ${key}`);
  await padAt(side, c.x, c.y);
  await sleep(60);
  await vgp("vgp_onbuttondown", BTN[side]);
  await sleep(90);
  await vgp("vgp_onbuttonup", BTN[side]);
  await padIdle(side);
  await settle(page, { quiet: 0, join: false });
  await sleep(gap);
}

async function chord(segments, { ms = 300 } = {}) {
  const last = {};
  let held = null;
  for (const [side, letters] of segments) {
    const pts = [];
    for (const ch of letters) pts.push(await center(ch));
    const from = last[side] ?? { x: pts[0].x + (side === "L" ? -18 : 18), y: pts[0].y + 10 };
    const start = { x: pts[0].x + (from.x - pts[0].x) * 0.35, y: pts[0].y + (from.y - pts[0].y) * 0.35 };
    await padAt(side, start.x, start.y);
    await vgp("vgp_onbuttondown", BTN[side]);
    if (held) await vgp("vgp_onbuttonup", BTN[held]);
    held = side;
    const path = [start, ...pts];
    const steps = 8;
    for (let i = 1; i < path.length; i++)
      for (let s = 1; s <= steps; s++) {
        await padAt(
          side,
          path[i - 1].x + ((path[i].x - path[i - 1].x) * s) / steps,
          path[i - 1].y + ((path[i].y - path[i - 1].y) * s) / steps,
        );
        await sleep(ms / steps);
      }
    last[side] = pts[pts.length - 1];
  }
  await sleep(60);
  await vgp("vgp_onbuttonup", BTN[held]);
  await padIdle("L");
  await padIdle("R");
  await settle(page);
}

const reset = async () => {
  await tap("Enter", "R", 0);
  await settle(page);
  await sleep(200);
};

async function record(name, act, { tail = 1500, crop } = {}) {
  const dir = path.join(tmp, name.replace(/\.gif$/, ""));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await page.createCDPSession();
  const frames = [];
  cdp.on("Page.screencastFrame", (f) => {
    frames.push({ t: f.metadata.timestamp, data: f.data });
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  await sleep(600);
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
  const vf = `${crop ? `crop=${crop},` : ""}fps=${FPS},scale=${WIDTH}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`;
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

const want = (n) => !only.length || only.includes(n);

if (want("swipe")) {
  await reset();
  await record("swipe.gif", async () => {
    await chord([
      ["R", "h"],
      ["L", "e"],
      ["R", "llo"],
    ]);
    await sleep(900);
    await chord([
      ["L", "w"],
      ["R", "o"],
      ["L", "r"],
      ["R", "l"],
      ["L", "d"],
    ]);
  });
  console.log("swipe text", await F(() => document.querySelector(".osk-echo-t")?.textContent));
}

if (want("autocorrect")) {
  await reset();
  await record("autocorrect.gif", async () => {
    for (const ch of "teh") await tap(ch);
    await tap(" ", "R", 0);
    await sleep(2000);
  });
}

if (want("cursor")) {
  await reset();
  for (const w of ["see", "you", "soon"]) {
    for (const ch of w) await tap(ch, sideOf(ch), 0);
    await tap(" ", "R", 0);
  }
  await settle(page);
  await record("cursor.gif", async () => {
    const sp = await center(" ");
    await padAt("L", sp.x + 60, sp.y);
    await sleep(150);
    await vgp("vgp_onbuttondown", BTN.L);
    await sleep(150);
    for (let i = 1; i <= 14; i++) {
      await padAt("L", sp.x + 60 - i * 10, sp.y);
      await sleep(70);
    }
    await sleep(500);
    for (let i = 1; i <= 22; i++) {
      await padAt("L", sp.x - 80 + i * 10, sp.y);
      await sleep(70);
    }
    await sleep(500);
    await vgp("vgp_onbuttonup", BTN.L);
    await padIdle("L");
  });
}

await browser.close();
console.log(out);
