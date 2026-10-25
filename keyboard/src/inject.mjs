import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.env.CEF_PORT ?? 8080);
const here = path.dirname(new URL(import.meta.url).pathname);
const USER_FILE = process.env.OSK_USER_WORDS ?? path.join(here, "user-words.json");
const read = (f) => fs.readFileSync(path.join(here, f), "utf8");
const patch = read("patch.js");
const words = read("swipe/words.js");
const engine = read("swipe/engine.js");
const versionOf = (src) => Number(/version: (\d+)/.exec(src)?.[1] ?? 0);
const WORDS_V = versionOf(words);
const lm = fs.existsSync(path.join(here, "swipe/lm.js")) ? read("swipe/lm.js") : "";
const LM_V = lm ? versionOf(lm) : 0;
const ENGINE_V = Number(/const VERSION = (\d+)/.exec(engine)?.[1] ?? 0);
const modes = fs.existsSync(path.join(here, "modes.js")) ? read("modes.js") : "";
const MODES_V = Number(/const VERSION = (\d+)/.exec(modes)?.[1] ?? 0);
const DATA_DIR = path.dirname(USER_FILE);
const LOG_FILE = process.env.OSK_TYPING_LOG ?? path.join(DATA_DIR, "typing-log.jsonl");
const LOG_MAX = Number(process.env.OSK_LOG_MAX ?? 5 * 1024 * 1024);
const INSTALLED = process.env.OSK_INSTALLED ?? path.join(here, "installed.json");
const LOCK = process.env.OSK_LOCK ?? path.join(DATA_DIR, "inject.lock");
const TOMB = path.join(DATA_DIR, "forget.json");
const CYCLE_MS = Number(process.env.OSK_CYCLE_MS ?? 5000);
const HTTP_TIMEOUT_MS = Number(process.env.OSK_HTTP_TIMEOUT_MS ?? 3000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = "";

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (m) => {
    const msg = JSON.parse(m.data);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.result?.exceptionDetails) p.rej(new Error(msg.result.exceptionDetails.exception?.description ?? "exception"));
    else p.res(msg.result?.result?.value);
  });
  const opened = new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error("websocket open timeout")), 5000);
    ws.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        res();
      },
      { once: true },
    );
    ws.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        rej(new Error("websocket error"));
      },
      { once: true },
    );
  });
  const evaluate = async (expression) => {
    await opened;
    return new Promise((res, rej) => {
      const n = ++id;
      const timer = setTimeout(() => {
        pending.delete(n);
        rej(new Error("timeout"));
      }, 15000);
      pending.set(n, {
        res: (v) => {
          clearTimeout(timer);
          res(v);
        },
        rej: (e) => {
          clearTimeout(timer);
          rej(e);
        },
      });
      ws.send(JSON.stringify({ id: n, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
    });
  };
  return { evaluate, close: () => ws.close() };
}

function readTomb() {
  try {
    const t = JSON.parse(fs.readFileSync(TOMB, "utf8"));
    if (t && Array.isArray(t.pending)) return t;
  } catch (e) {}
  return null;
}

function writeTomb(t) {
  fs.writeFileSync(TOMB + ".tmp", JSON.stringify(t));
  fs.renameSync(TOMB + ".tmp", TOMB);
}

function exists(f) {
  try {
    fs.lstatSync(f);
    return true;
  } catch (e) {
    return e.code !== "ENOENT";
  }
}

function settle() {
  const t = readTomb();
  if (!t) return true;
  const left = t.pending.filter((f) => !removeQuietly(f) || exists(f));
  if (left.length !== t.pending.length) {
    t.pending = left;
    writeTomb(t);
  }
  if (left.length) console.log(`forget ${t.key}: still to delete: ${left.join(", ")}`);
  return !left.length;
}

function forget(key, session, gen) {
  writeTomb({ key, session, gen, pending: [USER_FILE, USER_FILE + ".bak", USER_FILE + ".tmp", LOG_FILE, LOG_FILE + ".1"] });
  return settle();
}

function resolve(files) {
  const t = readTomb();
  if (!t || !files.some((f) => t.pending.includes(f))) return;
  t.pending = t.pending.filter((f) => !files.includes(f));
  writeTomb(t);
}

function loadUserWords() {
  const skip = readTomb()?.pending ?? [];
  for (const f of [USER_FILE, USER_FILE + ".bak"]) {
    if (skip.includes(f)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(f, "utf8"));
      if (data && typeof data === "object") return data;
    } catch (e) {}
  }
  return null;
}

let savedForget = null;

function saveUserWords(json, session) {
  const data = JSON.parse(json);
  const rev = data.rev;
  const gen = data.forgetGen ?? 0;
  delete data.rev;
  delete data.forgetGen;
  const tomb = readTomb();
  const forgot = savedForget?.session === session && gen !== savedForget.gen;
  if (forgot || tomb?.pending.includes(USER_FILE)) removeQuietly(USER_FILE + ".bak");
  else if (fs.existsSync(USER_FILE)) fs.copyFileSync(USER_FILE, USER_FILE + ".bak");
  fs.writeFileSync(USER_FILE + ".tmp", JSON.stringify(data));
  fs.renameSync(USER_FILE + ".tmp", USER_FILE);
  savedForget = { session, gen };
  if (tomb && (tomb.session !== session || gen >= tomb.gen)) resolve([USER_FILE, USER_FILE + ".tmp"]);
  return { rev, gen };
}

async function handleRequests(cdp, session) {
  const req = await cdp.evaluate(`window.__oskTrackpadFix?.takeRequests?.() ?? null`);
  if (!req) return;
  const r = JSON.parse(req);
  let ok = true;
  if (r.removeBackup) {
    const key = `${session}:${r.rev}`;
    const gen = Number(await cdp.evaluate(`window.__oskTrackpadFix?.forgetGen ?? 0`));
    try {
      ok = readTomb()?.key === key ? settle() : forget(key, session, gen);
    } catch (e) {
      console.log(`forget failed: ${e.message}`);
      ok = false;
    }
  }
  if (r.clearLog) {
    ok = removeQuietly(LOG_FILE) && ok;
    ok = removeQuietly(LOG_FILE + ".1") && ok;
  }
  if (!ok) {
    console.log(`request rev ${r.rev} not carried out; offered again next cycle`);
    return;
  }
  if (Number.isFinite(r.rev)) await cdp.evaluate(`window.__oskTrackpadFix?.ackRequests?.(${r.rev}) ?? 0`);
}

function appendLog(lines) {
  if (!lines.length) return;
  try {
    if (fs.statSync(LOG_FILE).size >= LOG_MAX) fs.renameSync(LOG_FILE, LOG_FILE + ".1");
  } catch (e) {}
  fs.appendFileSync(LOG_FILE, lines.map((l) => l + "\n").join(""));
}

function removeQuietly(f) {
  try {
    fs.unlinkSync(f);
  } catch (e) {
    if (e.code !== "ENOENT") return false;
  }
  return true;
}

function installInfo() {
  try {
    return JSON.parse(fs.readFileSync(INSTALLED, "utf8"));
  } catch (e) {
    return null;
  }
}

async function cycle(wsUrl) {
  const cdp = connect(wsUrl);
  try {
    const have = JSON.parse(
      await cdp.evaluate(
        `JSON.stringify({ w: globalThis.__oskWords?.version ?? 0, e: globalThis.__oskSwipeEngine?.version ?? 0, l: globalThis.__oskLM?.version ?? 0, m: globalThis.__oskModes?.version ?? 0, u: !!globalThis.__oskUserWordsLoaded })`,
      ),
    );
    if (have.w !== WORDS_V) await cdp.evaluate(words + "\n;0");
    if (lm && have.l !== LM_V) await cdp.evaluate(lm + "\n;0");
    if (have.e !== ENGINE_V) await cdp.evaluate(engine + "\n;0");
    if (modes && have.m !== MODES_V) await cdp.evaluate(modes + "\n;0");
    if (!have.u)
      await cdp.evaluate(`globalThis.__oskUserWords = ${JSON.stringify(loadUserWords())}; globalThis.__oskUserWordsLoaded = true; 0`);
    await cdp.evaluate(`globalThis.__oskInstall = ${JSON.stringify(installInfo())}; 0`);
    const status = await cdp.evaluate(patch);
    const session = String(
      await cdp.evaluate(
        `window.__oskTrackpadFix ? (window.__oskTrackpadFix.hostAcks = true, window.__oskTrackpadFix.hostSession ??= Date.now().toString(36) + Math.random().toString(36).slice(2)) : ""`,
      ),
    );
    try {
      if (readTomb()?.pending.length) settle();
    } catch (e) {
      console.log(`forget retry failed: ${e.message}`);
    }
    await handleRequests(cdp, session);
    for (let i = 0; i < 3; i++) {
      const json = await cdp.evaluate(`window.__oskTrackpadFix?.takeUserWords?.() ?? null`);
      if (!json) break;
      let saved;
      try {
        saved = saveUserWords(json, session);
      } catch (e) {
        console.log(`saving user words failed: ${e.message}`);
        break;
      }
      const now = Number(await cdp.evaluate(`window.__oskTrackpadFix?.forgetGen ?? 0`));
      if (now !== saved.gen) {
        await handleRequests(cdp, session);
        continue;
      }
      if (Number.isFinite(saved.rev)) await cdp.evaluate(`window.__oskTrackpadFix?.ackUserWords?.(${saved.rev}) ?? 0`);
      break;
    }
    const log = await cdp.evaluate(`window.__oskTrackpadFix?.takeTypingLog?.() ?? null`);
    if (log) {
      try {
        const { upTo, lines } = JSON.parse(log);
        appendLog(lines);
        await cdp.evaluate(`window.__oskTrackpadFix?.ackTypingLog?.(${Number(upTo)}) ?? 0`);
      } catch (e) {
        console.log(`writing the typing log failed: ${e.message}`);
      }
    }
    return status;
  } finally {
    cdp.close();
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

function tryLock() {
  try {
    fs.writeFileSync(LOCK, String(process.pid), { flag: "wx" });
    return true;
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  const pid = Number(fs.readFileSync(LOCK, "utf8"));
  if (pid && pid !== process.pid && pidAlive(pid)) return false;
  removeQuietly(LOCK);
  return tryLock();
}

function unlock() {
  try {
    if (Number(fs.readFileSync(LOCK, "utf8")) === process.pid) fs.unlinkSync(LOCK);
  } catch (e) {}
}

process.on("exit", unlock);
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => process.exit(0));

while (!tryLock()) {
  const msg = `another injector holds ${LOCK}; waiting`;
  if (msg !== last) console.log(msg);
  last = msg;
  await sleep(Math.max(CYCLE_MS, 1000) * 6);
}

let failures = 0;
for (;;) {
  let status;
  try {
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) })).json();
    const t = targets.find((x) => x.title === "SharedJSContext");
    status = t ? await cycle(t.webSocketDebuggerUrl) : "no SharedJSContext";
    failures = t ? 0 : failures + 1;
  } catch (e) {
    status = `error: ${e.message}`;
    failures++;
  }
  if (status !== last) console.log(status);
  last = status;
  await sleep(failures ? Math.min(12 * CYCLE_MS, CYCLE_MS * 2 ** Math.min(failures - 1, 4)) : CYCLE_MS);
}
