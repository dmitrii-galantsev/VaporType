import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { openSim } from "./run.mjs";
import { assemble } from "../runtime.mjs";
import { sleep } from "./helpers.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "osk-inject-"));
const userFile = path.join(dir, "user-words.json");
const logFile = path.join(dir, "typing-log.jsonl");
const installed = path.join(dir, "installed.json");
const runtimeDir = path.join(dir, "runtime");
assemble(runtimeDir, { injector: true });
fs.writeFileSync(
  userFile,
  JSON.stringify({
    version: 1,
    words: { quxbaz: { c: 3, d: "Quxbaz" } },
    bigrams: { "hello quxbaz": 2 },
    settings: { autocorrect: false },
  }),
);
fs.writeFileSync(installed, JSON.stringify({ date: "2026-10-23" }));

const freePort = () =>
  new Promise((res) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });
const port = await freePort();

let failures = 0;
const lines = [];
const check = (ok, what) => {
  if (!ok) failures++;
  lines.push(`${ok ? "PASS" : "FAIL"} ${what}`);
};

async function waitFor(fn, ms = 8000, step = 50) {
  const end = Date.now() + ms;
  for (;;) {
    let v;
    try {
      v = await fn();
    } catch (e) {
      v = undefined;
    }
    if (v || Date.now() > end) return v;
    await sleep(step);
  }
}

const env = (extra = {}) => ({
  ...process.env,
  CEF_PORT: String(port),
  OSK_USER_WORDS: userFile,
  OSK_INSTALLED: installed,
  OSK_CYCLE_MS: "250",
  OSK_HTTP_TIMEOUT_MS: "800",
  OSK_LOG_MAX: "4000",
  ...extra,
});

function injector(extra) {
  const child = spawn(process.execPath, [path.join(runtimeDir, "inject.mjs")], { env: env(extra) });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  return { child, out: () => out.trim() };
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", `--remote-debugging-port=${port}`],
});

async function run() {
  const { page } = await openSim({ browser });
  const inj = injector();
  await waitFor(
    () =>
      page.evaluate(
        () => /keyboard=patched/.test(window.__oskTrackpadFix?.status?.() ?? "") && window.__oskUserWordsLoaded && !!window.__oskEngine,
      ),
    15000,
  );
  return { page, ...inj };
}

let s = await run();
const F = (fn, ...a) => s.page.evaluate(fn, ...a);
const keys = await s.page.$$eval("[data-key]", (els) => els.map((e) => e.getAttribute("data-key")));
const status = await F(() => window.__oskTrackpadFix?.status?.());
check(
  keys.includes("Escape") && keys.includes("Control") && keys.includes("OSKSug_0") && /keyboard=patched swipe=on/.test(status ?? ""),
  `inject.mjs patched the keyboard over CDP: ${status}`,
);
const known = await F(() => [
  window.__oskEngine.known("quxbaz"),
  window.__oskEngine.exportUser().bigrams["hello quxbaz"],
  window.__oskTrackpadFix.settings.autocorrect,
]);
check(
  known[0] && known[1] === 2 && known[2] === false,
  `user words file loaded into Steam (known, bigram, autocorrect setting): ${JSON.stringify(known)}`,
);
const firstAfterHello = await F(() => window.__oskEngine.predict("hello", 3).map((c) => c.key));
check(firstAfterHello[0] === "quxbaz", `a word pair typed twice comes first after "hello": ${JSON.stringify(firstAfterHello)}`);
const vline = await F(() => window.__oskTrackpadFix.versionLine());
check(/installed 2026-10-23$/.test(vline), `install date from installed.json reaches the version line: ${vline}`);

await F(() => {
  window.__oskEngine.learn("flumpet", null);
  window.__oskEngine.__dirty = true;
});
const saved = await waitFor(() => {
  const d = JSON.parse(fs.readFileSync(userFile, "utf8"));
  return d.words.flumpet ? d : null;
});
const acked = await waitFor(() => F(() => window.__oskTrackpadFix.takeUserWords() === null));
check(
  saved?.words.flumpet?.c === 1 &&
    saved.words.quxbaz?.c === 3 &&
    saved.settings?.autocorrect === false &&
    !("rev" in saved) &&
    fs.existsSync(userFile + ".bak") &&
    acked,
  `learned word written back, then acknowledged (takeUserWords null): ${Object.keys(saved?.words ?? {})}`,
);

await F(() => {
  const F = window.__oskTrackpadFix;
  F.setSetting("typingLog", true);
  for (let i = 0; i < 3; i++) F.typingLog.out.push([++F.typingLog.seq, JSON.stringify({ type: "test", i })]);
});
const logged = await waitFor(
  () =>
    fs.existsSync(logFile) &&
    fs
      .readFileSync(logFile, "utf8")
      .split("\n")
      .filter((l) => l.includes('"test"')).length === 3,
);
const logAcked = await waitFor(() => F(() => window.__oskTrackpadFix.takeTypingLog() === null));
check(logged && logAcked, "typing log lines appended to typing-log.jsonl and acknowledged");
await F(() => {
  const F = window.__oskTrackpadFix;
  for (let i = 0; i < 60; i++) F.typingLog.out.push([++F.typingLog.seq, JSON.stringify({ type: "fill", i, pad: "x".repeat(80) })]);
});
await waitFor(() => F(() => window.__oskTrackpadFix.takeTypingLog() === null));
await F(() => {
  const F = window.__oskTrackpadFix;
  F.typingLog.out.push([++F.typingLog.seq, JSON.stringify({ type: "after" })]);
});
const rotated = await waitFor(
  () => fs.existsSync(logFile + ".1") && fs.existsSync(logFile) && fs.readFileSync(logFile, "utf8").includes('"after"'),
);
check(
  rotated,
  `log rotates past OSK_LOG_MAX (4000 bytes here) into .1: ${fs.existsSync(logFile + ".1") ? fs.statSync(logFile + ".1").size : 0} bytes`,
);
await F(() => window.__oskTrackpadFix.clearTypingLog());
const cleared = await waitFor(() => !fs.existsSync(logFile) && !fs.existsSync(logFile + ".1"));
check(cleared, "Clear typing log deletes both log files");
await F(() => window.__oskTrackpadFix.forgetAll());
const bakGone = await waitFor(() => !fs.existsSync(userFile + ".bak") && !JSON.parse(fs.readFileSync(userFile, "utf8")).words.flumpet);
check(bakGone, "forgetAll writes the emptied words and deletes user-words.json.bak");
await F(() => {
  window.__oskEngine.learn("flumpet", null);
  window.__oskEngine.__dirty = true;
});
await waitFor(() => JSON.parse(fs.readFileSync(userFile, "utf8")).words.flumpet);

await F(() => {
  window.__oskEngine.learn("snorkelop", null);
  window.__oskEngine.__dirty = true;
});
await waitFor(() => JSON.parse(fs.readFileSync(userFile, "utf8")).words.snorkelop);
const t0Race = Date.now();
await F(() => {
  const F = window.__oskTrackpadFix;
  const take = F.takeUserWords;
  let once = true;
  F.takeUserWords = () => {
    const j = take();
    if (j && once) {
      once = false;
      F.forgetAll();
    }
    return j;
  };
  window.__oskEngine.learn("snorkelop", null);
  window.__oskEngine.__dirty = true;
});
let cleanSeen = false,
  bakAfterClean = false;
const raced = await waitFor(
  async () => {
    let d, bak;
    try {
      d = JSON.parse(fs.readFileSync(userFile, "utf8"));
      bak = fs.existsSync(userFile + ".bak") ? fs.readFileSync(userFile + ".bak", "utf8") : "";
    } catch (e) {
      return false;
    }
    const clean = !d.words.snorkelop && !d.words.flumpet;
    if (clean) cleanSeen = true;
    if (cleanSeen && /snorkelop|flumpet/.test(bak)) bakAfterClean = true;
    return (
      cleanSeen &&
      !bakAfterClean &&
      Date.now() > t0Race + 2500 &&
      !/snorkelop|flumpet/.test(bak) &&
      (await F(() => window.__oskTrackpadFix.takeRequests() === null && window.__oskTrackpadFix.takeUserWords() === null))
    );
  },
  6000,
  5,
);
const fileNow = fs.readFileSync(userFile, "utf8").slice(0, 120);
check(
  !!raced && !bakAfterClean,
  `a forget during an in-flight save wins (bak with forgotten words after the clean save: ${bakAfterClean}): no forgotten word in user-words.json or .bak, request acknowledged: ${fileNow}`,
);
await F(() => {
  window.__oskEngine.learn("flumpet", null);
  window.__oskEngine.__dirty = true;
});
await waitFor(() => JSON.parse(fs.readFileSync(userFile, "utf8")).words.flumpet);

const bakPath = userFile + ".bak";
fs.rmSync(bakPath, { recursive: true, force: true });
fs.mkdirSync(bakPath);
fs.writeFileSync(path.join(bakPath, "stuck"), "x");
await F(() => {
  const F = window.__oskTrackpadFix;
  const take = F.takeRequests;
  window.__takes = 0;
  window.__lastReq = undefined;
  F.takeRequests = () => {
    const r = take();
    if (r) window.__takes++;
    window.__lastReq = r;
    return r;
  };
  F.forgetAll();
});
const failedTakes = await waitFor(() => F(() => (window.__takes >= 5 ? window.__takes : 0)), 8000);
const stillPending = await F(() => ({ hostAcks: window.__oskTrackpadFix.hostAcks, last: window.__lastReq }));
fs.rmSync(bakPath, { recursive: true, force: true });
fs.writeFileSync(bakPath, "snorkelop");
const delivered = await waitFor(() => F(() => window.__lastReq === null) && !fs.existsSync(bakPath), 6000);
check(
  failedTakes >= 5 &&
    stillPending.hostAcks === true &&
    JSON.parse(stillPending.last ?? "{}").removeBackup === true &&
    !!delivered &&
    /not carried out/.test(s.out()),
  `an announced host (hostAcks) keeps a forget pending through ${failedTakes} failed deliveries (.bak undeletable), then deletes .bak and acknowledges: ${JSON.stringify(stillPending)}`,
);
await F(() => {
  window.__oskEngine.learn("flumpet", null);
  window.__oskEngine.__dirty = true;
});
await waitFor(() => JSON.parse(fs.readFileSync(userFile, "utf8")).words.flumpet);

const second = injector();
const blocked = await waitFor(() => /another injector holds/.test(second.out()), 5000);
second.child.kill();
check(!!blocked, `a second inject.mjs waits on the lock file: ${second.out().split("\n")[0]}`);

const hang = net.createServer(() => {});
await new Promise((r) => hang.listen(0, "127.0.0.1", r));
const t0 = Date.now();
const stuck = injector({ CEF_PORT: String(hang.address().port), OSK_LOCK: path.join(dir, "other.lock") });
const timedOut = await waitFor(() => /error: .*(timeout|aborted)/i.test(stuck.out()), 8000);
check(
  !!timedOut,
  `HTTP discovery against a silent port times out instead of hanging (${Date.now() - t0} ms): ${stuck.out().split("\n")[0]}`,
);
stuck.child.kill();
hang.close();

lines.push(`inject.mjs output: ${s.out().split("\n").slice(0, 3).join(" | ")}`);
s.child.kill();
await waitFor(() => !fs.existsSync(path.join(dir, "inject.lock")), 3000);
await s.page.close();

s = await run();
const afterRestart = await s.page.evaluate(() => window.__oskEngine?.known("flumpet"));
check(afterRestart === true, "after a Steam restart the learned word is loaded again");

const tmpPath = userFile + ".tmp";
await F(() => {
  window.__oskEngine.learn("zebrafink", null);
  window.__oskEngine.__dirty = true;
});
await waitFor(() => JSON.parse(fs.readFileSync(userFile, "utf8")).words.zebrafink);
fs.mkdirSync(tmpPath);
fs.writeFileSync(path.join(tmpPath, "stuck"), "x");
await F(() => {
  const F = window.__oskTrackpadFix;
  const take = F.takeRequests;
  window.__takes = 0;
  window.__lastReq = undefined;
  F.takeRequests = () => {
    const r = take();
    if (r) window.__takes++;
    window.__lastReq = r;
    return r;
  };
  F.forgetAll();
});
await waitFor(() => F(() => window.__takes >= 4), 8000);
const faulted = await F(() => ({ takes: window.__takes, pending: window.__lastReq !== null && window.__lastReq !== undefined }));
const readWords = () => {
  try {
    return fs.readFileSync(userFile, "utf8");
  } catch (e) {
    return "";
  }
};
const onDisk = readWords();
s.child.kill();
await waitFor(() => !fs.existsSync(path.join(dir, "inject.lock")), 3000);
await s.page.evaluate(() => localStorage.clear());
await s.page.close();
s = await run();
const backAfterRestart = await F(() => window.__oskEngine?.known("zebrafink"));
fs.rmSync(tmpPath, { recursive: true, force: true });
const tombDone = await waitFor(() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "forget.json"), "utf8")).pending.length === 0;
  } catch (e) {
    return false;
  }
}, 6000);
await F(() => {
  window.__oskEngine.learn("quokkaz", null);
  window.__oskEngine.__dirty = true;
});
const savedAgain = await waitFor(() => /quokkaz/.test(readWords()), 6000);
check(
  faulted.pending &&
    faulted.takes >= 4 &&
    !/zebrafink/.test(onDisk) &&
    backAfterRestart === false &&
    !!tombDone &&
    !!savedAgain &&
    !/zebrafink/.test(readWords()),
  `a forget whose replacement save fails (user-words.json.tmp undeletable) is not acknowledged, leaves no forgotten word on disk or after a restart, and finishes once the fault clears: ${JSON.stringify({ faulted, onDisk: onDisk.slice(0, 60), backAfterRestart, tombDone, savedAgain })}`,
);
s.child.kill();
await browser.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(lines.join("\n"));
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
