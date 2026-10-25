import { callable } from "@decky/api";

export type Install = { date: string | null; via: string; decky: string; plugin?: string | null };

export type BackendState = {
  userWords: unknown;
  enabled: boolean;
  epoch: number;
  install: Install;
};

export type OskFix = {
  version: number;
  stopped?: boolean;
  unsupported?: string | null;
  status: () => string;
  versionLine?: () => string;
  stop: () => void;
  setSetting: (name: string, value: unknown) => void;
  openSettings: () => boolean;
  forgetAll: () => void;
  flushLog?: () => void;
  keyboardOpen?: () => boolean;
  typingLog?: { out?: unknown[] };
  takeUserWords?: () => string | null;
  ackUserWords?: (rev: number) => number;
  takeTypingLog?: () => string | null;
  ackTypingLog?: (upTo: number) => number;
  takeRequests?: () => string | null;
  ackRequests?: (rev: number) => number;
  forgetGen?: number;
  hostAcks?: boolean;
};

type Saved = { saved: boolean; rev?: number | null; epoch: number };
type Batch = { fix: OskFix; epoch: number; gen: number; requests: string | null; words: string | null; log: string | null };

const loadState = callable<[], BackendState>("load_state");
const saveUserWords = callable<[payload: object, epoch: number], Saved>("save_user_words");
const appendTypingLog = callable<[batch: { lines: string[] }, epoch: number], Saved>("append_typing_log");
const handleRequests = callable<[payload: string, session: string], { epoch: number; rev?: number | null; ok: boolean }>("handle_requests");
const forgetAllFiles = callable<[], { epoch: number; ok: boolean }>("forget_all");
const setEnabledBackend = callable<[enabled: boolean], boolean>("set_enabled");

const FILES = ["swipe/words.js", "swipe/lm.js", "swipe/engine.js", "modes.js", "patch.js"] as const;
type File = (typeof FILES)[number];

const PRELUDE: { file: File; global: string; pattern: RegExp }[] = [
  { file: "swipe/words.js", global: "__oskWords", pattern: /version: (\d+)/ },
  { file: "swipe/lm.js", global: "__oskLM", pattern: /version: (\d+)/ },
  { file: "swipe/engine.js", global: "__oskSwipeEngine", pattern: /const VERSION = (\d+)/ },
  { file: "modes.js", global: "__oskModes", pattern: /const VERSION = (\d+)/ },
];

const POLL_MS = 5000;
const SAVE_MS = 60000;
const LOG_BATCH = 200;
const LS_WORDS = "oskSwipeUserWords";
type OskWindow = Window & {
  __oskTrackpadFix?: OskFix;
  __oskUserWords?: unknown;
  __oskUserWordsLoaded?: boolean;
  __oskInstall?: Install | null;
  __vaporTypeSession?: string;
  __oskSettings?: Record<string, unknown>;
} & Record<string, { version?: number } | undefined>;
const g = window as unknown as OskWindow;
const base = new URL("keyboard/", import.meta.url);

let sources: Promise<Record<File, string>> | null = null;
let state: BackendState | null = null;
let lastError: string | null = null;
let generation = 0;
let disposed = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let lastSave = 0;
let wasOpen = false;

const evalGlobal = (src: string): unknown => (0, eval)(src);
const message = (e: unknown) => String((e as Error)?.message ?? e);
const live = (gen: number) => !disposed && gen === generation && state?.enabled === true;

function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

function fetchSources(): Promise<Record<File, string>> {
  if (!sources) {
    const p = Promise.all(
      FILES.map(async (f) => {
        const res = await fetch(new URL(f, base).href, { cache: "no-store" });
        if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
        return [f, await res.text()] as const;
      }),
    ).then((pairs) => Object.fromEntries(pairs) as Record<File, string>);
    p.catch(() => {
      if (sources === p) sources = null;
    });
    sources = p;
  }
  return sources;
}

export const fix = (): OskFix | undefined => g.__oskTrackpadFix;
export const backendState = () => state;
export const errorText = () => lastError;

async function inject(gen: number): Promise<string | null> {
  const src = await fetchSources();
  for (const { file, global, pattern } of PRELUDE) {
    if (!live(gen)) return null;
    const want = Number(pattern.exec(src[file])?.[1] ?? 0);
    if ((g[global]?.version ?? 0) !== want) evalGlobal(src[file] + "\n;0");
  }
  if (!live(gen)) return null;
  if (!g.__oskUserWordsLoaded) {
    g.__oskUserWords = state?.userWords ?? null;
    g.__oskUserWordsLoaded = true;
  }
  g.__oskInstall = state?.install ?? null;
  return String(evalGlobal(src["patch.js"]));
}

function due(f: OskFix, force: boolean): boolean {
  const now = Date.now();
  let open = false;
  try {
    open = f.keyboardOpen?.() === true;
  } catch (e) {
    lastError = message(e);
  }
  if (open && !wasOpen) lastSave = now;
  wasOpen = open;
  if (force || !open || now - lastSave >= SAVE_MS || (f.typingLog?.out?.length ?? 0) >= LOG_BATCH) {
    lastSave = now;
    return true;
  }
  return false;
}

function collect(f: OskFix, force = true): Batch {
  let save = true;
  try {
    f.hostAcks = true;
    save = due(f, force);
    if (save) f.flushLog?.();
  } catch (e) {
    lastError = message(e);
  }
  return {
    fix: f,
    epoch: state?.epoch ?? 0,
    gen: f.forgetGen ?? 0,
    requests: f.takeRequests?.() ?? null,
    words: save ? (f.takeUserWords?.() ?? null) : null,
    log: save ? (f.takeTypingLog?.() ?? null) : null,
  };
}

async function handle(f: OskFix, requests: string): Promise<number> {
  g.__vaporTypeSession ??= `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const r = await handleRequests(requests, String(g.__vaporTypeSession));
  if (state) state.epoch = r.epoch;
  const rev = (JSON.parse(requests) as { rev?: unknown }).rev;
  if (!r.ok) lastError = "some files could not be deleted; retrying";
  else if (typeof rev === "number") f.ackRequests?.(rev);
  return r.epoch;
}

const forgotSince = (f: OskFix, gen: number) => (f.forgetGen ?? 0) !== gen;

async function persist(b: Batch): Promise<void> {
  if (!state) return;
  const f = b.fix;
  try {
    lastError = null;
    let epoch = b.epoch;
    if (b.requests) epoch = await handle(f, b.requests);
    const logEpoch = epoch;
    let words = b.words;
    let gen = b.gen;
    for (let i = 0; words && i < 3; i++) {
      const r = await saveUserWords(JSON.parse(words) as object, epoch);
      if (state) state.epoch = r.epoch;
      if (r.saved && !forgotSince(f, gen)) {
        if (typeof r.rev === "number") f.ackUserWords?.(r.rev);
        break;
      }
      const req = f.takeRequests?.();
      epoch = req ? await handle(f, req) : r.epoch;
      gen = f.forgetGen ?? 0;
      words = f.takeUserWords?.() ?? null;
    }
    if (b.log && !forgotSince(f, b.gen)) {
      const { upTo, lines } = JSON.parse(b.log) as { upTo: number; lines: string[] };
      const r = await appendTypingLog({ lines }, logEpoch);
      if (state) state.epoch = r.epoch;
      if (r.saved || r.epoch !== logEpoch) f.ackTypingLog?.(Number(upTo));
    }
  } catch (e) {
    lastError = `saving failed: ${message(e)}`;
  }
}

async function tick(gen: number): Promise<void> {
  if (!live(gen)) return;
  try {
    const f = fix();
    if (!f || (f.stopped && !f.unsupported)) await inject(gen);
  } catch (e) {
    lastError = `loading failed: ${message(e)}`;
  }
  if (!live(gen)) return;
  const f = fix();
  if (f) await persist(collect(f, false));
}

function cancelPoll() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}

function schedule(gen: number) {
  cancelPoll();
  if (!live(gen)) return;
  pollTimer = setTimeout(() => {
    pollTimer = null;
    void serial(() => tick(gen)).finally(() => {
      if (live(gen) && !pollTimer) schedule(gen);
    });
  }, POLL_MS);
}

function stopLocal(): Promise<void> {
  const f = fix();
  if (!f) return Promise.resolve();
  const batch = collect(f);
  try {
    if (!f.stopped) f.stop();
  } catch (e) {
    lastError = `stop failed: ${message(e)}`;
  }
  return serial(() => persist(batch));
}

export async function start(): Promise<void> {
  const gen = generation;
  let loaded: BackendState;
  try {
    loaded = await loadState();
  } catch (e) {
    lastError = `backend unavailable: ${message(e)}`;
    loaded = {
      userWords: null,
      enabled: true,
      epoch: 0,
      install: { date: null, via: "decky", decky: "unknown" },
    };
  }
  if (disposed || gen !== generation) return;
  state = loaded;
  await serial(() => tick(gen));
  schedule(gen);
}

export function shutdown(): void {
  disposed = true;
  generation++;
  cancelPoll();
  void stopLocal();
}

export async function setEnabled(on: boolean): Promise<void> {
  if (disposed || !state) return;
  const gen = ++generation;
  cancelPoll();
  state.enabled = on;
  const stopped = on ? Promise.resolve() : stopLocal();
  try {
    await serial(() => setEnabledBackend(on));
  } catch (e) {
    lastError = `could not save the enabled setting: ${message(e)}`;
  }
  await stopped;
  if (!live(gen)) return;
  await serial(() => tick(gen));
  schedule(gen);
}

export function syncNow(): Promise<void> {
  return serial(async () => {
    const f = fix();
    if (f) await persist(collect(f));
  });
}

export function forgetEverything(): Promise<boolean> {
  return serial(async () => {
    const f = fix();
    let ok = true;
    try {
      f?.forgetAll();
    } catch (e) {
      lastError = `forget failed: ${message(e)}`;
      ok = false;
    }
    try {
      window.localStorage?.removeItem(LS_WORDS);
    } catch (e) {
      lastError = message(e);
      ok = false;
    }
    g.__oskUserWords = null;
    if (state) state.userWords = null;
    const r = await forgetAllFiles();
    if (state) state.epoch = r.epoch;
    if (!r.ok) {
      lastError = "some files could not be deleted; they will be retried";
      ok = false;
    }
    if (f) await persist(collect(f));
    return ok;
  });
}

export function settingsValue(name: string): unknown {
  return g.__oskSettings?.[name];
}

export function setSetting(name: string, value: unknown): boolean {
  const f = fix();
  if (!f || f.stopped) return false;
  f.setSetting(name, value);
  return true;
}

export function openSettingsWhenKeyboardOpens(ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const until = Date.now() + ms;
    const poll = setInterval(() => {
      const f = fix();
      if (disposed) {
        clearInterval(poll);
        resolve(false);
      } else if (f && !f.stopped && f.openSettings()) {
        clearInterval(poll);
        resolve(true);
      } else if (Date.now() > until) {
        clearInterval(poll);
        resolve(false);
      }
    }, 250);
  });
}
