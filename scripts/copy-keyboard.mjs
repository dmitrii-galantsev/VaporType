import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RUNTIME, assemble } from "../keyboard/runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSIONED = [
  ["swipe/words.js", /version: (\d+)/],
  ["swipe/lm.js", /version: (\d+)/],
  ["swipe/engine.js", /const VERSION = (\d+)/],
  ["modes.js", /const VERSION = (\d+)/],
  ["patch.js", /const VERSION = (\d+)/],
];
const out = path.join(root, "dist", "keyboard");
fs.rmSync(out, { recursive: true, force: true });
assemble(out);
const manifest = {};
for (const [rel, pattern] of VERSIONED) {
  const body = fs.readFileSync(path.join(out, rel));
  const version = Number(pattern.exec(body.subarray(0, 4096).toString("utf8"))?.[1] ?? NaN);
  if (!Number.isFinite(version)) {
    console.error(`keyboard/${RUNTIME[rel]}: no version found`);
    process.exit(1);
  }
  manifest[rel] = { version, bytes: body.length, sha256: crypto.createHash("sha256").update(body).digest("hex") };
}
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(
  Object.entries(manifest)
    .map(([f, m]) => `${f} v${m.version}`)
    .join(", "),
);
