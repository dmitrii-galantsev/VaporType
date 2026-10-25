import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { build } from "esbuild";

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, "..");
const steamui = process.env.STEAMUI ?? path.join(root, ".steamui");
const keyboardTs = path.resolve(process.env.KEYBOARD_TS ?? path.join(root, "src", "keyboard.ts"));
const faultOnly = !!process.env.FAULT_ONLY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let failures = 0;
const check = (name, ok, detail = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures++;
};

if (!fs.existsSync(path.join(steamui, "library.js"))) {
  console.error(`no steamui files in ${steamui}; run scripts/fetch-steamui.sh first`);
  process.exit(2);
}
if (!fs.existsSync(path.join(root, "dist", "keyboard", "manifest.json"))) {
  console.error("dist/keyboard missing; run pnpm run build first");
  process.exit(2);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "vaportype-sim-"));
const overlay = path.join(work, "steamui");
fs.mkdirSync(overlay);
for (const name of fs.readdirSync(steamui)) fs.symlinkSync(path.join(steamui, name), path.join(overlay, name));
fs.symlinkSync(path.join(root, "dist"), path.join(overlay, "plugin-dist"));
process.env.STEAMUI = overlay;
const home = path.join(work, "home");
const brew = path.join(home, "homebrew");
const settingsDir = path.join(brew, "settings", "vaportype");
const runtimeDir = path.join(brew, "data", "vaportype");
const wordsFile = path.join(settingsDir, "user-words.json");
const prefsFile = path.join(settingsDir, "plugin-settings.json");
const logFile = path.join(runtimeDir, "typing-log.jsonl");
const removeFaults = path.join(work, "remove-faults.json");
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch (e) {
    return null;
  }
};
const writeJson = (f, v) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v));
};
fs.mkdirSync(home);
if (!faultOnly) {
  writeJson(wordsFile, { version: 1, words: { zorblax: { c: 3 } }, bigrams: {} });
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(logFile, '{"type":"word","committed":"old"}\n');
}

let backend = null;
async function startBackend() {
  const proc = spawn("python3", [path.join(here, "bridge.py")], {
    env: { ...process.env, HOME: home, VAPORTYPE_REMOVE_FAULTS: removeFaults },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const pending = new Map();
  let nextId = 0;
  await new Promise((resolve) => {
    readline.createInterface({ input: proc.stdout }).on("line", (line) => {
      const msg = JSON.parse(line);
      if (msg.ready) return resolve();
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.result);
    });
  });
  const call = (name, args) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      proc.stdin.write(JSON.stringify({ id, name, args }) + "\n");
    });
  const stop = () =>
    new Promise((resolve) => {
      proc.once("exit", resolve);
      proc.stdin.end();
    });
  backend = { call, stop };
}
await startBackend();

const bundle = await build({
  entryPoints: [keyboardTs],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "VaporType",
  alias: { "@decky/api": path.join(here, "decky-api-mock.js") },
  define: { "import.meta.url": JSON.stringify("https://steamloopback.host/plugin-dist/index.js") },
  logLevel: "error",
});
const pluginJs = bundle.outputFiles[0].text;

const { openSim } = await import(path.join(root, "keyboard", "sim", "run.mjs"));
const first = await openSim();
const browser = first.browser;
let page = first.page;
let errors = first.errors;
let bootErrors = errors.length;

async function preparePage(p) {
  await p.exposeFunction("__deckyBackend", (name, args) => backend.call(name, args));
  await p.evaluate(() => {
    window.__deckyFaults = {};
    window.__deckyCalls = [];
    window.__deckyCall = async (name, args) => {
      window.__deckyCalls.push({ name, t: Date.now(), line: String(["VaporType", name, ...args]), bytes: JSON.stringify(args).length });
      const fault = window.__deckyFaults[name];
      if (fault?.delay) await new Promise((r) => setTimeout(r, fault.delay));
      if (fault?.fail) throw new Error(`injected ${name} failure`);
      return window.__deckyBackend(name, args);
    };
    window.__fetchDelay = 0;
    const realFetch = window.fetch.bind(window);
    window.fetch = (url, opts) =>
      window.__fetchDelay && String(url).includes("/plugin-dist/keyboard/patch.js")
        ? new Promise((r) => setTimeout(r, window.__fetchDelay)).then(() => realFetch(url, opts))
        : realFetch(url, opts);
  });
  await p.evaluate(pluginJs);
  await p.evaluate(() => window.localStorage.clear());
}

async function newSteam() {
  ({ page, errors } = await openSim({ browser }));
  bootErrors = errors.length;
  await preparePage(page);
}

async function waitFor(fn, ms, ...args) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await page.evaluate(fn, ...args).catch(() => null);
    if (v) return v;
    if (Date.now() > until) return null;
    await sleep(200);
  }
}
const status = () => page.evaluate(() => window.__oskTrackpadFix?.status?.() ?? "none");
const running = () =>
  page.evaluate(() => ({
    patched: !!window.__oskTrackpadFix && !window.__oskTrackpadFix.stopped,
    esc: !!document.querySelector('[data-key="Escape"]'),
  }));
const patched = () =>
  waitFor(() => /keyboard=patched/.test(window.__oskTrackpadFix?.status?.() ?? "") && window.__oskTrackpadFix.status(), 15000);

async function padTap(key) {
  await page.evaluate((key) => {
    const el = [...document.querySelectorAll("[data-key]")].find(
      (e) => e.getAttribute("data-key") === key && e.getBoundingClientRect().width > 0,
    );
    const r = el.getBoundingClientRect();
    let kb;
    for (const node of document.querySelectorAll("[data-key]")) {
      const fk = Object.keys(node).find((k) => k.startsWith("__reactFiber"));
      for (let f = fk && node[fk]; f; f = f.return)
        if (typeof f.stateNode?.HandleTrackpadClick === "function") {
          kb = f.stateNode;
          break;
        }
      if (kb) break;
    }
    Object.assign(kb.m_rightTrackpad, { active: true, x: r.left + r.width / 2, y: r.top + r.height / 2 });
    window.__tapKb = kb;
  }, key);
  const fire = (type) =>
    page.evaluate(
      (type) =>
        document
          .querySelector("[data-key]")
          .dispatchEvent(new CustomEvent(type, { bubbles: true, cancelable: true, detail: { button: 22, source: 1, is_repeat: false } })),
      type,
    );
  await fire("vgp_onbuttondown");
  await sleep(20);
  await fire("vgp_onbuttonup");
  await page.evaluate(() => {
    window.__tapKb.m_rightTrackpad.active = false;
  });
  await sleep(80);
}

function newErrors() {
  return errors
    .slice(bootErrors)
    .filter(
      (e) =>
        !/^404 \/(?!plugin-dist)|^Failed to load resource: .* 404|^Transport Error: no (default registry|transport) is available/.test(e),
    );
}

async function faultTests() {
  await newSteam();
  await page.evaluate(() => {
    window.__fetchDelay = 2500;
    void VaporType.start();
  });
  await sleep(600);
  await page.evaluate(() => VaporType.shutdown());
  await sleep(3500);
  const afterShutdown = await running();
  check(
    "fault: unload while the keyboard files are still loading leaves no patch running",
    !afterShutdown.patched && !afterShutdown.esc,
    JSON.stringify(afterShutdown),
  );

  await newSteam();
  await page.evaluate(() => {
    window.__fetchDelay = 2500;
    void VaporType.start();
  });
  await sleep(600);
  await page.evaluate(() => VaporType.setEnabled(false));
  await sleep(3500);
  const afterDisable = await running();
  check(
    "fault: disable while the keyboard files are still loading leaves no patch running",
    !afterDisable.patched && !afterDisable.esc,
    JSON.stringify(afterDisable),
  );
  await page.evaluate(() => VaporType.setEnabled(true));
  await patched();
  await page.evaluate(() => VaporType.shutdown());
}

if (faultOnly) {
  await faultTests();
} else {
  await preparePage(page);
  await page.evaluate(() => VaporType.start());
  const s1 = await patched();
  check("plugin loads the keyboard files and patches Steam's keyboard", !!s1, s1 ?? (await status()));
  const versions = await page.evaluate(() => ({
    words: window.__oskWords?.version,
    lm: window.__oskLM?.version,
    engine: window.__oskSwipeEngine?.version,
    modes: window.__oskModes?.version,
    install: window.__oskInstall,
  }));
  const manifest = readJson(path.join(root, "dist", "keyboard", "manifest.json"));
  check(
    "loaded versions match the manifest",
    versions.words === manifest["swipe/words.js"].version &&
      versions.lm === manifest["swipe/lm.js"].version &&
      versions.engine === manifest["swipe/engine.js"].version &&
      versions.modes === manifest["modes.js"].version,
    JSON.stringify(versions),
  );
  check(
    "install info comes from the backend",
    versions.install?.via === "decky" && !!versions.install?.plugin,
    JSON.stringify(versions.install),
  );
  const learned = await page.evaluate(() => Object.keys(window.__oskEngine?.exportUser?.().words ?? {}));
  check("saved words reach the engine", learned.includes("zorblax"), learned.join(","));

  const card = await waitFor(() => !!document.querySelector('[data-key="OSKSet_consent_on"]'), 5000);
  const before = await page.evaluate(() => ({ consent: window.__oskSettings?.consent, panelOpen: window.__oskTrackpadFix.panel?.open }));
  check("first use shows the consent card with learning off until answered", !!card && before.consent === false, JSON.stringify(before));
  await padTap("OSKSet_consent_on");
  const answered = await waitFor(
    () => window.__oskSettings?.consent === true && !document.querySelector('[data-key="OSKSet_consent_on"]'),
    5000,
  );
  check("Turn on on the card sets consent and closes it", !!answered);
  await sleep(300);
  await page.evaluate(() => {
    window.__oskTrackpadFix.setSetting("typingLog", true);
    window.__oskTrackpadFix.setSetting("autocorrect", false);
  });
  for (const k of ["h", "e", "l", "l", "o", " ", "t", "h", "e", "r", "e", " "]) await padTap(k);
  await page.evaluate(() => VaporType.syncNow());
  const saved = readJson(wordsFile);
  check(
    "settings saved through the backend, with consent and logFile",
    saved?.settings?.typingLog === true &&
      saved?.settings?.autocorrect === false &&
      saved?.settings?.consent === true &&
      "logFile" in (saved?.settings ?? {}),
    JSON.stringify(saved?.settings ?? null),
  );
  check("learned words saved", !!saved?.words?.hello, Object.keys(saved?.words ?? {}).join(","));
  const typed = await page.evaluate(() =>
    window.__keyLog
      .filter((x) => x[1] === "text")
      .map((x) => x[2])
      .join(""),
  );
  check("taps typed through Steam's text path", typed.includes("hello there"), JSON.stringify(typed));
  const logLines = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split("\n") : [];
  check(
    "typing log appended",
    logLines.some((l) => l.includes('"committed":"hello"')),
    `${logLines.length} lines`,
  );

  await page.evaluate(() => VaporType.setEnabled(false));
  const off = await running();
  check("disable stops the patch and restores Steam's keyboard", !off.patched && !off.esc, JSON.stringify(off));
  check("disabled state persisted", readJson(prefsFile)?.enabled === false);
  await page.evaluate(() => VaporType.setEnabled(true));
  check("enable re-injects", !!(await patched()), await status());

  await page.evaluate(() => {
    window.__deckyFaults.set_enabled = { fail: true };
  });
  await page.evaluate(() => VaporType.setEnabled(false));
  const failedOff = await running();
  const failedErr = await page.evaluate(() => VaporType.errorText());
  check(
    "disable with a failing backend still tears down locally",
    !failedOff.patched && !failedOff.esc && /enabled setting/.test(failedErr ?? ""),
    `${JSON.stringify(failedOff)} ${failedErr}`,
  );
  await page.evaluate(() => {
    window.__deckyFaults.set_enabled = null;
  });
  await page.evaluate(() => VaporType.setEnabled(true));
  await patched();

  await page.close();
  await newSteam();
  await page.evaluate(() => VaporType.start());
  await patched();
  await sleep(800);
  const noCard = await page.evaluate(
    () => !document.querySelector('[data-key="OSKSet_consent_on"]') && window.__oskSettings?.consent === true,
  );
  check("after a Steam restart the consent card does not come back", noCard);
  const restored = await page.evaluate(() => ({
    settings: window.__oskSettings,
    words: Object.keys(window.__oskEngine?.exportUser?.().words ?? {}),
  }));
  check(
    "after a Steam restart settings come back from the backend file",
    restored.settings?.autocorrect === false && restored.settings?.typingLog === true,
    JSON.stringify(restored.settings),
  );
  check("after a Steam restart learned words come back", restored.words.includes("hello"), restored.words.join(","));

  await page.evaluate(() => {
    window.__oskEngine.learn("snorkelwax");
    window.__oskEngine.learn("snorkelwax");
    window.__oskEngine.__dirty = true;
    window.__deckyFaults.save_user_words = { delay: 1500 };
  });
  await page.evaluate(() => Promise.all([VaporType.syncNow(), VaporType.forgetEverything()]));
  await page.evaluate(() => {
    window.__deckyFaults.save_user_words = null;
  });
  await page.evaluate(() => VaporType.syncNow());
  const forgotten = readJson(wordsFile);
  check(
    "a slow save racing forget does not bring words back",
    !!forgotten && Object.keys(forgotten.words ?? {}).length === 0,
    JSON.stringify(forgotten?.words ?? null),
  );
  check("forget deletes the backup and typing log", !fs.existsSync(wordsFile + ".bak") && !fs.existsSync(logFile));
  const epoch = readJson(prefsFile)?.epoch ?? 0;
  const stale = await backend.call("save_user_words", [
    JSON.stringify({ version: 1, words: { ghost: { c: 5 } }, bigrams: {}, rev: 99 }),
    epoch - 1,
  ]);
  check(
    "backend refuses a save from before the forget",
    stale.saved === false && !readJson(wordsFile)?.words?.ghost,
    JSON.stringify(stale),
  );

  await page.evaluate(() => {
    window.__oskEngine.learn("frobnitz");
    window.__oskEngine.learn("frobnitz");
    window.__oskEngine.__dirty = true;
  });
  await page.evaluate(() => VaporType.syncNow());
  await page.evaluate(() => {
    window.__oskEngine.learn("wibblet");
    window.__oskEngine.learn("wibblet");
    window.__oskEngine.__dirty = true;
    window.__deckyFaults.save_user_words = { delay: 1500 };
  });
  const genBefore = await page.evaluate(() => window.__oskTrackpadFix.forgetGen ?? 0);
  await page.evaluate(async () => {
    const saving = VaporType.syncNow();
    await new Promise((r) => setTimeout(r, 300));
    window.__oskTrackpadFix.forgetAll();
    await saving;
  });
  await page.evaluate(() => {
    window.__deckyFaults.save_user_words = null;
  });
  const race = readJson(wordsFile);
  const pendingAfter = await page.evaluate(() => ({
    req: window.__oskTrackpadFix.takeRequests(),
    words: window.__oskTrackpadFix.takeUserWords(),
    gen: window.__oskTrackpadFix.forgetGen,
  }));
  check(
    "keyboard forget during an in-flight save: the forget wins",
    !!race && Object.keys(race.words ?? {}).length === 0 && !fs.existsSync(wordsFile + ".bak") && pendingAfter.gen === genBefore + 1,
    JSON.stringify({ words: Object.keys(race?.words ?? {}), bak: fs.existsSync(wordsFile + ".bak"), gen: pendingAfter.gen }),
  );
  check(
    "that forget's request and the empty save were acknowledged",
    pendingAfter.req === null && pendingAfter.words === null,
    JSON.stringify(pendingAfter),
  );
  check("forgetGen is not written to the file", !("forgetGen" in (race ?? {})) && !("rev" in (race ?? {})));

  await page.evaluate(() => window.__oskTrackpadFix.setSetting("typingLog", true));
  await page.evaluate(() => VaporType.syncNow());
  for (const k of ["s", "e", "c", "r", "e", "t", " "]) await padTap(k);
  await page.evaluate(() => {
    window.__oskTrackpadFix.flushLog();
    window.__oskEngine.__dirty = true;
    window.__deckyFaults.save_user_words = { delay: 1500 };
  });
  await page.evaluate(async () => {
    const saving = VaporType.syncNow();
    await new Promise((r) => setTimeout(r, 300));
    window.__oskTrackpadFix.forgetAll();
    await saving;
  });
  await page.evaluate(() => {
    window.__deckyFaults.save_user_words = null;
  });
  await page.evaluate(() => VaporType.syncNow());
  const logAfter = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
  check(
    "keyboard forget during an in-flight save does not bring back the typing log captured before it",
    !logAfter.includes('"committed":"secret"'),
    `${logAfter.split("\n").filter(Boolean).length} lines`,
  );
  const epochNow = readJson(prefsFile)?.epoch ?? 0;
  const staleLog = await backend.call("append_typing_log", [['{"type":"word","committed":"stale"}'], epochNow - 1]);
  check(
    "backend refuses a typing-log append from before the last forget",
    staleLog.saved === false && !(fs.existsSync(logFile) && fs.readFileSync(logFile, "utf8").includes("stale")),
    JSON.stringify(staleLog),
  );

  await page.evaluate(() => {
    window.__oskEngine.learn("glimmerq");
    window.__oskEngine.learn("glimmerq");
    window.__oskEngine.__dirty = true;
  });
  await page.evaluate(() => VaporType.syncNow());
  fs.rmSync(wordsFile + ".bak", { force: true });
  fs.mkdirSync(path.join(wordsFile + ".bak", "stuck"), { recursive: true });
  const epochBeforeStuck = readJson(prefsFile)?.epoch ?? 0;
  await page.evaluate(() => window.__oskTrackpadFix.forgetAll());
  const stuck = [];
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => VaporType.syncNow());
    stuck.push(
      await page.evaluate(() => ({
        pending: JSON.parse(window.__oskTrackpadFix.takeRequests() ?? "null"),
        host: window.__oskTrackpadFix.hostAcks === true,
        err: VaporType.errorText(),
      })),
    );
  }
  const stuckWords = readJson(wordsFile);
  check(
    "while a deletion keeps failing the forget request stays pending (hostAcks) and is not acknowledged",
    stuck.every((x) => x.pending?.removeBackup === true && x.host && /could not be deleted/.test(x.err ?? "")),
    JSON.stringify(stuck.map((x) => !!x.pending?.removeBackup)),
  );
  check(
    "retries do not wipe the saved state again or bump the epoch again",
    !!stuckWords &&
      Object.keys(stuckWords.words ?? {}).length === 0 &&
      !!stuckWords.settings &&
      (readJson(prefsFile)?.epoch ?? 0) === epochBeforeStuck + 1,
    `epoch ${readJson(prefsFile)?.epoch} vs ${epochBeforeStuck}`,
  );
  fs.rmSync(wordsFile + ".bak", { recursive: true, force: true });
  fs.writeFileSync(wordsFile + ".bak", "{}");
  await page.evaluate(() => VaporType.syncNow());
  const cleared = await page.evaluate(() => ({ pending: window.__oskTrackpadFix.takeRequests(), err: VaporType.errorText() }));
  check(
    "once the deletion succeeds the request is acknowledged",
    cleared.pending === null && !fs.existsSync(wordsFile + ".bak") && !cleared.err,
    JSON.stringify(cleared),
  );

  fs.rmSync(wordsFile, { force: true });
  fs.mkdirSync(path.join(wordsFile, "stuck"), { recursive: true });
  await page.evaluate(() => window.__oskTrackpadFix.forgetAll());
  const primaryStuck = [];
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => VaporType.syncNow());
    primaryStuck.push(await page.evaluate(() => JSON.parse(window.__oskTrackpadFix.takeRequests() ?? "null")?.removeBackup === true));
  }
  check(
    "a forget whose primary file cannot be deleted stays pending on every retry",
    primaryStuck.every(Boolean),
    JSON.stringify(primaryStuck),
  );
  fs.rmSync(wordsFile, { recursive: true, force: true });
  writeJson(wordsFile, { version: 1, words: { secretold: { c: 9 } }, bigrams: {} });
  await page.evaluate(() => {
    window.__deckyFaults.save_user_words = { fail: true };
  });
  await page.evaluate(() => VaporType.syncNow());
  const afterRetry = await page.evaluate(() => window.__oskTrackpadFix.takeRequests());
  const oldStill = fs.existsSync(wordsFile) && fs.readFileSync(wordsFile, "utf8").includes("secretold");
  check(
    "the retry deletes the old primary file before acknowledging, even when saving the replacement fails",
    afterRetry === null && !oldStill,
    JSON.stringify({ pending: afterRetry, oldStill }),
  );
  await page.evaluate(() => {
    window.__deckyFaults.save_user_words = null;
  });
  await page.evaluate(() => VaporType.syncNow());
  const replaced = readJson(wordsFile);
  check(
    "the next save writes the post-forget state",
    !!replaced && Object.keys(replaced.words ?? {}).length === 0 && !!replaced.settings,
    JSON.stringify(replaced?.words ?? null),
  );

  await page.evaluate(() => {
    window.__oskEngine.learn("secretword");
    window.__oskEngine.learn("secretword");
    window.__oskEngine.__dirty = true;
  });
  await page.evaluate(() => VaporType.syncNow());
  writeJson(removeFaults, [wordsFile]);
  await page.evaluate(() => {
    window.__deckyFaults.save_user_words = { fail: true };
  });
  await page.evaluate(() => window.__oskTrackpadFix.forgetAll());
  await page.evaluate(() => VaporType.syncNow());
  const stillThere = fs.readFileSync(wordsFile, "utf8").includes("secretword");
  const pendingFault = await page.evaluate(() => JSON.parse(window.__oskTrackpadFix.takeRequests() ?? "null")?.removeBackup === true);
  check("with the primary file undeletable the forget stays pending", stillThere && pendingFault);
  await page.evaluate(() => VaporType.shutdown());
  await page.close();
  await backend.stop();
  await startBackend();
  await newSteam();
  await page.evaluate(() => VaporType.start());
  await patched();
  const afterRestart = await page.evaluate(() => ({
    words: Object.keys(window.__oskEngine?.exportUser?.().words ?? {}),
    handed: window.__oskUserWords,
  }));
  check(
    "a Steam and backend restart before the fault clears loads no forgotten words",
    !afterRestart.words.includes("secretword") && afterRestart.handed === null,
    JSON.stringify(afterRestart.words),
  );
  fs.rmSync(removeFaults);
  await page.evaluate(() => {
    window.__oskEngine.learn("afterword");
    window.__oskEngine.__dirty = true;
  });
  await page.evaluate(() => VaporType.syncNow());
  const healed = fs.readFileSync(wordsFile, "utf8");
  check(
    "after the fault clears the file holds only post-forget data",
    !healed.includes("secretword") && (readJson(prefsFile)?.forget?.pending ?? []).length === 0,
    healed.slice(0, 80),
  );

  await page.evaluate(() => {
    window.__oskTrackpadFix.setSetting("autocorrect", true);
    window.__oskTrackpadFix.forgetAll();
  });
  await page.evaluate(() => VaporType.syncNow());
  check(
    "keyboard-panel forget is handled as a forget",
    !fs.existsSync(wordsFile + ".bak") && Object.keys(readJson(wordsFile)?.words ?? {}).length === 0,
    JSON.stringify(readJson(wordsFile)?.words ?? null),
  );

  const WORDS = ["hi", "ok", "so", "we", "go", "up", "me", "it", "is", "do"];
  const quoted = new RegExp(`"(${WORDS.join("|")})"`);
  const callsSince = (t0) => page.evaluate((t0) => window.__deckyCalls.filter((c) => c.t >= t0), t0);
  const typeWords = async (n) => {
    for (let i = 0; i < n; i++) for (const k of [...WORDS[i % WORDS.length], " "]) await padTap(k);
  };
  const hide = () => page.evaluate(() => window.__sim.vkm.SetVirtualKeyboardHidden());
  const show = async () => {
    await page.evaluate(() => window.__sim.vkm.SetVirtualKeyboardVisible());
    await patched();
    await sleep(300);
  };
  await page.evaluate(() => {
    window.__oskTrackpadFix.setSetting("typingLog", false);
    window.__oskTrackpadFix.setSetting("consent", true);
    window.__oskTrackpadFix.setSetting("learn", true);
    window.__oskTrackpadFix.closeSettings();
  });
  await waitFor(() => !window.__oskTrackpadFix.panel?.open && window.__oskTrackpadFix.effective("learn") === true, 3000);
  await page.evaluate(() => VaporType.syncNow());
  const logBefore = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
  const t50 = Date.now();
  await typeWords(50);
  const typedFor = Date.now() - t50;
  const whileOpen = await callsSince(t50);
  await hide();
  const flushed = await waitFor((t0) => window.__deckyCalls.some((c) => c.t >= t0 && c.name === "save_user_words"), 9000, t50);
  const all50 = await callsSince(t50);
  const saves50 = all50.filter((c) => c.name === "save_user_words");
  const words50 = readJson(wordsFile)?.words ?? {};
  check(
    "50 typed words with the keyboard open make no save call; hiding the keyboard flushes once",
    typedFor < 55000 && whileOpen.filter((c) => c.name === "save_user_words").length === 0 && !!flushed && saves50.length <= 2,
    `typed in ${typedFor} ms, ${whileOpen.length} calls while open, ${saves50.length} saves, ${saves50.reduce((a, c) => a + c.bytes, 0)} bytes ${all50.map((c) => `${c.name}@${c.t - t50}:${c.bytes}`).join(" ")}`,
  );
  check(
    "the flush on hide writes the learned words",
    WORDS.every((w) => (words50[w]?.c ?? 0) > 0),
    Object.keys(words50).length + " words",
  );
  check(
    "with the typing log off no append call is made and the log file does not grow",
    !all50.some((c) => c.name === "append_typing_log") && (fs.existsSync(logFile) ? fs.statSync(logFile).size : 0) === logBefore,
  );
  check(
    "no backend call carries a typed word in Decky's logged form",
    !all50.some((c) => quoted.test(c.line) || c.line.includes('"words"')),
    all50.map((c) => c.line.slice(0, 60)).join(" | "),
  );

  await show();
  await page.evaluate(() => window.__oskTrackpadFix.setSetting("typingLog", true));
  await page.evaluate(() => VaporType.syncNow());
  const t10 = Date.now();
  await typeWords(10);
  await hide();
  await waitFor((t0) => window.__deckyCalls.some((c) => c.t >= t0 && c.name === "append_typing_log"), 9000, t10);
  await sleep(5500);
  const all10 = await callsSince(t10);
  const appends = all10.filter((c) => c.name === "append_typing_log");
  const logText = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
  check(
    "with the typing log on, one keyboard session is one append call",
    appends.length === 1 && WORDS.every((w) => logText.includes(`"committed":"${w}"`)),
    `${appends.length} appends, ${all10.filter((c) => c.name === "save_user_words").length} saves`,
  );
  check(
    "the typing-log batch and the words reach Decky's log only as objects",
    !all10.some((c) => quoted.test(c.line) || c.line.includes("committed")),
    all10.map((c) => c.line.slice(0, 60)).join(" | "),
  );

  await show();
  await page.evaluate(() => VaporType.syncNow());
  const tu = Date.now();
  await typeWords(3);
  await page.evaluate(() => VaporType.shutdown());
  const unload = await waitFor((t0) => window.__deckyCalls.some((c) => c.t >= t0 && c.name === "save_user_words"), 5000, tu);
  check("plugin unload flushes unsaved words", !!unload);
  const down = await running();
  check("plugin unload stops the patch", !down.patched && !down.esc, JSON.stringify(down));
  const pageErrors = newErrors();
  check("no page errors after the plugin started", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

  await faultTests();
}

await browser.close();
await backend.stop();
fs.rmSync(work, { recursive: true, force: true });
console.log(results.join("\n"));
console.log(failures ? `${failures} failed` : "ALL PASS");
process.exit(failures ? 1 : 0);
