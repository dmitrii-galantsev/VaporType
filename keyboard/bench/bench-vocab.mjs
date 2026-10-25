import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { loadEngine, simulate, makeRng, KEYS, PADS } from "./bench.mjs";

const TOKEN = /^[A-Za-z]+(?:'[A-Za-z]+)?$/;

export function tokensOf(files, split) {
  const out = [];
  for (const f of files) {
    const lines = fs
      .readFileSync(new URL("./corpora/" + f, import.meta.url), "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    lines.forEach((l, i) => {
      if (split && f === "chat-corpus.txt" && (i % 4 === 3 ? "heldout" : "tune") !== split) return;
      for (const t of l.split(/\s+/).map((t) => t.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, ""))) if (TOKEN.test(t)) out.push(t.toLowerCase());
    });
  }
  return out;
}

export function benchVocab(engine, tokens, seed = 99) {
  const res = { n: tokens.length };
  let inv = 0;
  for (const w of tokens) if (engine.known(w)) inv++;
  res.inVocab = inv / tokens.length;
  for (const mode of ["onepad-ideal", "sloppy-twopad"]) {
    const r = makeRng(seed);
    let t1 = 0;
    for (const w of tokens) {
      if (!engine.known(w) || w.replace(/[^a-z]/g, "").length < 2) continue;
      const res2 = engine.decode(simulate(w, mode, r), KEYS, { pads: /twopad/.test(mode) ? PADS : undefined });
      if (res2[0]?.key === w) t1++;
    }
    res[mode] = t1 / tokens.length;
  }
  return res;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const files = (args.find((a) => a.startsWith("--files="))?.slice(8) ?? "chat-corpus.txt,tune-web-corpus.txt").split(",");
  const split = args.find((a) => a.startsWith("--split="))?.slice(8) ?? "tune";
  const { engine } = await loadEngine("../src/engine.js");
  const toks = tokensOf(files, split === "all" ? null : split);
  const r = benchVocab(engine, toks);
  const f = (x) => (100 * x).toFixed(1);
  console.log(
    `vocab ${files.join("+")} (${split}): words ${engine.size()}, tokens ${r.n}, in vocab ${f(r.inVocab)}%, top-1 (no context) one pad ${f(r["onepad-ideal"])}% sloppy two pads ${f(r["sloppy-twopad"])}%`,
  );
}
