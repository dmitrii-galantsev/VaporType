import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RUNTIME } from "../keyboard/runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RECORD = path.join(root, "test-record.json");
const KEYBOARD = Object.keys(RUNTIME);
export const PACKAGE = [
  "plugin.json",
  "package.json",
  "main.py",
  "LICENSE",
  "README.md",
  "dist/index.js",
  "dist/index.js.map",
  "dist/keyboard/manifest.json",
  ...KEYBOARD.map((f) => `dist/keyboard/${f}`),
];
const SOURCES = [...KEYBOARD.map((f) => `keyboard/${RUNTIME[f]}`), "src/keyboard.ts", "src/index.tsx"];

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const fail = (msg) => {
  console.error(`provenance: ${msg}`);
  process.exit(1);
};

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(rel));
    else out.push(rel);
  }
  return out;
}

function snapshot() {
  const allowed = new Set(PACKAGE);
  const extra = walk("dist").filter((f) => !allowed.has(f));
  if (extra.length) fail(`unexpected files in dist/: ${extra.join(", ")}`);
  const files = {};
  for (const f of [...PACKAGE, ...SOURCES]) {
    if (!fs.existsSync(path.join(root, f))) fail(`${f} missing; run pnpm run build`);
    files[f] = sha(path.join(root, f));
  }
  for (const f of KEYBOARD) {
    if (files[`dist/keyboard/${f}`] !== files[`keyboard/${RUNTIME[f]}`])
      fail(`dist/keyboard/${f} differs from keyboard/${RUNTIME[f]}; run pnpm run build`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "dist", "keyboard", "manifest.json"), "utf8"));
  for (const [f, m] of Object.entries(manifest))
    if (files[`keyboard/${RUNTIME[f]}`] !== m.sha256) fail(`dist/keyboard/manifest.json is stale for ${f}; run pnpm run build`);
  return files;
}

function verify() {
  if (!fs.existsSync(RECORD)) fail("no test-record.json; run scripts/test-release.sh first");
  const record = JSON.parse(fs.readFileSync(RECORD, "utf8"));
  const now = snapshot();
  const changed = Object.keys({ ...record.files, ...now }).filter((f) => record.files[f] !== now[f]);
  if (changed.length) fail(`changed since the last passing test run: ${changed.join(", ")}; run scripts/test-release.sh again`);
  return record;
}

const [mode, arg] = process.argv.slice(2);
if (mode === "snapshot") {
  process.stdout.write(JSON.stringify(snapshot(), null, 2) + "\n");
} else if (mode === "record") {
  const before = JSON.parse(fs.readFileSync(arg, "utf8"));
  const after = snapshot();
  for (const f of Object.keys({ ...before, ...after })) if (before[f] !== after[f]) fail(`${f} changed while the tests ran; test again`);
  const patch = fs.readFileSync(path.join(root, "keyboard", RUNTIME["patch.js"]), "utf8");
  const record = {
    tested: new Date().toISOString(),
    keyboard: Number(/const VERSION = (\d+)/.exec(patch)?.[1] ?? 0),
    tests: ["keyboard/sim/test-all.sh (simulator suites and engine gates)", "test/backend-test.py", "test/plugin-sim.mjs"],
    files: after,
  };
  fs.writeFileSync(RECORD, JSON.stringify(record, null, 2) + "\n");
  console.log(`recorded ${Object.keys(after).length} file hashes in test-record.json`);
} else if (mode === "verify") {
  const record = verify();
  console.log(`provenance ok: keyboard v${record.keyboard}, tested ${record.tested}`);
} else if (mode === "package-list") {
  verify();
  process.stdout.write(PACKAGE.join("\n") + "\n");
} else {
  console.error("usage: node scripts/provenance.mjs snapshot | record <before.json> | verify | package-list");
  process.exit(2);
}
