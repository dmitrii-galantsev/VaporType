(function (root) {
  const VERSION = 7;
  const PAD_MM = 32.5;
  const BIG = { top: 0.2, bottom: 0.9, edge: 0.07, right: 0.78 };
  const ONE_ASPECT = 2;
  const SUG_PREFIX = "OSKSug_";

  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

  function layoutFrom(keys, rect, span) {
    const spans =
      typeof span === "number" ? { L: span, R: span, aspect: ONE_ASPECT } : { L: span.L, R: span.R, aspect: span.aspect ?? ONE_ASPECT };
    if (!keys || !rect) return null;
    const rows = ["qwertyuiop", "asdfghjkl", "zxcvbnm"].map((r) => [...r].map((c) => keys[c]).filter(Boolean));
    if (rows.some((r) => !r.length)) return null;
    const all = rows.flat();
    return {
      keys,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      spans,
      top: Math.min(...rows[0].map((k) => k.y - k.h / 2)),
      bottom: Math.max(...rows[2].map((k) => k.y + k.h / 2)),
      left: Math.min(...all.map((k) => k.x - k.w / 2)),
      right: Math.max(...all.map((k) => k.x + k.w / 2)),
    };
  }

  function mono(a) {
    const out = [a[0]];
    for (let i = 1; i < a.length; i++) if (a[i][0] > out[out.length - 1][0] && a[i][1] > out[out.length - 1][1]) out.push(a[i]);
    if (out.length < 2) return [a[0], a[a.length - 1]];
    return out;
  }

  function padMap(kind, L) {
    const r = L.rect;
    const lx0 = r.left,
      lx1 = r.left + r.width * L.spans.L,
      rx0 = r.left + r.width * (1 - L.spans.R),
      rx1 = r.left + r.width;
    const bottom = r.top + r.height;
    const full = (side) => L.spans[side] >= 0.99;
    const one = (m) => {
      for (const side of ["L", "R"]) if (full(side)) m[side] = { x: m[side].x, y: isoY(L, m[side].x, r.top, bottom, L.spans.aspect) };
      return m;
    };
    if (kind !== "big") {
      const y = [
        [0, r.top],
        [1, bottom],
      ];
      return one({
        kind: "standard",
        L: {
          x: [
            [0, lx0],
            [1, lx1],
          ],
          y,
        },
        R: {
          x: [
            [0, rx0],
            [1, rx1],
          ],
          y,
        },
      });
    }
    const y = mono([
      [0, r.top],
      [BIG.top, clamp(L.top, r.top, bottom)],
      [BIG.bottom, clamp(L.bottom, r.top, bottom)],
      [1, bottom],
    ]);
    const wide = (x0, x1, a, b) =>
      mono([
        [0, x0],
        [BIG.edge, clamp(a, x0, x1)],
        [BIG.right, clamp(b, x0, x1)],
        [1, x1],
      ]);
    return one({
      kind,
      L: {
        x: full("L")
          ? wide(lx0, lx1, L.left, L.right)
          : mono([
              [0, lx0],
              [BIG.edge, clamp(L.left, lx0, lx1)],
              [1, lx1],
            ]),
        y,
      },
      R: {
        x: full("R")
          ? wide(rx0, rx1, L.left, L.right)
          : mono([
              [0, rx0],
              [BIG.right, clamp(L.right, rx0, rx1)],
              [1, rx1],
            ]),
        y,
      },
    });
  }

  function isoY(L, xs, lo, hi, aspect = ONE_ASPECT) {
    const g = Math.max((L.right - L.left) / (inv(xs, L.right) - inv(xs, L.left)) / aspect, hi - lo);
    const c = (L.top + L.bottom) / 2;
    let v0 = 0.5 - (c - lo) / g;
    let v1 = 0.5 + (hi - c) / g;
    if (v0 < 0) {
      v1 -= v0;
      v0 = 0;
    }
    if (v1 > 1) {
      v0 -= v1 - 1;
      v1 = 1;
    }
    return [
      [v0, lo],
      [v1, hi],
    ];
  }

  function fwd(a, u) {
    u = clamp(u, 0, 1);
    let i = 1;
    while (i < a.length - 1 && u > a[i][0]) i++;
    const [u0, x0] = a[i - 1],
      [u1, x1] = a[i];
    return clamp(x0 + ((x1 - x0) * (u - u0)) / (u1 - u0), a[0][1], a[a.length - 1][1]);
  }

  function inv(a, x) {
    let i = 1;
    while (i < a.length - 1 && x > a[i][1]) i++;
    const [u0, x0] = a[i - 1],
      [u1, x1] = a[i];
    return u0 + ((u1 - u0) * (x - x0)) / (x1 - x0);
  }

  function linearUV(L, side, x, y) {
    const r = L.steam ?? L.rect,
      W = r.width * L.spans[side];
    const x0 = side === "L" ? r.left : r.left + r.width - W;
    return [(x - x0) / W, (y - r.top) / r.height];
  }

  function mapPoint(map, L, side, x, y) {
    const [u, v] = linearUV(L, side, x, y);
    return [fwd(map[side].x, u), fwd(map[side].y, v)];
  }

  function screenOf(map, side, u, v) {
    return [fwd(map[side].x, u), fwd(map[side].y, v)];
  }

  function toPad(map, side, x, y) {
    return [inv(map[side].x, x) * PAD_MM, inv(map[side].y, y) * PAD_MM];
  }

  const RT = { kb: null, id: null, canvas: null, style: null, ptrClass: undefined, ptrScanAt: -1e9, raf: 0, G: null, Gat: 0 };

  function geometryFor(kb, api, kind) {
    const now = performance.now();
    const spans = api.spans();
    const sig = `${kind}|${spans.L}|${spans.R}|${spans.aspect}`;
    const rect = api.rect(kb);
    const rc = rect ? [rect.left, rect.top, rect.width, rect.height] : null;
    const g = RT.G;
    if (g && g.kb === kb && g.sig === sig && now - RT.Gat < 500 && rc && g.rc.every((v, i) => v === rc[i])) return g;
    const ext = rect && api.extent?.(kb);
    const L =
      rect &&
      layoutFrom(api.keys(kb), ext ? { left: rect.left, width: rect.width, top: ext.top, height: ext.bottom - ext.top } : rect, spans);
    if (!L) return null;
    L.steam = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    RT.G = { kb, sig, rc, L, map: padMap(kind, L) };
    RT.Gat = now;
    return RT.G;
  }

  function mapPadHook(kind) {
    return function (kb, side, x, y, api) {
      const G = geometryFor(kb, api, kind);
      if (!G) return null;
      return mapPoint(G.map, G.L, side, x, y);
    };
  }

  function requestPaint() {
    const kb = RT.kb;
    if (!kb || RT.raf) return;
    const win = kb.m_keyboardDiv?.ownerDocument?.defaultView ?? root;
    if (!win.requestAnimationFrame) return;
    RT.raf = win.requestAnimationFrame(() => {
      RT.raf = 0;
      try {
        paint();
      } catch (e) {
        RT.api?.note?.(e);
      }
    });
  }

  function pointerClass(api) {
    if (RT.ptrClass) return RT.ptrClass;
    const viaApi = api.classes?.()?.TouchpadPointer;
    if (viaApi) return (RT.ptrClass = viaApi);
    const now = performance.now();
    if (now - RT.ptrScanAt < 30000) return null;
    RT.ptrScanAt = now;
    const req = api.req?.();
    for (const id of Object.keys(req?.m ?? {})) {
      const src = Function.prototype.toString.call(req.m[id]);
      if (!src.includes('TouchpadPointerContainer:"')) continue;
      const m = src.match(/TouchpadPointer:"([\w-]+)"/);
      if (m) return (RT.ptrClass = m[1]);
    }
    return null;
  }

  function mount(kb, mode, api) {
    const doc = kb.m_keyboardDiv?.ownerDocument;
    if (!doc?.body) return;
    if (RT.canvas && RT.canvas.ownerDocument !== doc) unmount();
    RT.kb = kb;
    RT.api = api;
    RT.mode = mode;
    if (!RT.canvas) RT.canvas = doc.getElementById("osk-mode-overlay");
    if (!RT.style) RT.style = doc.getElementById("osk-mode-style");
    if (!RT.canvas) {
      const c = doc.createElement("canvas");
      c.id = "osk-mode-overlay";
      c.style.cssText = "position:fixed;pointer-events:none;z-index:2147482999;left:0;top:0";
      doc.body.appendChild(c);
      RT.canvas = c;
    } else if (!RT.canvas.isConnected) doc.body.appendChild(RT.canvas);
    const cls = remaps(mode, api) ? pointerClass(api) : null;
    const css = cls ? `.${cls}{opacity:0 !important}` : "";
    if (css && !RT.style) {
      RT.style = doc.createElement("style");
      RT.style.id = "osk-mode-style";
      doc.head?.appendChild(RT.style);
    }
    if (RT.style && RT.style.textContent !== css) RT.style.textContent = css;
    const r = kb.m_keyboardDiv.getBoundingClientRect();
    const c = RT.canvas;
    const f = api.zoom?.(kb) ?? 1;
    const dpr = (doc.defaultView?.devicePixelRatio || 1) * f;
    const w = Math.round(r.width * dpr),
      h = Math.round(r.height * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const sig = `${r.width * f},${r.height * f},${r.left * f},${r.top * f},${api.covered?.() ? 1 : 0},${dpr},${mode.id},${JSON.stringify(api.spans?.() ?? null)}`;
    if (c.__sig === sig && RT.paintedKb === kb) return;
    c.__sig = sig;
    RT.paintedKb = kb;
    c.style.width = `${r.width * f}px`;
    c.style.height = `${r.height * f}px`;
    c.style.left = `${r.left * f}px`;
    c.style.top = `${r.top * f}px`;
    c.style.display = api.covered?.() ? "none" : "";
    c.__ox = r.left;
    c.__oy = r.top;
    c.__dpr = dpr;
    requestPaint();
  }

  function unmount() {
    RT.canvas?.remove();
    RT.style?.remove();
    RT.canvas = null;
    RT.style = null;
    RT.kb = null;
    RT.mode = null;
  }

  function paint() {
    const c = RT.canvas,
      kb = RT.kb,
      mode = RT.mode,
      api = RT.api;
    if (!c || !kb || !mode) return;
    const g = c.getContext("2d");
    g.setTransform(c.__dpr, 0, 0, c.__dpr, -c.__ox * c.__dpr, -c.__oy * c.__dpr);
    g.clearRect(c.__ox, c.__oy, c.width / c.__dpr, c.height / c.__dpr);
    if (remaps(mode, api)) {
      for (const [side, pad, down] of [
        ["L", kb.m_leftTrackpad, kb.state?.bLeftTrackpadDown],
        ["R", kb.m_rightTrackpad, kb.state?.bRightTrackpadDown],
      ]) {
        if (!pad?.active) continue;
        const { x, y } = pad;
        if (typeof x !== "number" || typeof y !== "number") continue;
        const chip = kb.m_keyboardDiv.querySelector(`[data-key="${SUG_PREFIX}1"]`)?.getBoundingClientRect();
        if (chip?.height && y <= chip.bottom) {
          g.fillStyle = side === "R" ? "rgba(255,170,60,0.95)" : "rgba(74,168,255,0.95)";
          g.beginPath();
          g.arc(x, chip.bottom + 1, 4, 0, 2 * Math.PI);
          g.fill();
          continue;
        }
        g.lineWidth = 3;
        g.strokeStyle = side === "R" ? "rgba(255,170,60,0.95)" : "rgba(26,159,255,0.95)";
        g.fillStyle = side === "R" ? "rgba(255,170,60,0.35)" : "rgba(26,159,255,0.35)";
        g.beginPath();
        g.arc(x, y, down ? 8 : 11, 0, 2 * Math.PI);
        g.fill();
        g.stroke();
      }
    }
  }

  function remaps(mode, api) {
    const s = api.spans?.();
    return mode.map !== "standard" || (s?.L ?? 0) >= 0.99 || (s?.R ?? 0) >= 0.99;
  }

  function onPad() {
    requestPaint();
  }

  function sync(kb, id, api) {
    const mode = MODES[id] ?? null;
    if (RT.id !== id) {
      RT.id = id;
      RT.G = null;
    }
    if (!kb || !mode || !remaps(mode, api)) {
      if (!kb) RT.G = null;
      return unmount();
    }
    mount(kb, mode, api);
  }

  const MODES = {
    standard: { id: "standard", map: "standard", mapPad: mapPadHook("standard"), onPad },
    bigkeys: { id: "bigkeys", map: "big", mapPad: mapPadHook("big"), onPad },
  };

  const api = {
    version: VERSION,
    modes: MODES,
    sync,
    debug: () => ({ mode: RT.mode?.id ?? null, pointerClass: RT.ptrClass ?? null, overlay: !!RT.canvas?.isConnected }),
    geometry: { layoutFrom, padMap, mapPoint, screenOf, toPad, PAD_MM },
  };
  root.__oskModes = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
