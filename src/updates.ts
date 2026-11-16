import { callable, toaster } from "@decky/api";

export type UpdateStatus = {
  current: string | null;
  latest: string | null;
  available: boolean;
  htmlUrl: string | null;
  checkedAt: number | null;
  error: string | null;
  needsDecky: { version: string; url: string; sha256: string; reason: string } | null;
  failed: { version: string; error: string; at: number } | null;
  autoUpdate: boolean;
};
type InstallResult = { ok: boolean; error?: string; needsDecky?: boolean };
type UpdateRecord = { from: string | null; to: string; at: number; auto: boolean } | null;
type Deps = { keyboardOpen: () => boolean; save: () => Promise<void> };
type DeckyRouter = { call: (route: string, ...args: unknown[]) => Promise<unknown> };
type HostWindow = Window & {
  DeckyBackend?: DeckyRouter;
  __oskHost?: { updates?: HostUpdates };
};
export type HostUpdates = {
  status: () => { text: string; available: boolean };
  check: () => Promise<void>;
  install: () => Promise<void>;
};

const getStatus = callable<[], UpdateStatus>("get_update_status");
const checkUpdate = callable<[force: boolean], UpdateStatus>("check_update");
const installUpdate = callable<[version: string, auto: boolean], InstallResult>("install_update");
const setAutoUpdateBackend = callable<[on: boolean], boolean>("set_auto_update");
const takeUpdateRecord = callable<[], UpdateRecord>("take_update_record");

const FIRST_CHECK_MS = 60_000;
const CHECK_EVERY_MS = 3 * 3600_000;
const CLOSED_POLL_MS = 5_000;
const FAILED_RETRY_S = 12 * 3600;
const UPDATE_INSTALL = 2;
const PLUGIN = "VaporType";

const w = window as unknown as HostWindow;
let deps: Deps | null = null;
let status: UpdateStatus | null = null;
let busy: "checking" | "installing" | null = null;
let waiting = false;
let reloadPending = false;
let note: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let waitTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;
const message = (e: unknown) => String((e as Error)?.message ?? e);

function ago(sec: number | null): string {
  if (!sec) return "";
  const s = Math.max(0, Date.now() / 1000 - sec);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function updateStatus(): UpdateStatus | null {
  return status;
}

export function canInstall(): boolean {
  return !!status?.available && !!status.latest;
}

export function updateLine(): string {
  const cur = status?.current ?? "?";
  const latest = status?.latest ?? "";
  if (reloadPending) return `${latest} installed · finishes when the keyboard closes`;
  if (busy === "installing") return `Installing ${latest}…`;
  if (waiting) return `${latest} will install when the keyboard closes`;
  if (busy === "checking") return "Checking for updates…";
  if (note) return note;
  if (!status) return cur;
  if (status.available && status.needsDecky) return `${latest} available · install it with Decky`;
  if (status.available && status.failed) return `update to ${latest} failed: ${status.failed.error}`;
  if (status.available) return `${latest} available`;
  if (status.error) return `${cur} · could not check for updates ${ago(status.checkedAt)}`;
  if (!status.checkedAt) return `${cur} · not checked yet`;
  return `${cur} · up to date, checked ${ago(status.checkedAt)}`;
}

function wantsAuto(): boolean {
  if (!status?.available || !status.autoUpdate || status.needsDecky) return false;
  return !status.failed || Date.now() / 1000 - status.failed.at >= FAILED_RETRY_S;
}

export async function checkForUpdates(force = true): Promise<void> {
  if (busy) return;
  busy = "checking";
  note = null;
  try {
    status = await checkUpdate(force);
  } catch (e) {
    note = `could not check for updates: ${message(e)}`;
  } finally {
    busy = null;
  }
}

async function reload(): Promise<void> {
  const router = w.DeckyBackend;
  if (!router) {
    note = "updated; restart Steam to finish";
    return;
  }
  await router.call("loader/reload_plugin", PLUGIN);
}

function keyboardOpen(): boolean {
  try {
    return deps?.keyboardOpen() === true;
  } catch {
    return false;
  }
}

function untilClosed(): Promise<boolean> {
  return new Promise((resolve) => {
    const poll = () => {
      waitTimer = null;
      if (!running) return resolve(false);
      if (!keyboardOpen()) return resolve(true);
      waitTimer = setTimeout(poll, CLOSED_POLL_MS);
    };
    if (waitTimer) clearTimeout(waitTimer);
    waitTimer = setTimeout(poll, CLOSED_POLL_MS);
  });
}

async function apply(auto: boolean): Promise<void> {
  if (!deps || !status?.latest || busy) return;
  const version = status.latest;
  busy = "installing";
  note = null;
  try {
    await deps.save();
    const r = await installUpdate(version, auto);
    if (r.ok) {
      if (keyboardOpen()) {
        reloadPending = true;
        const closed = await untilClosed();
        reloadPending = false;
        if (!closed) return;
      }
      await reload();
      return;
    }
    if (!r.needsDecky) note = `update failed: ${r.error ?? "unknown error"}`;
  } catch (e) {
    note = `update failed: ${message(e)}`;
  } finally {
    busy = null;
  }
  try {
    status = await getStatus();
  } catch {
    status = status ?? null;
  }
}

async function whenClosed(auto: boolean): Promise<void> {
  if (!running || !deps) return;
  if (keyboardOpen()) {
    waiting = true;
    const closed = await untilClosed();
    waiting = false;
    if (!closed) return;
  }
  await apply(auto);
}

export function installNow(): Promise<void> {
  if (!canInstall() || status?.needsDecky || waiting) return Promise.resolve();
  void whenClosed(false);
  return Promise.resolve();
}

export async function installWithDecky(): Promise<void> {
  const nd = status?.needsDecky;
  const router = w.DeckyBackend;
  if (!nd || !router) return;
  try {
    await router.call("utilities/install_plugin", nd.url, PLUGIN, nd.version, nd.sha256, UPDATE_INSTALL);
  } catch (e) {
    note = `could not start Decky's installer: ${message(e)}`;
  }
}

export async function setAutoUpdate(on: boolean): Promise<void> {
  try {
    const v = await setAutoUpdateBackend(on);
    if (status) status.autoUpdate = v;
  } catch (e) {
    note = `could not save the setting: ${message(e)}`;
  }
}

export async function updateCycle(): Promise<void> {
  if (!running) return;
  await checkForUpdates(false);
  if (running && wantsAuto() && !waiting) await whenClosed(true);
}

function schedule(ms: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void updateCycle().finally(() => {
      if (running) schedule(CHECK_EVERY_MS);
    });
  }, ms);
}

export async function showUpdateRecord(): Promise<void> {
  try {
    const rec = await takeUpdateRecord();
    if (rec?.auto) toaster.toast({ title: "VaporType", body: `VaporType updated to ${rec.to}` });
  } catch (e) {
    note = message(e);
  }
}

export function startUpdates(d: Deps): void {
  deps = d;
  running = true;
  w.__oskHost = {
    ...(w.__oskHost ?? {}),
    updates: {
      status: () => ({ text: updateLine(), available: canInstall() && !status?.needsDecky }),
      check: () => checkForUpdates(true),
      install: () => installNow(),
    },
  };
  getStatus()
    .then((s) => {
      status = s;
    })
    .catch((e) => {
      note = message(e);
    });
  void showUpdateRecord();
  schedule(FIRST_CHECK_MS);
}

export function stopUpdates(): void {
  running = false;
  waiting = false;
  reloadPending = false;
  if (timer) clearTimeout(timer);
  if (waitTimer) clearTimeout(waitTimer);
  timer = waitTimer = null;
  if (w.__oskHost) delete w.__oskHost.updates;
}
