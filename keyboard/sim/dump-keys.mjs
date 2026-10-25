import fs from "node:fs";
import path from "node:path";
import { openSim } from "./run.mjs";
import { readRuntime as read } from "../runtime.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const { browser, page } = await openSim();
await page.evaluate(read("patch.js"));
await new Promise((r) => setTimeout(r, 1200));
const geo = await page.evaluate(() => {
  const keys = {};
  for (const el of document.querySelectorAll("[data-key]")) {
    const k = el.getAttribute("data-key");
    const r = el.getBoundingClientRect();
    if (!r.width || keys[k]) continue;
    keys[k] = { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }
  const kb = document.querySelector("[data-key]").closest('[class*="Layout_"]');
  const r = kb.getBoundingClientRect();
  return {
    viewport: [innerWidth, innerHeight],
    keyboard: { left: r.left, top: r.top, width: r.width, height: r.height },
    padWidthFraction: 0.55,
    keys,
  };
});
fs.writeFileSync(process.argv[2] ?? path.join(here, "..", "bench", "geometry.json"), JSON.stringify(geo, null, 1));
console.log(JSON.stringify(geo.keyboard), Object.keys(geo.keys).length, geo.keys.q, geo.keys.a, geo.keys.z);
await browser.close();
