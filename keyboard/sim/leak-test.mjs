import puppeteer from "puppeteer-core";
import { openSim, inject, waitKeyboard } from "./run.mjs";
import { readRuntime as read } from "../runtime.mjs";

const OPENS = Number(process.env.OPENS ?? 40);
const SAMPLES = Number(process.env.SAMPLES ?? 2000);
const CPU = Number(process.env.CPU ?? 1);
const PRELUDE = ["swipe/words.js", "swipe/lm.js", "swipe/engine.js", "modes.js"].map(read).join("\n;\n");
const ANALOG = "SteamClient.Input.RegisterForControllerAnalogInputMessages";
const BUTTONS = "SteamClient.Input.RegisterForControllerInputMessages";
const SYSKEYS = "SteamClient.System.UI.RegisterForSystemKeyEvents";

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
let failures = 0;
const check = (ok, what, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${what}${detail !== undefined ? `\n      ${JSON.stringify(detail)}` : ""}`);
};

async function fresh(patched) {
  const sim = await openSim({ browser });
  if (patched) {
    await sim.page.evaluate(PRELUDE);
    await sim.page.evaluate(() => {
      window.__oskUserWords = null;
      window.localStorage.clear();
    });
    await inject(sim.page, read("patch.js"));
  }
  return sim;
}

const regs = (page) =>
  page.evaluate(
    (names) => Object.fromEntries(names.map((n) => [n.split(".").pop(), window.__steamRegs[n]?.size ?? 0])),
    [ANALOG, BUTTONS, SYSKEYS],
  );

async function cycle(page, n, patched) {
  for (let i = 0; i < n; i++) {
    await page.evaluate(async () => {
      window.__sim.vkm.SetVirtualKeyboardHidden();
      window.__oskTrackpadFix?.tickNow?.();
      for (let j = 0; j < 200 && document.querySelector("[data-key]"); j++) await new Promise((r) => setTimeout(r, 10));
      window.__sim.vkm.SetVirtualKeyboardVisible();
      window.__oskTrackpadFix?.tickNow?.();
      for (let j = 0; j < 200 && !document.querySelector('[data-key="g"]'); j++) await new Promise((r) => setTimeout(r, 10));
    });
  }
  if (patched) await waitKeyboard(page);
}

function fanOut(page, samples) {
  return page.evaluate(
    async (name, samples) => {
      const cbs = [...(window.__steamRegs[name] ?? [])];
      const key = [...document.querySelectorAll('[data-key="g"]')].find((e) => e.getBoundingClientRect().width > 0);
      const fk = Object.keys(key).find((k) => k.startsWith("__reactFiber"));
      let kb;
      for (let f = key[fk]; f; f = f.return)
        if (typeof f.stateNode?.HandleTrackpadClick === "function") {
          kb = f.stateNode;
          break;
        }
      for (let i = 0; i < 6; i++) {
        for (const cb of cbs) cb(0, i & 1 ? 49 : 48, true, i & 1 ? 0.4 : -0.4, 0);
        await new Promise((r) => setTimeout(r, 20));
      }
      let pads = 0;
      const t0 = performance.now();
      for (let i = 0; i < samples; i++) {
        const right = i & 1;
        const x = -0.4 + 0.3 * Math.sin(i / 40);
        const y = 0.1 * Math.cos(i / 30);
        for (const cb of cbs) cb(0, right ? 49 : 48, true, right ? -x : x, y);
        if (kb.m_leftTrackpad.active && kb.m_rightTrackpad.active) pads++;
      }
      const ms = performance.now() - t0;
      return { callbacks: cbs.length, ms, usPerSample: (1000 * ms) / samples, bothPadsActive: pads > samples / 2 };
    },
    ANALOG,
    samples,
  );
}

const runs = {};
for (const patched of [false, true]) {
  const name = patched ? "patched" : "stock";
  const { page, errors } = await fresh(patched);
  if (CPU > 1) await (await page.createCDPSession()).send("Emulation.setCPUThrottlingRate", { rate: CPU });
  const r0 = await regs(page);
  const t0 = await fanOut(page, SAMPLES);
  await cycle(page, OPENS, patched);
  const r1 = await regs(page);
  const t1 = await fanOut(page, SAMPLES);
  const st = await page.evaluate(() => ({
    released: window.__oskTrackpadFix?.inputReleased ?? 0,
    status: window.__oskTrackpadFix?.status?.(),
  }));
  runs[name] = { r0, r1, t0, t1, st, errors: errors.length };
  console.log(name, JSON.stringify(runs[name]));
  await page.close();
}

check(
  runs.stock.r1.RegisterForControllerAnalogInputMessages >= OPENS,
  `stock Steam leaks one analog registration per open (${OPENS} opens)`,
  runs.stock.r1,
);
for (const k of ["RegisterForControllerAnalogInputMessages", "RegisterForControllerInputMessages", "RegisterForSystemKeyEvents"])
  check(runs.patched.r1[k] <= runs.patched.r0[k] + 1, `patched: ${k} stays flat over ${OPENS} opens`, [
    runs.patched.r0[k],
    runs.patched.r1[k],
  ]);
check(runs.patched.st.released >= OPENS, "patched: every unmounted keyboard released its input", runs.patched.st.released);
check(
  runs.patched.t1.bothPadsActive,
  "patched: both pads still reach the reopened keyboard through Steam's registrations",
  runs.patched.t1,
);
check(runs.patched.t1.callbacks <= 2, "patched: analog samples fan out to at most two handlers", runs.patched.t1.callbacks);
check(
  /keyboard=patched/.test(runs.patched.st.status) && !/errors=/.test(runs.patched.st.status),
  "patched: status clean",
  runs.patched.st.status,
);

{
  const { page } = await fresh(true);
  await cycle(page, 2, true);
  const before = await regs(page);
  const r = await page.evaluate(() => {
    const key = document.querySelector('[data-key="g"]');
    const fk = Object.keys(key).find((k) => k.startsWith("__reactFiber"));
    let kb;
    for (let f = key[fk]; f; f = f.return)
      if (typeof f.stateNode?.HandleTrackpadClick === "function") {
        kb = f.stateNode;
        break;
      }
    kb.componentWillUnmount();
    const released = !!kb.m_trackpadInput.__oskReleased;
    kb.componentDidMount();
    return { released, revived: !kb.m_trackpadInput.__oskReleased, own: Object.hasOwn(kb.m_trackpadInput, "OnAnalogPad") };
  });
  const after = await regs(page);
  check(r.released && r.revived && !r.own, "a keyboard mounted again after unmount gets its input back", r);
  check(
    after.RegisterForControllerAnalogInputMessages === before.RegisterForControllerAnalogInputMessages,
    "remount re-registers exactly once",
    [before, after],
  );
  const t = await fanOut(page, 200);
  check(t.bothPadsActive, "remounted keyboard still sees both pads", t);
  await page.evaluate(() => window.__oskTrackpadFix.stop());
  const restored = await page.evaluate(() => {
    const key = document.querySelector('[data-key="g"]');
    const fk = Object.keys(key).find((k) => k.startsWith("__reactFiber"));
    let kb;
    for (let f = key[fk]; f; f = f.return)
      if (typeof f.stateNode?.HandleTrackpadClick === "function") {
        kb = f.stateNode;
        break;
      }
    const proto = Object.getPrototypeOf(kb);
    return {
      register: typeof SteamClient.Input.RegisterForControllerAnalogInputMessages.__oskVersion !== "number",
      unmount: typeof Object.getOwnPropertyDescriptor(proto, "componentWillUnmount").get === "function",
      mount: typeof proto.componentDidMount.__oskVersion !== "number",
    };
  });
  check(
    restored.register && restored.unmount && restored.mount,
    "stop() restores Steam's register functions and the keyboard's lifecycle",
    restored,
  );
  await page.close();
}

await browser.close();
console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
