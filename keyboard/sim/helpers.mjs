export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const sideOf = (ch) => ("qwertasdfgzxcvb".includes(ch) ? "L" : "R");

export function textOut(log) {
  let s = "";
  for (const [, kind, v] of log) {
    if (kind !== "text") continue;
    if (v === "\u0002") s = s.slice(0, -1);
    else if (v === "\u0001") s += "\n";
    else s += v;
  }
  return s;
}

export const lum = (rgb) => {
  const [r, g, b] = rgb.map((c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const makeCheck = (emit, onFail) => (ok, what, detail) => {
  if (!ok) onFail();
  emit(
    `${ok ? "PASS" : "FAIL"} ${what}${detail !== undefined ? `\n      ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`,
  );
};

export const withTiming =
  (run) =>
  async (title, ...rest) => {
    const t = Date.now();
    const r = await run(title, ...rest);
    if (process.env.TIMING) console.error(`${Date.now() - t} ms ${title}`);
    return r;
  };

export const pageHelpers = (pageOrGetter) => {
  const cur = typeof pageOrGetter === "function" ? pageOrGetter : () => pageOrGetter;
  const kbEval = (fn, ...args) =>
    cur().evaluate(
      (src, args) => {
        const key = document.querySelector("[data-key]");
        const fk = Object.keys(key).find((k) => k.startsWith("__reactFiber"));
        let kb;
        for (let f = key[fk]; f; f = f.return)
          if (typeof f.stateNode?.HandleTrackpadClick === "function") {
            kb = f.stateNode;
            break;
          }
        return new Function("kb", "args", `return (${src})(kb, ...args)`)(kb, args);
      },
      fn.toString(),
      args,
    );
  const center = (key) =>
    cur().evaluate((key) => {
      const el = [...document.querySelectorAll("[data-key]")].find(
        (e) => e.getAttribute("data-key") === key && e.getBoundingClientRect().width > 0,
      );
      if (el?.closest?.(".osk-set-page")) el.scrollIntoView({ block: "nearest" });
      const r = el?.getBoundingClientRect();
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    }, key);
  const vgp = (type, button, target = "[data-key]") =>
    cur().evaluate(
      (type, button, target) => {
        (document.querySelector(target) ?? document.body).dispatchEvent(
          new CustomEvent(type, { bubbles: true, cancelable: true, detail: { button, source: 1, is_repeat: false } }),
        );
      },
      type,
      button,
      target,
    );
  const padAt = (side, x, y) =>
    kbEval(
      (kb, side, x, y) => {
        const pad = side === "L" ? kb.m_leftTrackpad : kb.m_rightTrackpad;
        pad.active = true;
        pad.x = x;
        pad.y = y;
      },
      side,
      x,
      y,
    );
  const padIdle = (side) =>
    kbEval((kb, side) => {
      (side === "L" ? kb.m_leftTrackpad : kb.m_rightTrackpad).active = false;
    }, side);
  const labels = () => cur().evaluate(() => [0, 1, 2].map((i) => document.querySelector(`[data-key="OSKSug_${i}"]`)?.textContent ?? null));
  const setSetting = (k, v) => cur().evaluate((k, v) => window.__oskTrackpadFix.setSetting(k, v), k, v);
  return { kbEval, center, vgp, padAt, padIdle, labels, setSetting };
};
