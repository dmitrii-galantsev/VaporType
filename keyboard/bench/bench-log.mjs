import fs from "node:fs";
import { loadEngine } from "./bench.mjs";
import { chips as chipRow } from "./bench-chips.mjs";

const file = process.env.OSK_TYPING_LOG;
if (!file) {
  console.error(
    "usage: OSK_TYPING_LOG=<typing-log.jsonl> [OSK_LOG_SINCE=2026-10-24] [OSK_USER_WORDS=<user-words.json>] node bench-log.mjs",
  );
  process.exit(2);
}
const since = process.env.OSK_LOG_SINCE ? Date.parse(process.env.OSK_LOG_SINCE) : 0;
const { engine } = await loadEngine();
if (process.env.OSK_USER_WORDS) engine.setUser(JSON.parse(fs.readFileSync(process.env.OSK_USER_WORDS, "utf8")));

const rows = fs
  .readFileSync(file, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const WORD = /^[A-Za-z']+$/;
const upper = (s) => s.length > 1 && s === s.toUpperCase() && /[A-Z]{2}/.test(s);

function chips(buf, ctx) {
  const { list, shown } = chipRow(engine, buf, ctx);
  return list.slice(0, shown);
}

const n = { words: 0, kinds: {}, outcomes: {}, presses: 0, saved: 0, mid: 0, savedMid: 0, either: 0, savedEither: 0 };
const ac = { checked: 0, keptChanged: 0, keptApostrophe: 0, fixMatched: 0, fixSilent: 0, fixWrong: 0 };
let geo = null,
  prev = null,
  last = 0;
for (const r of rows) {
  if (r.type === "geo" && r.keys && Object.keys(r.keys).length)
    geo = Object.fromEntries(Object.entries(r.keys).map(([k, [x, y, w, h]]) => [k, { x, y, w, h }]));
  if (r.type === "line") {
    prev = null;
    continue;
  }
  if (r.type !== "word") continue;
  if (r.t - last > 30000) prev = null;
  last = r.t;
  const word = r.committed;
  if (r.t >= since) {
    n.words++;
    n.kinds[r.kind] = (n.kinds[r.kind] ?? 0) + 1;
    n.outcomes[`${r.kind} ${r.outcome}`] = (n.outcomes[`${r.kind} ${r.outcome}`] ?? 0) + 1;
    if (r.kind === "tap" && WORD.test(word) && word.length >= 2) {
      n.presses += word.length + 1;
      if (r.outcome === "picked") n.saved += word.length - r.typed.length;
      const target = word.toLowerCase();
      let gotMid = 0,
        gotEither = 0;
      for (let k = 1; k < word.length && !gotMid; k++) {
        const c = chips(word.slice(0, k), { prev, keys: geo });
        if (c[0] === target) gotMid = word.length - k;
        if (!gotEither && c.includes(target)) gotEither = word.length - k;
      }
      if (gotMid) (n.mid++, (n.savedMid += gotMid));
      if (gotEither) (n.either++, (n.savedEither += gotEither));
      if (WORD.test(r.typed) && !upper(r.typed)) {
        ac.checked++;
        const taps = r.taps?.length === r.typed.length && r.taps.some(Boolean) ? r.taps.map((t) => t && { x: t.x, y: t.y }) : null;
        const c = engine.correct(r.typed, { prev, keys: geo, taps, final: true });
        const fired = c?.confident && c.word.toLowerCase() !== r.typed.toLowerCase() ? c.word.toLowerCase() : null;
        const fix = r.outcome === "picked" && !target.startsWith(r.typed.toLowerCase());
        if (r.outcome === "kept" && fired) {
          ac.keptChanged++;
          if (fired.replace(/'/g, "") === r.typed.toLowerCase()) ac.keptApostrophe++;
        } else if (fix) {
          if (fired === target) ac.fixMatched++;
          else if (fired) ac.fixWrong++;
          else ac.fixSilent++;
        }
      }
    }
  }
  prev = r.how === "enter" || r.how === "stop" ? null : word.split(" ").pop();
}
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) : "0.0");
console.log(`words ${n.words}  kinds ${JSON.stringify(n.kinds)}`);
console.log(`outcomes ${JSON.stringify(n.outcomes)}`);
console.log(`tapped words of 2+ letters: ${n.presses} presses with their spaces`);
console.log(`  saved by suggestion picks: ${n.saved} (${pct(n.saved, n.presses)} %)`);
console.log(
  `  middle chip showed the word with letters left: ${n.mid} words, ${n.savedMid} presses (${pct(n.savedMid, n.presses)} %) if picked at once`,
);
console.log(`  middle or right chip: ${n.either} words, ${n.savedEither} presses (${pct(n.savedEither, n.presses)} %)`);
console.log(
  `autocorrect replay on ${ac.checked} tapped words: would change ${ac.keptChanged} the user kept (${ac.keptApostrophe} only an apostrophe); picked fixes ${ac.fixMatched} matched, ${ac.fixWrong} wrong, ${ac.fixSilent} silent`,
);
