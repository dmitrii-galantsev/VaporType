(function (root) {
  const VERSION = 8;
  const DEFAULTS = {
    samples: 40,
    band: 0.15,
    startKeys: 4,
    endKeys: 7,
    keySlack: 1.2,
    shortLen: 3,
    shortExtraKeys: 2,
    sigma: 0.14,
    endSigma: 0.6,
    visitSigma: 2,
    coarseVisitSigma: 3,
    lengthSigma: 0.4,
    shapeSigma: 0.18,
    shapeWeight: 0.6,
    priorWeight: 0.2,
    priorWeightHi: 0.6,
    fitLo: 0.15,
    fitHi: 0.35,
    rareZipf: 3,
    rarePenalty: 4,
    userBoost: 2000,
    bigramBoost: 1.2,
    lmLambda: 0.8,
    ctxWeight: 2,
    phraseBigram: 1,
    denomBeta: 0.1,
    predictUserBoost: 15,
    phrasePenalty: 0,
    lm: null,
    lengthRatio: [0.4, 2.5],
    maxCandidates: 300,
    templateCache: 20000,
    pressGapMs: 60,
    moveThreshold: 0.2,
    reachMargin: 0.4,
    dwellMs: 100,
    dwellRadius: 0.06,
    thin: 0.15,
    loopMinArc: 0.5,
    loopMaxArc: 3,
    loopClose: 0.15,
    loopMaxFar: 0.7,
    doubleRadius: 0.7,
    doubleBonus: 0.4,
    pads: null,
    corrSigma: 0.55,
    subBase: 1.5,
    vowelCost: 5,
    subMaxDist: 1.6,
    transCost: 3,
    delCost: 4.5,
    delDoubleCost: 1,
    insCost: 5,
    insDoubleCost: 2.5,
    insNearCost: 3,
    apoCost: 0.5,
    apoDropCost: 5,
    spaceCost: 0.5,
    maxCost: 7.5,
    unknownZipf: 2,
    unknownPerLetter: 0.3,
    protectZipf: 3.3,
    segMinZipf: 3,
    corrCtxWeight: 1,
    corrMargin: 1,
    confMargin: 3,
    confMaxCost: 6,
    ambMargin: 1.5,
    knownLowMargin: 8,
    knownApoMargin: 3,
    knownConfMargin: 5,
    noVowelCost: 1,
    tapSigmaX: 0.5,
    tapSigmaY: 0.4,
    tapBase: 1.5,
    tapMin: 1.5,
    prefixMargin: 3,
    prefixCorrPenalty: 2,
    prefixFinal: false,
    sugCompletions: 8,
    sugComplCost: 2,
    sugComplPerLetter: 0.3,
    sugCorrCost: 0,
    sugSplitCost: 0,
    sugFuzzyMin: 3,
    sugFuzzyMaxCost: 4.5,
    sugFuzzyMaxCostLong: 4,
    sugLongLen: 10,
    sugFuzzyCost: 3,
    sugKnownBonus: 2,
    sugScan: 20000,
    sugPrefixTop: 4,
  };

  const lowerKey = (w) => w.toLowerCase();
  const plainKey = (k) => k.replace(/[' ]/g, "");
  const prevKey = (w) => {
    if (!w) return null;
    const parts = w.toLowerCase().split(/\s+/).filter(Boolean);
    const k = (parts[parts.length - 1] ?? "").replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, "");
    return k || null;
  };
  const POW = new Float64Array(201);
  for (let i = 0; i <= 200; i++) POW[i] = Math.pow(10, i / 10);

  function parseLM(text, m = new Map(), from = 0, chars = Infinity) {
    if (!text) return m;
    let i = from;
    const L = Math.min(text.length, from + chars);
    while (i < L) {
      let e = text.indexOf("\n", i);
      if (e < 0) e = text.length;
      const s1 = text.indexOf(" ", i),
        s2 = s1 < 0 ? -1 : text.indexOf(" ", s1 + 1);
      if (s1 > i && s2 > s1 && s2 < e) {
        const w1 = text.slice(i, s1),
          z = Math.round(+text.slice(s2 + 1, e));
        if (z >= 0 && z <= 200) {
          let node = m.get(w1);
          if (!node) m.set(w1, (node = { tot: 0, m: new Map(), top: null }));
          const c = POW[z];
          node.tot += c;
          node.m.set(text.slice(s1 + 1, s2), c);
        }
      }
      i = e + 1;
    }
    m.next = i;
    return m;
  }

  const QWERTY = (() => {
    const k = {};
    ["qwertyuiop", "asdfghjkl", "zxcvbnm"].forEach((row, y) =>
      [...row].forEach((ch, x) => (k[ch] = { x: x + [0, 0.33, 0.97][y], y, w: 1, h: 1 })),
    );
    return k;
  })();
  const letters = (w) => {
    let s = "";
    for (const ch of w.toLowerCase()) if (ch >= "a" && ch <= "z" && ch !== s[s.length - 1]) s += ch;
    return s;
  };

  function parseWords(text) {
    const words = [];
    for (const line of text.split("\n")) {
      const sp = line.lastIndexOf(" ");
      if (sp <= 0) continue;
      const z = Number(line.slice(sp + 1)) / 10;
      if (Number.isFinite(z)) words.push({ d: line.slice(0, sp).trim(), z });
    }
    return words;
  }

  function resample(pts, n) {
    const out = new Float64Array(n * 2);
    if (pts.length === 1) {
      for (let i = 0; i < n; i++) {
        out[2 * i] = pts[0][0];
        out[2 * i + 1] = pts[0][1];
      }
      return out;
    }
    const seg = [0];
    for (let i = 1; i < pts.length; i++) seg.push(seg[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = seg[seg.length - 1];
    if (total === 0) return resample([pts[0]], n);
    let j = 1;
    for (let i = 0; i < n; i++) {
      const d = (total * i) / (n - 1);
      while (j < pts.length - 1 && seg[j] < d) j++;
      const a = pts[j - 1],
        b = pts[j];
      const span = seg[j] - seg[j - 1];
      const f = span > 0 ? Math.min(1, Math.max(0, (d - seg[j - 1]) / span)) : 0;
      out[2 * i] = a[0] + (b[0] - a[0]) * f;
      out[2 * i + 1] = a[1] + (b[1] - a[1]) * f;
    }
    return out;
  }

  function pathLength(pts) {
    let l = 0;
    for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return l;
  }

  function normShape(a, n) {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity,
      cx = 0,
      cy = 0;
    for (let i = 0; i < n; i++) {
      const x = a[2 * i],
        y = a[2 * i + 1];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      cx += x;
      cy += y;
    }
    const s = Math.max(x1 - x0, y1 - y0, 1);
    cx /= n;
    cy /= n;
    const out = new Float64Array(2 * n);
    for (let i = 0; i < n; i++) {
      out[2 * i] = (a[2 * i] - cx) / s;
      out[2 * i + 1] = (a[2 * i + 1] - cy) / s;
    }
    return out;
  }

  function meanDist2(a, b, n) {
    let s = 0;
    for (let i = 0; i < 2 * n; i += 2) {
      const dx = a[i] - b[i],
        dy = a[i + 1] - b[i + 1];
      s += dx * dx + dy * dy;
    }
    return s / n;
  }

  function dtw(a, b, n, band, cost) {
    const w = Math.max(2, Math.round(n * band));
    const INF = 1e18;
    let prev = cost.prev,
      cur = cost.cur;
    for (let j = 0; j < n; j++) prev[j] = INF;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) cur[j] = INF;
      const lo = Math.max(0, i - w),
        hi = Math.min(n - 1, i + w);
      const ax = a[2 * i],
        ay = a[2 * i + 1];
      for (let j = lo; j <= hi; j++) {
        const dx = ax - b[2 * j],
          dy = ay - b[2 * j + 1];
        let best;
        if (i === 0 && j === 0) best = 0;
        else {
          best = INF;
          if (i > 0 && prev[j] < best) best = prev[j];
          if (j > 0 && cur[j - 1] < best) best = cur[j - 1];
          if (i > 0 && j > 0 && prev[j - 1] < best) best = prev[j - 1];
        }
        cur[j] = best + dx * dx + dy * dy;
      }
      const t = prev;
      prev = cur;
      cur = t;
    }
    cost.prev = prev;
    cost.cur = cur;
    return prev[n - 1] / (1.5 * n);
  }

  function createEngine(wordsText, options = {}) {
    const opt = { ...DEFAULTS, ...options };
    const base = parseWords(wordsText);
    const entries = new Map();
    for (const w of base) {
      const k = lowerKey(w.d);
      if (entries.has(k) || !w.d) continue;
      const sp = k.indexOf(" ");
      entries.set(k, {
        k,
        d: w.d,
        z: w.z,
        c: 0,
        seq: letters(w.d),
        phrase: sp > 0,
        first: sp > 0 ? k.slice(0, sp) : k,
        last: sp > 0 ? k.slice(k.lastIndexOf(" ") + 1) : k,
      });
    }
    let user = { version: 1, words: {}, bigrams: {} };
    let byEnds = null;
    let sorted = null;
    let plainSorted = null;
    let plain = null;
    let lm = null;
    let lmPart = null;
    let warmAt = 0;
    let lmCtx = { prev: undefined, node: null, denom: 1 };
    const lmText = typeof opt.lm === "string" ? opt.lm : (opt.lm?.text ?? "");
    let geometry = null;
    const prefixCache = new Map();
    let lastSearch = null;
    const cost = { prev: new Float64Array(opt.samples + 2), cur: new Float64Array(opt.samples + 2) };
    const vbuf = new Float64Array(Math.max(opt.samples, 16));

    function invalidate() {
      byEnds = null;
      sorted = null;
      plainSorted = null;
      plain = null;
      prefixCache.clear();
      lastSearch = null;
    }

    function newEntry(k, d) {
      return { k, d, z: 0, c: 0, seq: letters(k), phrase: false, first: k, last: k };
    }

    function lmStep(chars) {
      if (lm) return true;
      lmPart = parseLM(lmText, lmPart ?? new Map(), lmPart?.next ?? 0, chars);
      if ((lmPart.next ?? 0) < lmText.length) return false;
      lm = lmPart;
      delete lm.next;
      lmPart = null;
      if (opt.phraseBigram)
        for (const e of entries.values()) {
          if (!e.phrase || e.removed) continue;
          const ws = e.k.split(" ");
          const c = opt.phraseBigram * Math.pow(10, e.z);
          for (let i = 0; i + 1 < ws.length; i++) {
            let node = lm.get(ws[i]);
            if (!node) lm.set(ws[i], (node = { tot: 0, m: new Map(), top: null }));
            const old = node.m.get(ws[i + 1]) ?? 0;
            if (c > old) {
              node.m.set(ws[i + 1], c);
              node.tot += c - old;
            }
          }
        }
      return true;
    }

    function lmIndex() {
      if (!lm) lmStep(Infinity);
      return lm;
    }

    function zOf(k) {
      const e = entries.get(k);
      return e && !e.removed ? e.z : 0;
    }

    function ctxFor(prev) {
      if (lmCtx.prev === prev) return lmCtx;
      lmCtx = { prev, node: null, denom: 1 };
      if (prev && (lmText || opt.phraseBigram)) {
        const node = lmIndex().get(prev);
        if (node) lmCtx = { prev, node, denom: node.tot + opt.denomBeta * Math.pow(10, zOf(prev)) };
      }
      return lmCtx;
    }

    function ctxMult(e, prev) {
      const cx = ctxFor(prev);
      if (!cx.node) return 1;
      const cb = cx.node.m.get(e.first) ?? 0;
      if (!cb) return 1 - opt.lmLambda;
      const z1 = e.phrase ? zOf(e.first) : e.z;
      return 1 - opt.lmLambda + (opt.lmLambda * 1e9 * cb) / cx.denom / Math.max(1, Math.pow(10, z1));
    }

    function plainIndex() {
      if (plain) return plain;
      plain = new Map();
      for (const e of entries.values()) {
        if (e.removed) continue;
        const pk = plainKey(e.k);
        const list = plain.get(pk);
        if (list) list.push(e);
        else plain.set(pk, [e]);
      }
      return plain;
    }

    function plainKeys() {
      if (plainSorted) return plainSorted;
      plainSorted = [...entries.values()]
        .filter((e) => !e.removed && plainKey(e.k) !== e.k)
        .map((e) => [plainKey(e.k), e])
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      return plainSorted;
    }

    function index() {
      if (byEnds) return byEnds;
      byEnds = new Map();
      for (const e of entries.values()) {
        if (!e.seq.length || e.removed) continue;
        const key = e.seq[0] + e.seq[e.seq.length - 1];
        let list = byEnds.get(key);
        if (!list) byEnds.set(key, (list = []));
        list.push(e);
      }
      return byEnds;
    }

    function sortedKeys() {
      if (sorted) return sorted;
      sorted = [...entries.values()].filter((e) => !e.removed).sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
      return sorted;
    }

    function logPrior(e, prev, ctxWeight = opt.ctxWeight) {
      let f = Math.pow(10, e.z) + opt.userBoost * e.c;
      let ll = Math.log(f);
      if (!e.c && e.z < opt.rareZipf) ll -= opt.rarePenalty * (opt.rareZipf - e.z);
      if (e.phrase) ll -= opt.phrasePenalty;
      if (prev) {
        ll += ctxWeight * Math.log(ctxMult(e, prev));
        const bc = user.bigrams[prev + " " + e.first] ?? 0;
        if (bc) ll += opt.bigramBoost * Math.log(1 + bc);
      }
      return ll;
    }

    function setGeometry(keys) {
      const lk = Object.entries(keys).filter(([ch, k]) => ch.length === 1 && ch >= "a" && ch <= "z" && k);
      const sig = lk
        .map(([ch, k]) => `${ch}${Math.round(k.x)},${Math.round(k.y)},${Math.round(k.w)}`)
        .sort()
        .join(";");
      if (geometry?.sig === sig) return geometry;
      const med = (f) => {
        const v = lk.map(([, k]) => f(k)).sort((a, b) => a - b);
        return v[Math.floor(v.length / 2)] || 1;
      };
      const keyW = med((k) => k.w),
        keyH = med((k) => k.h);
      const norm = {};
      for (const [ch, k] of lk) norm[ch] = { x: k.x / keyW, y: k.y / keyH };
      geometry = { sig, keys: norm, list: Object.entries(norm), keyW, keyH, templates: new Map(), reach: new Map() };
      return geometry;
    }

    function template(g, seq) {
      let t = g.templates.get(seq);
      if (t) return t;
      const pts = [];
      for (const ch of seq) {
        const k = g.keys[ch];
        if (!k) return null;
        pts.push([k.x, k.y]);
      }
      const p = resample(pts, opt.samples);
      t = { pts: p, shape: normShape(p, opt.samples), len: pathLength(pts) };
      if (g.templates.size >= opt.templateCache) g.templates.clear();
      g.templates.set(seq, t);
      return t;
    }

    function reachTable(g, pads) {
      const sig = pads ? JSON.stringify(pads) : "";
      let r = g.reach.get(sig);
      if (r) return r;
      r = {};
      for (const pad of ["L", "R"]) {
        const z = pads?.[pad];
        r[pad] = {};
        for (const [ch, k] of g.list) r[pad][ch] = !z || (k.x >= z[0] / g.keyW - opt.reachMargin && k.x <= z[1] / g.keyW + opt.reachMargin);
      }
      g.reach.set(sig, r);
      return r;
    }

    function buildRuns(trace, g) {
      const runs = [];
      const st = {};
      let active = null,
        cur = null;
      const order = trace.every((p, i) => i === 0 || !(p.t < trace[i - 1].t)) ? trace : [...trace].sort((a, b) => a.t - b.t);
      for (const p of order) {
        const s = p.s == null ? "T" : String(p.s);
        const pad = s[0] === "L" || s[0] === "R" ? s[0] : "T";
        const q = [p.x / g.keyW, p.y / g.keyH, p.t];
        let ps = st[pad];
        const fresh = !ps || ps.s !== s || (s.length === 1 && p.t != null && ps.t != null && p.t - ps.t > opt.pressGapMs);
        if (fresh) ps = st[pad] = { s, t: p.t, anchor: q, last: q };
        if (active === pad && !fresh) cur.pts.push(q);
        else if (active === pad || active === null || fresh || Math.hypot(q[0] - ps.anchor[0], q[1] - ps.anchor[1]) > opt.moveThreshold) {
          if (active && active !== pad) st[active].anchor = st[active].last;
          cur = { pad, resumed: !fresh, pts: fresh ? [q] : [ps.anchor, q] };
          runs.push(cur);
          active = pad;
        }
        ps.t = p.t;
        ps.last = q;
      }
      return runs;
    }

    function nearKeys(g, p, k) {
      const d = g.list.map(([ch, c]) => [ch, Math.hypot(c.x - p[0], c.y - p[1])]).sort((a, b) => a[1] - b[1]);
      const lim = d[0][1] + opt.keySlack;
      return d
        .slice(0, k)
        .filter((x) => x[1] <= lim)
        .map((x) => x[0]);
    }

    function split(seq, runs, g, reach) {
      const m = runs.length,
        n = seq.length;
      if (m === 1) {
        const r = runs[0],
          a = g.keys[seq[0]],
          b = g.keys[seq[n - 1]];
        const ds = (a.x - r.start[0]) ** 2 + (a.y - r.start[1]) ** 2;
        const de = (b.x - r.end[0]) ** 2 + (b.y - r.end[1]) ** 2;
        if (r.pad !== "T") for (const ch of seq) if (!reach[r.pad][ch]) return null;
        return { ends: ds + de, cut: [0, n] };
      }
      if (m > n) return null;
      const INF = 1e18;
      const f = [];
      const from = [];
      for (let k = 0; k < m; k++) {
        f.push(new Float64Array(n).fill(INF));
        from.push(new Int32Array(n).fill(-1));
        const r = runs[k];
        for (let j = k; j <= n - m + k; j++) {
          const b = g.keys[seq[j]];
          const de = (b.x - r.end[0]) ** 2 + (b.y - r.end[1]) ** 2;
          for (let i = j; i >= k; i--) {
            if (r.pad !== "T" && !reach[r.pad][seq[i]]) break;
            const before = k === 0 ? (i === 0 ? 0 : INF) : f[k - 1][i - 1];
            if (before >= INF) continue;
            let c = before + de;
            if (!r.resumed) {
              const a = g.keys[seq[i]];
              c += (a.x - r.start[0]) ** 2 + (a.y - r.start[1]) ** 2;
            }
            if (c < f[k][j]) {
              f[k][j] = c;
              from[k][j] = i;
            }
          }
        }
      }
      if (f[m - 1][n - 1] >= INF) return null;
      const cut = new Array(m + 1);
      cut[m] = n;
      for (let k = m - 1, j = n - 1; k >= 0; k--) {
        cut[k] = from[k][j];
        j = cut[k] - 1;
      }
      return { ends: f[m - 1][n - 1], cut };
    }

    function marksOf(r, marks) {
      const pts = r.pts;
      const n = pts.length;
      const out = [];
      const from = r.resumed ? 1 : 0;
      let i = 0;
      while (i < n) {
        const p = pts[i];
        let j = i + 1;
        while (j < n && Math.hypot(pts[j][0] - p[0], pts[j][1] - p[1]) < opt.dwellRadius) j++;
        if (i > from && pts[j - 1][2] - p[2] >= opt.dwellMs) {
          marks.push([p[0], p[1]]);
          for (let k = i; k < j; k++) out.push(pts[k]);
          i = j;
          continue;
        }
        let arc = 0,
          far = 0,
          loop = -1;
        for (let k = i + 1; k < n; k++) {
          arc += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
          if (arc > opt.loopMaxArc) break;
          const d = Math.hypot(pts[k][0] - p[0], pts[k][1] - p[1]);
          if (d > far) far = d;
          if (far > opt.loopMaxFar) break;
          if (arc > opt.loopMinArc && far > opt.dwellRadius && d < opt.loopClose && arc > 2.5 * far) {
            loop = k;
            break;
          }
        }
        if (loop > 0) {
          let cx = 0,
            cy = 0;
          for (let k = i; k <= loop; k++) {
            cx += pts[k][0];
            cy += pts[k][1];
          }
          const m = loop - i + 1;
          marks.push([cx / m, cy / m]);
          for (let k = i; k <= loop; k++) out.push(pts[k]);
          i = loop + 1;
          continue;
        }
        out.push(p);
        i++;
      }
      return out;
    }

    function thinPts(pts, keepFirst) {
      if (pts.length < 3 || !opt.thin) return pts;
      const out = [pts[0]];
      let last = pts[0];
      for (let i = 1; i < pts.length - 1; i++) {
        const p = pts[i];
        if ((keepFirst && i === 1) || Math.hypot(p[0] - last[0], p[1] - last[1]) >= opt.thin) {
          out.push(p);
          last = p;
        }
      }
      out.push(pts[pts.length - 1]);
      return out;
    }

    function doubleBonus(g, e, marks) {
      if (!marks.length) return 0;
      if (e.dbl === undefined) {
        e.dbl = [];
        let last = "";
        for (const ch of e.k) {
          if (ch < "a" || ch > "z") continue;
          if (ch === last && !e.dbl.includes(ch)) e.dbl.push(ch);
          last = ch;
        }
      }
      let b = 0;
      for (const m of marks) {
        for (const ch of e.dbl) {
          const k = g.keys[ch];
          if (k && Math.hypot(k.x - m[0], k.y - m[1]) < opt.doubleRadius) {
            b += opt.doubleBonus;
            break;
          }
        }
      }
      return b;
    }

    function prepare(trace, g, pads) {
      const runs = buildRuns(trace, g).filter((r) => r.pts.length);
      const marks = [];
      for (const r of runs) {
        r.pts = thinPts(marksOf(r, marks), r.resumed);
        r.start = r.pts[0];
        r.end = r.pts[r.pts.length - 1];
      }
      const sides = new Map();
      runs.forEach((r, i) => {
        let s = sides.get(r.pad);
        if (!s) sides.set(r.pad, (s = { pad: r.pad, pts: [], runs: [] }));
        s.pts.push(...r.pts);
        s.runs.push(i);
      });
      for (const s of sides.values()) {
        s.len = pathLength(s.pts);
        s.a = resample(s.pts, opt.samples);
        s.shape = normShape(s.a, opt.samples);
        s.coarse = resample(s.pts, 16);
      }
      return { runs, marks, sides: [...sides.values()], reach: reachTable(g, pads) };
    }

    function visitCost(g, seq, a, m, buf) {
      for (let j = 0; j < m; j++) buf[j] = 0;
      for (const ch of seq) {
        const k = g.keys[ch];
        let run = Infinity;
        for (let j = 0; j < m; j++) {
          if (buf[j] < run) run = buf[j];
          const dx = a[2 * j] - k.x,
            dy = a[2 * j + 1] - k.y;
          buf[j] = run + dx * dx + dy * dy;
        }
      }
      let best = Infinity;
      for (let j = 0; j < m; j++) if (buf[j] < best) best = buf[j];
      return best;
    }

    function decode(trace, keys, ctx = {}) {
      if (!trace?.length) return [];
      const g = setGeometry(keys);
      if (!g.list.length) return [];
      const P = prepare(trace, g, ctx.pads ?? opt.pads);
      const { runs, sides, reach, marks } = P;
      if (!runs.length) return [];
      const n = opt.samples;
      const first = runs[0].start,
        last = runs[runs.length - 1].end;
      const ulen = sides.reduce((a, sd) => a + sd.len, 0);
      const extra = ulen < opt.shortLen ? opt.shortExtraKeys : 0;
      const s = nearKeys(g, first, opt.startKeys + extra);
      const f = nearKeys(g, last, opt.endKeys + extra);
      const idx = index();
      const prev = prevKey(ctx.prev);
      const sideIdx = new Map(sides.map((sd, i) => [sd.pad, i]));
      const iE = 1 / (2 * opt.endSigma ** 2),
        iT = 1 / (2 * opt.coarseVisitSigma ** 2),
        iV = 1 / (2 * opt.visitSigma ** 2),
        iL = 1 / (2 * opt.lengthSigma ** 2);
      const rough = [];
      for (const c1 of s)
        for (const c2 of f)
          for (const e of idx.get(c1 + c2) ?? []) {
            const sp = split(e.seq, runs, g, reach);
            if (!sp) continue;
            const parts = sides.map(() => "");
            for (let k = 0; k < runs.length; k++) parts[sideIdx.get(runs[k].pad)] += e.seq.slice(sp.cut[k], sp.cut[k + 1]);
            let tl = 0,
              tun = 0,
              bad = false;
            for (let i = 0; i < sides.length; i++) {
              let q = parts[i];
              if (!q) {
                bad = true;
                break;
              }
              q = letters(q);
              parts[i] = q;
              const t = template(g, q);
              if (!t) {
                bad = true;
                break;
              }
              tl += t.len;
              tun += visitCost(g, q, sides[i].coarse, 16, vbuf);
            }
            if (bad) continue;
            const ratio = (tl + 0.5) / (ulen + 0.5);
            if (!ctx.unbounded && (ratio < opt.lengthRatio[0] || ratio > opt.lengthRatio[1])) continue;
            const lr = Math.log(ratio);
            const prior = logPrior(e, prev);
            const db = doubleBonus(g, e, marks);
            const partial = sp.ends * iE + tun * iT + lr * lr * iL - db;
            rough.push({ e, parts, ends: sp.ends, lr2: lr * lr, db, prior, r: partial - opt.priorWeight * prior });
          }
      rough.sort((x, y) => x.r - y.r);
      const iS = 1 / (2 * opt.sigma ** 2),
        iSh = 1 / (2 * opt.shapeSigma ** 2);
      const out = [];
      for (let ci = 0; ci < rough.length && ci < opt.maxCandidates; ci++) {
        const { e, parts, prior } = rough[ci];
        let loc = 0,
          shp = 0,
          vis = 0;
        for (let i = 0; i < sides.length; i++) {
          const t = template(g, parts[i]);
          const w = sides.length === 1 ? 1 : parts[i].length / e.seq.length;
          loc += w * dtw(sides[i].a, t.pts, n, opt.band, cost);
          vis += visitCost(g, parts[i], sides[i].a, n, vbuf);
          if (opt.shapeWeight && parts[i].length > 1) shp += w * meanDist2(sides[i].shape, t.shape, n);
        }
        const geo = rough[ci].db - (rough[ci].ends * iE + rough[ci].lr2 * iL + vis * iV + loc * iS + opt.shapeWeight * shp * iSh);
        out.push({ word: e.d, key: e.k, geo, prior, score: 0, dist: Math.sqrt(loc) });
      }
      let fit = Infinity;
      for (const c of out) if (c.dist < fit) fit = c.dist;
      const pw =
        opt.priorWeight + (opt.priorWeightHi - opt.priorWeight) * Math.min(1, Math.max(0, (fit - opt.fitLo) / (opt.fitHi - opt.fitLo)));
      for (const c of out) c.score = c.geo + pw * c.prior;
      out.sort((x, y) => y.score - x.score);
      return out;
    }

    function complete(prefix, ctx = {}, n = 3) {
      const p = lowerKey(prefix);
      if (!p) return predict(ctx.prev, n);
      const prev = prevKey(ctx.prev);
      const seen = new Set();
      const out = [];
      const add = (e) => {
        if (seen.has(e.k)) return;
        seen.add(e.k);
        out.push({ word: e.d, key: e.k, score: logPrior(e, prev) });
      };
      const list = sortedKeys();
      let lo = 0,
        hi = list.length;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (list[m].k < p) lo = m + 1;
        else hi = m;
      }
      for (let i = lo; i < list.length && list[i].k.startsWith(p); i++) add(list[i]);
      const pp = plainKey(p);
      if (pp) {
        const pl = plainKeys();
        lo = 0;
        hi = pl.length;
        while (lo < hi) {
          const m = (lo + hi) >> 1;
          if (pl[m][0] < pp) lo = m + 1;
          else hi = m;
        }
        for (let i = lo; i < pl.length && pl[i][0].startsWith(pp); i++) add(pl[i][1]);
      }
      out.sort((x, y) => y.score - x.score);
      return out.slice(0, n);
    }

    function predict(prev0, n = 3) {
      const prev = prevKey(prev0);
      if (!prev) return [];
      const seen = new Set();
      const out = [];
      const add = (e) => {
        if (!e || e.removed || e.phrase || seen.has(e.k)) return;
        seen.add(e.k);
        const bc = user.bigrams[prev + " " + e.k] ?? 0;
        out.push({ word: e.d, key: e.k, score: logPrior(e, prev, 1) + opt.predictUserBoost * Math.log(1 + bc) });
      };
      const pk = prev + " ";
      for (const k of Object.keys(user.bigrams)) if (k.startsWith(pk)) add(entries.get(k.slice(pk.length)));
      const node = ctxFor(prev).node;
      if (node) {
        if (!node.top)
          node.top = [...node.m.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 24)
            .map((x) => x[0]);
        for (const k of node.top) add(entries.get(k));
      }
      out.sort((x, y) => y.score - x.score);
      return out.slice(0, n);
    }

    function corrGeometry(keys) {
      const g = setGeometry(keys && Object.keys(keys).some((c) => c >= "a" && c <= "z" && c.length === 1) ? keys : QWERTY);
      if (g.near) return g;
      const i2 = 1 / (2 * opt.corrSigma ** 2);
      g.near = {};
      const V = "aeiou";
      for (const [a, ka] of g.list) {
        g.near[a] = [];
        for (const [b, kb] of g.list) {
          if (a === b) continue;
          const d2 = (ka.x - kb.x) ** 2 + (ka.y - kb.y) ** 2;
          let c = d2 <= opt.subMaxDist ** 2 ? opt.subBase + d2 * i2 : Infinity;
          if (V.includes(a) && V.includes(b)) c = Math.min(c, opt.vowelCost);
          if (c < Infinity) g.near[a].push([b, c]);
        }
      }
      return g;
    }

    function tapTable(g, raw, taps) {
      if (!Array.isArray(taps) || taps.length !== raw.length) return null;
      const sx = 2 * opt.tapSigmaX ** 2,
        sy = 2 * opt.tapSigmaY ** 2;
      const V = "aeiou";
      const out = [];
      let any = false;
      for (let i = 0; i < raw.length; i++) {
        const ch = raw[i].toLowerCase();
        if (ch === "'" || ch === " ") continue;
        const t = taps[i];
        const kc = g.keys[ch];
        if (!t || !Number.isFinite(t.x) || !Number.isFinite(t.y) || !kc) {
          out.push(null);
          continue;
        }
        const px = t.x / g.keyW,
          py = t.y / g.keyH;
        const e = (k) => (px - k.x) ** 2 / sx + (py - k.y) ** 2 / sy;
        const e0 = e(kc);
        const list = [];
        for (const [b, kb] of g.list) {
          if (b === ch) continue;
          let c = Math.max(opt.tapMin, opt.tapBase + e(kb) - e0);
          if (V.includes(ch) && V.includes(b)) c = Math.min(c, opt.vowelCost);
          if (c <= opt.maxCost) list.push([b, c]);
        }
        out.push(list);
        any = true;
      }
      return any ? out : null;
    }

    function edits(s0, g, sub) {
      const out = new Map([[s0, 0]]);
      const seeds = [];
      const put = (s, c, seed, org) => {
        if (c > opt.maxCost || out.get(s) <= c) return;
        out.set(s, c);
        if (seed) seeds.push(sub ? [s, org] : s);
      };
      const AZ = "abcdefghijklmnopqrstuvwxyz";
      const step = (s, base, full, org) => {
        const n = s.length,
          room = opt.maxCost - base;
        const near = (i, ch) => (org && org[i] >= 0 && sub[org[i]]) || g.near[ch] || [];
        const o = (f) => (org && full ? f() : null);
        for (let i = 0; i < n; i++) {
          const ch = s[i];
          for (const [b, c] of near(i, ch))
            if (c <= room)
              put(
                s.slice(0, i) + b + s.slice(i + 1),
                base + c,
                full,
                o(() => {
                  const q = org.slice();
                  q[i] = -1;
                  return q;
                }),
              );
          if (i + 1 < n && s[i + 1] !== ch && opt.transCost <= room)
            put(
              s.slice(0, i) + s[i + 1] + ch + s.slice(i + 2),
              base + opt.transCost,
              full,
              o(() => {
                const q = org.slice();
                q[i] = org[i + 1];
                q[i + 1] = org[i];
                return q;
              }),
            );
          if (n > 1) {
            const nb =
              s[i - 1] === ch || s[i + 1] === ch
                ? opt.insDoubleCost
                : (g.near[ch] ?? []).some(([b, c]) => c < opt.vowelCost && (b === s[i - 1] || b === s[i + 1]))
                  ? opt.insNearCost
                  : opt.insCost;
            if (nb <= room)
              put(
                s.slice(0, i) + s.slice(i + 1),
                base + nb,
                full,
                o(() => org.slice(0, i).concat(org.slice(i + 1))),
              );
          }
        }
        for (let i = 0; i <= n; i++) {
          if (full)
            for (const ch of AZ) {
              const dbl = ch === s[i - 1] || ch === s[i];
              const c = dbl ? opt.delDoubleCost : opt.delCost;
              if (c <= room)
                put(s.slice(0, i) + ch + s.slice(i), base + c, dbl, dbl && org ? org.slice(0, i).concat([-1], org.slice(i)) : null);
            }
          else if (i > 0 && opt.delDoubleCost <= room) put(s.slice(0, i) + s[i - 1] + s.slice(i), base + opt.delDoubleCost);
        }
      };
      step(s0, 0, true, sub ? Array.from(s0, (_, i) => i) : null);
      if (s0.length >= 4)
        for (const x of seeds) {
          const [s, org] = sub ? x : [x, null];
          const c = out.get(s);
          if (c + 1 <= opt.maxCost) step(s, c, false, org);
        }
      return out;
    }

    function search(raw, ctx) {
      const g0 = corrGeometry(ctx.keys);
      const sk =
        raw +
        "|" +
        (ctx.prev ?? "") +
        "|" +
        g0.sig +
        "|" +
        (ctx.keys && Array.isArray(ctx.taps) ? ctx.taps.map((t) => (t ? Math.round(t.x) + "," + Math.round(t.y) : "")).join(";") : "");
      if (lastSearch?.sk === sk) return lastSearch.r;
      const r = searchRaw(raw, ctx);
      lastSearch = { sk, r };
      return r;
    }

    function searchRaw(raw, ctx) {
      const k = lowerKey(raw);
      const s0 = plainKey(k);
      const prev = prevKey(ctx.prev);
      const lp = (e, p = prev) => logPrior(e, p, opt.corrCtxWeight);
      const eT = entries.get(k);
      const knownT = eT && !eT.removed ? eT : null;
      const typedScore = knownT
        ? lp(knownT)
        : (opt.unknownZipf - opt.unknownPerLetter * (s0.length - 4)) * Math.LN10 -
          (s0.length >= 3 && !/[aeiouy]/.test(s0) ? opt.noVowelCost : 0);
      const highKnown = !!knownT && knownT.z >= opt.protectZipf;
      const g = corrGeometry(ctx.keys);
      const pi = plainIndex();
      const best = new Map();
      const consider = (e, sc, cost) => {
        if (knownT && e.k === knownT.k) return;
        const cur = best.get(e.k);
        if (!cur || cur.score < sc) best.set(e.k, { e, score: sc, cost });
      };
      const restoreCost = (e) => {
        let c = 0;
        for (const ch of e.k)
          if (ch === "'") c += opt.apoCost;
          else if (ch === " ") c += opt.spaceCost;
        let ta = 0,
          ea = 0;
        for (const ch of k) if (ch === "'") ta++;
        for (const ch of e.k) if (ch === "'") ea++;
        c -= opt.apoCost * Math.min(ta, ea);
        return Math.max(0, c) + opt.apoDropCost * Math.max(0, ta - ea);
      };
      const cands = highKnown ? new Map([[s0, 0]]) : edits(s0, g, ctx.keys ? tapTable(g, raw, ctx.taps) : null);
      for (const [str, cost] of cands) {
        const list = pi.get(str);
        if (!list) continue;
        for (const e of list)
          if (!e.removed && (e.z > 0 || e.c > 0)) {
            const c = cost + restoreCost(e);
            consider(e, lp(e) - c, c);
          }
      }
      if (!knownT) {
        for (let i = 1; i < s0.length; i++) {
          const la = pi.get(s0.slice(0, i)),
            lb = pi.get(s0.slice(i));
          if (!la || !lb) continue;
          for (const a of la) {
            if (a.phrase || a.removed || (a.z < opt.segMinZipf && !a.c)) continue;
            const pa = lp(a);
            for (const b of lb) {
              if (b.phrase || b.removed || (b.z < opt.segMinZipf && !b.c)) continue;
              const c = opt.spaceCost + restoreCost(a) + restoreCost(b);
              const key = a.k + " " + b.k;
              if (entries.has(key)) continue;
              consider({ k: key, d: a.d + " " + b.d }, pa + lp(b, a.k) - 9 * Math.LN10 - c, c);
            }
          }
        }
      }
      const ranked = [...best.values()].sort((x, y) => y.score - x.score);
      return { k, s0, prev, lp, knownT, typedScore, highKnown, ranked, cands };
    }

    function prefixInfo(S, k) {
      const ext = (e) => {
        const pk = plainKey(e.k);
        return pk !== S.s0 && pk.startsWith(S.s0);
      };
      const look = (e) => plainKey(e.k) !== S.s0 && !ext(e);
      let bc = null;
      for (const e of prefixTop(k, opt.sugCompletions)) {
        if (e.k === k) continue;
        const sc = S.lp(e) - opt.sugComplCost - opt.sugComplPerLetter * Math.max(0, plainKey(e.k).length - S.s0.length);
        if (!bc || sc > bc.score) bc = { e, score: sc };
      }
      const top = S.ranked[0]?.score ?? -Infinity;
      const live = !!bc && bc.score >= top - opt.prefixMargin;
      return { live, bc, ext, look, adj: (r) => r.score - (live && look(r.e) ? opt.prefixCorrPenalty : 0) };
    }

    function correct(typed, ctx = {}) {
      if (typeof typed !== "string") return null;
      const raw = typed.trim();
      if (!raw || !/^[A-Za-z']+$/.test(raw) || !/[A-Za-z]/.test(raw)) return null;
      if (raw.length > 1 && raw === raw.toUpperCase() && /[A-Z]{2}/.test(raw)) return null;
      const k = lowerKey(raw);
      if (plainKey(k).length > 24) return null;
      const eT = entries.get(k);
      const knownT = eT && !eT.removed ? eT : null;
      if (knownT && knownT.c > 0) return null;
      const shape = (w) => (raw[0] !== raw[0].toLowerCase() && w[0] === w[0].toLowerCase() ? w[0].toUpperCase() + w.slice(1) : w);
      if (knownT && knownT.d !== raw && lowerKey(knownT.d) === k && /[A-Z]/.test(knownT.d) && raw === k) {
        const sc = logPrior(knownT, prevKey(ctx.prev), opt.corrCtxWeight);
        return { word: knownT.d, key: knownT.k, score: sc, typedScore: sc, confident: true, alts: [] };
      }
      if (plainKey(k).length < 2) return null;
      const S = search(raw, ctx);
      const { s0, prev, typedScore, highKnown } = S;
      if (!S.ranked.length) return null;
      const P = prefixInfo(S, k);
      let ranked = S.ranked;
      if (P.live && (!ctx.final || opt.prefixFinal)) {
        ranked = S.ranked.map((r) => ({ ...r, score: P.adj(r) }));
        if (!ranked.some((r) => r.e.k === P.bc.e.k)) ranked.push({ e: P.bc.e, score: P.bc.score, cost: 0 });
        ranked.sort((x, y) => y.score - x.score);
      }
      const top = ranked[0];
      const margin = top.score - typedScore;
      let ok, confident;
      if (highKnown) {
        ok = !!ctxFor(prev).node && margin >= opt.knownApoMargin;
        confident = ok && margin >= opt.knownConfMargin;
      } else if (knownT) {
        ok = margin >= opt.corrMargin;
        confident = margin >= opt.knownLowMargin;
      } else {
        ok = margin >= opt.corrMargin;
        const second = ranked.find((r) => lowerKey(r.e.d) !== lowerKey(top.e.d));
        const restore = plainKey(top.e.k) === s0;
        confident =
          ok &&
          margin >= opt.confMargin &&
          (restore || !second || top.score - second.score >= opt.ambMargin) &&
          top.cost <= opt.confMaxCost;
      }
      if (!ok) return null;
      if (!ctx.final && (P.live || P.ext(top.e))) confident = false;
      return {
        word: shape(top.e.d),
        key: top.e.k,
        score: top.score,
        typedScore,
        confident: !!confident,
        alts: ranked.slice(1, 3).map((r) => shape(r.e.d)),
      };
    }

    function prefixTop(p, m = opt.sugPrefixTop) {
      const ck = m + ":" + p;
      let top = prefixCache.get(ck);
      if (top) return top;
      const list = sortedKeys();
      let lo = 0,
        hi = list.length;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (list[m].k < p) lo = m + 1;
        else hi = m;
      }
      top = [];
      for (let i = lo, seen = 0; i < list.length && list[i].k.startsWith(p) && seen < opt.sugScan; i++, seen++) {
        const e = list[i];
        if (e.phrase || e.k === p) continue;
        const f = e.z + (e.c ? 2 : 0);
        if (top.length < m) top.push([f, e]);
        else if (f > top[top.length - 1][0]) top[top.length - 1] = [f, e];
        else continue;
        top.sort((a, b) => b[0] - a[0]);
      }
      top = top.map((x) => x[1]);
      if (prefixCache.size > 5000) prefixCache.clear();
      prefixCache.set(ck, top);
      return top;
    }

    function suggest(buf, ctx = {}, n = 3) {
      if (typeof buf !== "string") return [];
      const raw = buf.trim();
      if (!raw) return predict(ctx.prev, n).map((c) => ({ ...c, kind: "completion" }));
      const k = lowerKey(raw);
      const shape = (w) => (raw[0] !== raw[0].toLowerCase() && w[0] === w[0].toLowerCase() ? w[0].toUpperCase() + w.slice(1) : w);
      const prev = prevKey(ctx.prev);
      const lp = (e) => logPrior(e, prev, opt.corrCtxWeight);
      const out = new Map();
      const put = (e, score, kind) => {
        if (!e || e.removed || (e.z <= 0 && !e.c)) return;
        const cur = out.get(e.k);
        if (!cur || cur.score < score) out.set(e.k, { word: shape(e.d), key: e.k, score, kind });
      };
      const eT = entries.get(k);
      const knownT = eT && !eT.removed ? eT : null;
      const protect = !!knownT && (knownT.c > 0 || knownT.z >= opt.protectZipf);
      const compl = (e, extra) => lp(e) - opt.sugComplCost - opt.sugComplPerLetter * Math.max(0, extra);
      const own = k.length <= 2 ? prefixTop(k, opt.sugCompletions) : complete(raw, ctx, opt.sugCompletions).map((c) => entries.get(c.key));
      for (const e of own) if (e && e.k !== k) put(e, compl(e, plainKey(e.k).length - plainKey(k).length), "completion");
      let typedScore = knownT ? lp(knownT) : -Infinity;
      const plain =
        /^[A-Za-z']+$/.test(raw) &&
        plainKey(k).length >= 2 &&
        plainKey(k).length <= 24 &&
        !(raw === raw.toUpperCase() && /[A-Z]{2}/.test(raw));
      if (plain) {
        const S = search(raw, ctx);
        typedScore = S.typedScore;
        const P = prefixInfo(S, k);
        for (const r of S.ranked)
          put(r.e, P.adj(r) - opt.sugCorrCost * r.cost - (r.e.z === undefined ? opt.sugSplitCost : 0), "correction");
        if (!protect && S.s0.length >= opt.sugFuzzyMin) {
          const s0 = S.s0,
            list = sortedKeys();
          let lo = 0,
            hi = list.length;
          while (lo < hi) {
            const m = (lo + hi) >> 1;
            if (list[m].k < s0) lo = m + 1;
            else hi = m;
          }
          const lcp = (w) => {
            let i = 0;
            while (w && i < w.length && i < s0.length && w[i] === s0[i]) i++;
            return i;
          };
          const reach = Math.max(lcp(list[lo - 1]?.k), lcp(list[lo]?.k));
          for (const [str, cost] of S.cands) {
            if (
              !cost ||
              cost > (s0.length >= opt.sugLongLen ? opt.sugFuzzyMaxCostLong : opt.sugFuzzyMaxCost) ||
              str.length < opt.sugFuzzyMin
            )
              continue;
            let d = 0;
            while (d < str.length && str[d] === s0[d]) d++;
            if (d > reach) continue;
            for (const e of prefixTop(str))
              put(e, compl(e, plainKey(e.k).length - str.length) - opt.sugCorrCost * cost - opt.sugFuzzyCost, "correction");
          }
        }
      }
      const res = [...out.values()].filter((c) => c.key !== k);
      if (knownT || plain) {
        const lit = {
          word: knownT && knownT.d !== raw && lowerKey(knownT.d) === k && /[A-Z]/.test(knownT.d) ? knownT.d : raw,
          key: k,
          score: typedScore + (knownT ? opt.sugKnownBonus : 0),
          kind: "literal",
        };
        res.push(lit);
        res.sort((x, y) => y.score - x.score);
        if (protect) {
          res.splice(res.indexOf(lit), 1);
          res.unshift(lit);
        }
      } else res.sort((x, y) => y.score - x.score);
      return res.slice(0, n);
    }

    function info(word) {
      const e = entries.get(lowerKey(word ?? ""));
      if (!e || e.removed) return null;
      return { z: e.z, c: e.c, phrase: e.phrase };
    }

    function warm() {
      index();
      sortedKeys();
      plainIndex();
      plainKeys();
      lmIndex();
      for (const ch of "abcdefghijklmnopqrstuvwxyz") prefixTop(ch, opt.sugCompletions);
    }

    function warmStep(chars = 200000) {
      const builds = [index, sortedKeys, plainIndex, plainKeys];
      if (warmAt < builds.length) {
        builds[warmAt++]();
        return false;
      }
      if (!lmStep(chars)) return false;
      const az = "abcdefghijklmnopqrstuvwxyz";
      if (warmAt - builds.length < az.length) {
        prefixTop(az[warmAt++ - builds.length], opt.sugCompletions);
        return false;
      }
      return true;
    }

    function known(word) {
      const e = entries.get(lowerKey(word));
      return !!e && !e.removed;
    }

    function learn(word, prev, { allowNew = true } = {}) {
      lastSearch = null;
      const k = lowerKey(word);
      let e = entries.get(k);
      const phrase = !!e?.phrase && !e.removed;
      if (!phrase && (!/^[a-z]+(?:'[a-z]+)?$/.test(k) || k.length > 24)) return false;
      if (!e || e.removed) {
        if (!allowNew) return false;
        if (k.length < 2) return false;
        e = entries.get(k) ?? newEntry(k, word);
        e.removed = false;
        entries.set(k, e);
        invalidate();
      }
      e.c += 1;
      const u = (user.words[k] ??= { c: 0, d: e.d });
      u.c = e.c;
      if (e.z === 0 && word !== e.d && word.toLowerCase() === k) {
        u.cases = u.cases ?? {};
        u.cases[word] = (u.cases[word] ?? 0) + 1;
        const best = Object.entries(u.cases).sort((x, y) => y[1] - x[1])[0][0];
        e.d = u.d = best;
      }
      const pk = prevKey(prev);
      if (pk && entries.has(pk)) user.bigrams[pk + " " + e.first] = (user.bigrams[pk + " " + e.first] ?? 0) + 1;
      return true;
    }

    function unlearn(word, prev) {
      lastSearch = null;
      const k = lowerKey(word);
      const e = entries.get(k);
      if (!e) return;
      e.c = Math.max(0, e.c - 1);
      if (user.words[k]) {
        user.words[k].c = e.c;
        if (!e.c) delete user.words[k];
      }
      if (e.z === 0 && e.c === 0) {
        e.removed = true;
        invalidate();
      }
      const pk = prevKey(prev);
      if (pk) {
        const bk = pk + " " + e.first;
        if (user.bigrams[bk] > 1) user.bigrams[bk]--;
        else delete user.bigrams[bk];
      }
    }

    function forget(word) {
      lastSearch = null;
      const k = lowerKey(word);
      const e = entries.get(k);
      delete user.words[k];
      for (const b of Object.keys(user.bigrams)) if (b.startsWith(k + " ") || b.endsWith(" " + k)) delete user.bigrams[b];
      if (!e) return;
      e.c = 0;
      if (e.z === 0) {
        e.removed = true;
        invalidate();
      }
    }

    function setUser(data) {
      lastSearch = null;
      if (!data || typeof data !== "object") return;
      for (const e of entries.values()) {
        if (!e.c) continue;
        e.c = 0;
        if (e.z === 0) e.removed = true;
      }
      for (const [k, u] of Object.entries(data.words ?? {})) {
        if (!(u?.c > 0) || (!/^[a-z]+(?:'[a-z]+)?$/.test(k) && !entries.get(k)?.phrase)) continue;
        let e = entries.get(k);
        if (!e) {
          e = newEntry(k, u.d || k);
          entries.set(k, e);
        }
        e.removed = false;
        e.c = u.c;
        if (e.z === 0 && u.d) e.d = u.d;
      }
      user = { version: 1, words: { ...(data.words ?? {}) }, bigrams: { ...(data.bigrams ?? {}) } };
      invalidate();
    }

    function exportUser() {
      const MAX_BIGRAMS = 20000;
      const keys = Object.keys(user.bigrams);
      if (keys.length > MAX_BIGRAMS) {
        keys.sort((a, b) => user.bigrams[a] - user.bigrams[b]);
        for (const k of keys.slice(0, keys.length - MAX_BIGRAMS)) delete user.bigrams[k];
      }
      return JSON.parse(JSON.stringify(user));
    }

    return {
      version: VERSION,
      decode,
      complete,
      suggest,
      predict,
      correct,
      info,
      warm,
      warmStep,
      learn,
      unlearn,
      forget,
      known,
      setUser,
      exportUser,
      letters,
      size: () => entries.size,
    };
  }

  root.__oskSwipeEngine = { version: VERSION, createEngine };
  if (typeof module === "object" && module.exports) module.exports = root.__oskSwipeEngine;
})(typeof globalThis !== "undefined" ? globalThis : this);
