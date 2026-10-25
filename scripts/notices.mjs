import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_LICENSES = path.join(root, "keyboard", "data", "DATA-LICENSES.md");
const check = process.argv.includes("--check");
const SCOWL = {
  "2000-2011": ["licenses/SCOWL-2000-2011.txt", "the SCOWL README as extracted in Debian's wamerican / hunspell-en-us copyright file"],
  "2000-2018": ["licenses/SCOWL-2000-2018.txt", "https://github.com/en-wl/wordlist/blob/master/scowl/Copyright"],
};

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};
const stale = [];
const emit = (file, text) => {
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) return;
  if (check) stale.push(path.relative(root, file));
  else fs.writeFileSync(file, text);
};

const wrap = (text, width = 79) => {
  const out = [];
  let line = "";
  for (const w of text.split(/\s+/)) {
    if (line && line.length + 1 + w.length > width) {
      out.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out.join("\n");
};
const data = fs.readFileSync(DATA_LICENSES, "utf8");
const attribution = /^## Attribution text for a release\s*\n([\s\S]*?)(?=\n## |\s*$)/m
  .exec(data)?.[1]
  ?.split("\n")
  .filter((l) => l.startsWith(">"))
  .map((l) => l.replace(/^>\s?/, ""))
  .join(" ")
  .trim();
if (!attribution) fail("DATA-LICENSES.md has no '## Attribution text for a release' quote");
const termsOf = (file) => {
  const row = data.split("\n").find((l) => l.startsWith(`| \`${file}\``));
  const cells = row?.split("|").map((c) => c.trim());
  if (!cells || cells.length < 5) fail(`DATA-LICENSES.md summary table has no row for ${file}`);
  return cells[3].replace(/`/g, "");
};
const terms = { "words.js": termsOf("words.js"), "lm.js": termsOf("lm.js") };

let scowl = "";
if (/SCOWL/.test(data)) {
  const inline =
    /^## [^\n]*SCOWL[^\n]*\n[\s\S]*?```[^\n]*\n([\s\S]*?Permission to use, copy, modify, distribute and sell[\s\S]*?)```/m.exec(data)?.[1];
  if (inline) {
    scowl = `SCOWL notice (as given in keyboard/data/DATA-LICENSES.md):\n\n${inline.trimEnd()}\n`;
  } else {
    const year = /Copyright (2000-20\d\d) by Kevin Atkinson/.exec(data)?.[1];
    const pick = SCOWL[year];
    if (!pick)
      fail(
        `DATA-LICENSES.md mentions SCOWL but names no known notice year (found ${year ?? "none"}); add the notice text or a licenses/SCOWL-${year}.txt`,
      );
    scowl = `${wrap(`SCOWL notice (word lists used to build the data; from ${pick[1]}):`)}\n\n${fs.readFileSync(path.join(root, pick[0]), "utf8").trimEnd()}\n`;
  }
}

const rule = "-".repeat(79);
const license =
  [
    fs.readFileSync(path.join(root, "licenses", "MIT.txt"), "utf8").trimEnd(),
    rule,
    [
      "Word data",
      "",
      wrap(
        "The data files below are not covered by the MIT license above. Their terms, from keyboard/data/DATA-LICENSES.md (shipped in the plugin as dist/keyboard/swipe/DATA-LICENSES.md, with sources and the changes made):",
      ),
      "",
      ...Object.entries(terms).map(([f, t]) => wrap(`keyboard/data/${f}: ${t}`)),
      "",
      wrap(`Attribution: ${attribution}`),
    ].join("\n"),
    ...(scowl ? [rule, scowl.trimEnd()] : []),
    rule,
    [
      "The build setup (rollup.config.js, tsconfig.json, package.json layout) is based",
      "on the Decky plugin template, distributed under the following license:",
      "",
      fs.readFileSync(path.join(root, "licenses", "decky-plugin-template.txt"), "utf8").trimEnd(),
    ].join("\n"),
  ].join("\n\n") + "\n";
emit(path.join(root, "LICENSE"), license);

const readmePath = path.join(root, "README.md");
const readme = fs.readFileSync(readmePath, "utf8");
const start = "<!-- data-license:start -->";
const end = "<!-- data-license:end -->";
if (!readme.includes(start) || !readme.includes(end)) fail("README.md lacks the data-license markers");
const block = [
  start,
  `Word data: ${Object.entries(terms)
    .map(([f, t]) => `\`${f}\` ${t.replace(/ below\b/, " in LICENSE")}`)
    .join("; ")}. Attribution and sources: [DATA-LICENSES.md](keyboard/data/DATA-LICENSES.md).`,
  end,
].join("\n");
emit(readmePath, readme.slice(0, readme.indexOf(start)) + block + readme.slice(readme.indexOf(end) + end.length));

if (stale.length) fail(`out of date: ${stale.join(", ")}; run node scripts/notices.mjs`);
console.log(
  `notices ${check ? "up to date" : "written"}: ${Object.entries(terms)
    .map(([f, t]) => `${f} ${t}`)
    .join("; ")}${scowl ? " (+SCOWL notice)" : ""}`,
);
