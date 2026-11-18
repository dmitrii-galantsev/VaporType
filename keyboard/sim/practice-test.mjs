import assert from "node:assert/strict";
import { openSim, inject, settle, waitKeyboard } from "./run.mjs";
import { readRuntime } from "../runtime.mjs";
import { pageHelpers, textOut } from "./helpers.mjs";

const { browser, page } = await openSim();
try {
  const { center, padAt, vgp, kbEval } = pageHelpers(page);
  const click = (id) => page.click(`[data-key="OSKSet_${id}"]`);
  const start = async () => {
    await page.evaluate(() => window.__oskTrackpadFix.openSettings());
    await click("tab_system");
    await click("practice");
  };
  const move = async (side, ch) => {
    const p = await center("OSKSet_practice_" + ch);
    await padAt(side, p.x, p.y);
  };
  const stroke = async (side, pair) => {
    const b = side === "L" ? 20 : 22;
    await move(side, pair[0]);
    await vgp("vgp_onbuttondown", b);
    await move(side, pair[1]);
    await vgp("vgp_onbuttonup", b);
  };
  const down = async (side, letter) => {
    await move(side, letter);
    await vgp("vgp_onbuttondown", side === "L" ? 20 : 22);
  };
  const up = (side) => vgp("vgp_onbuttonup", side === "L" ? 20 : 22);
  const title = () => page.$eval(".osk-practice-title", (e) => e.textContent);
  const prompt = () => page.$eval(".osk-practice-prompt", (e) => e.textContent);
  const snapshot = () =>
    page.evaluate(() => {
      const f = window.__oskTrackpadFix;
      f.flushLog();
      return { words: window.__oskEngine.exportUser(), traces: f.swipeLog, log: f.takeTypingLog(), output: window.__keyLog };
    });
  await page.evaluate(readRuntime("swipe/words.js") + "\n;\n" + readRuntime("swipe/engine.js"));
  await inject(page, readRuntime("patch.js"), { consent: false });
  await page.waitForSelector(".osk-set-asking");
  assert.equal(await page.$(".osk-practice"), null);
  await click("consent_on");
  await page.evaluate(() => window.__oskTrackpadFix.setSetting("typingLog", true));
  await start();
  const before = await snapshot();
  await stroke("L", "sw");
  await stroke("R", "im");
  assert.match(await title(), /SWIM/, "two disconnected strokes must not finish SWIM");
  await down("L", "s");
  assert.match(await prompt(), /hold W.*press I/i);
  await move("L", "w");
  await down("R", "i");
  assert.match(await prompt(), /release the left/i);
  await up("L");
  await move("R", "m");
  await up("R");
  assert.match(await title(), /DRUM/);
  await stroke("L", "dr");
  await stroke("R", "um");
  assert.match(await title(), /DRUM/, "two disconnected strokes must not finish DRUM");
  await down("L", "d");
  await move("L", "r");
  await down("R", "u");
  assert.equal(await page.$(".osk-practice-key.cue"), null);
  assert.equal(await prompt(), "Swipe DRUM with both thumbs.");
  await up("L");
  await move("R", "m");
  await up("R");
  assert.match(await prompt(), /two words/);
  await kbEval((kb) => kb.TypeKeyInternal({ strKey: "x" }));
  await settle(page);
  assert.deepEqual(await snapshot(), before, "practice must not send keys or change learning, swipe or typing logs");
  console.log("PASS consent first; overlap required for guided and unprompted words; practice isolated from target, learning and logs");
  await vgp("vgp_onbuttondown", 2);
  await vgp("vgp_onbuttonup", 2);
  assert.equal(await page.$(".osk-set"), null);
  await start();
  const exit = await center("OSKSet_practice_exit");
  await page.touchscreen.tap(exit.x, exit.y);
  assert.equal(await page.$(".osk-set"), null, "touch can exit practice");
  await start();
  await move("L", "s");
  await vgp("vgp_onbuttondown", 20);
  await page.evaluate(() => {
    window.__sim.vkm.SetVirtualKeyboardHidden();
    window.__oskTrackpadFix.tickNow();
  });
  await page.waitForSelector(".osk-practice", { hidden: true });
  await vgp("vgp_onbuttonup", 20);
  await page.evaluate(() => window.__sim.vkm.SetVirtualKeyboardVisible());
  await waitKeyboard(page);
  assert.equal(await page.$(".osk-practice"), null);
  await kbEval((kb) => kb.TypeKeyInternal({ strKey: "z" }));
  await settle(page);
  assert.equal(textOut(await page.evaluate(() => window.__keyLog)), "z");
  console.log("PASS B and touch exit, closing the keyboard mid-stroke cancels practice, typing resumes after reopen");
} finally {
  await page.close();
  await browser.close();
}
