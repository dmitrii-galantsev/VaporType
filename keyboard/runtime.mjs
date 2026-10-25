import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const KEYBOARD_DIR = path.dirname(fileURLToPath(import.meta.url));

export const RUNTIME = {
  "patch.js": "src/patch.js",
  "modes.js": "src/modes.js",
  "swipe/engine.js": "src/engine.js",
  "swipe/words.js": "data/words.js",
  "swipe/lm.js": "data/lm.js",
  "swipe/DATA-LICENSES.md": "data/DATA-LICENSES.md",
};

export const INJECTOR = { "inject.mjs": "src/inject.mjs" };

export const sourceOf = (rel) => path.join(KEYBOARD_DIR, RUNTIME[rel] ?? INJECTOR[rel] ?? rel);

export const readRuntime = (rel) => fs.readFileSync(sourceOf(rel), "utf8");

export function assemble(dest, { injector = false } = {}) {
  const files = { ...RUNTIME, ...(injector ? INJECTOR : {}) };
  for (const [rel, src] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
    fs.copyFileSync(path.join(KEYBOARD_DIR, src), path.join(dest, rel));
  }
  return Object.keys(files);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dest = process.argv[2];
  if (!dest) {
    console.error("usage: node keyboard/runtime.mjs <dir>   assembles patch.js, modes.js, swipe/ and inject.mjs into <dir>");
    process.exit(2);
  }
  console.log(assemble(path.resolve(dest), { injector: true }).join("\n"));
}
