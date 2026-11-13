import argparse
import json
import lzma
import math
import os
import re
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, HERE)
import build_words as bw  # noqa: E402

TOK = re.compile(r"[a-z]+(?:'[a-z]+)?")
MAX_SUM = 0.999
MERGED_VERSION = 6
TRI_NOTE = "; plus "


def js_text(path):
    src = open(path, encoding="utf-8").read()
    return json.loads(re.search(r'text: ("(?:[^"\\]|\\.)*")', src).group(1))


def load_words(path):
    zipf = {}
    for line in js_text(path).split("\n"):
        sp = line.rfind(" ")
        if sp <= 0:
            continue
        k = line[:sp].strip().lower()
        if k and " " not in k and k not in zipf:
            zipf[k] = float(line[sp + 1 :]) / 10
    return zipf


def load_pairs(path):
    pairs = defaultdict(dict)
    for line in js_text(path).split("\n"):
        s1 = line.find(" ")
        s2 = line.find(" ", s1 + 1) if s1 >= 0 else -1
        if s1 <= 0 or s2 <= s1:
            continue
        try:
            z = round(float(line[s2 + 1 :]))
        except ValueError:
            continue
        if 0 <= z <= 200:
            pairs[line[:s1]][line[s1 + 1 : s2]] = 10 ** (z / 10)
    return pairs


def drop_map(zipf):
    try:
        exact, _ = bw.load_spelling()
        stripped = {c.replace("'", "") for c in bw.CONTRACTIONS} - (exact - bw.FORCE_CONTRACT)
    except OSError:
        stripped = {c.replace("'", "") for c in bw.CONTRACTIONS if c.replace("'", "") not in zipf}
    return {c.replace("'", ""): c for c in sorted(bw.CONTRACTIONS) if c.replace("'", "") in stripped}


def line_tokens(line, dmap):
    toks = TOK.findall(line.lower())
    return [bw.map_bigram(t, toks[i + 1] if i + 1 < len(toks) else "", dmap)[0] for i, t in enumerate(toks)]


def line_key(line):
    return " ".join(TOK.findall(line.lower()))


def exclude_keys(files):
    keys = set()
    for f in files:
        for line in open(f, encoding="utf-8"):
            if line.strip():
                keys.add(line_key(line))
    return keys


def count_triples(path, zipf, dmap, exclude):
    counts = Counter()
    total = 0
    with lzma.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            if exclude and line_key(line) in exclude:
                continue
            toks = line_tokens(line, dmap)
            total += max(0, len(toks) - 2)
            ok = [t if t in zipf else None for t in toks]
            for a, b, c in zip(ok, ok[1:], ok[2:]):
                if a and b and c:
                    counts[(a, b, c)] += 1
    return counts, total


class Bigram:
    def __init__(self, zipf, pairs):
        self.zipf = zipf
        self.pairs = pairs
        mass = sum(sum(m.values()) for m in pairs.values())
        inc = defaultdict(float)
        for m in pairs.values():
            for c, v in m.items():
                inc[c] += v
        self.inc = {c: v / mass for c, v in inc.items()}
        self.denom = {b: sum(m.values()) + 0.1 * 10 ** zipf.get(b, 0) for b, m in pairs.items()}

    def uni(self, w):
        z = self.zipf[w]
        p = 0.5 * 10 ** (z - 9) + 0.5 * self.inc.get(w, 0.0)
        return p * math.exp(-4 * (3 - z)) if z < 3 else p

    def prob(self, b, c):
        m = self.pairs.get(b)
        if not m:
            return self.uni(c)
        return 0.2 * self.uni(c) + 0.8 * m.get(c, 0.0) / self.denom[b]


def mix(chat, chat_total, web, web_total, web_weight):
    scale = web_weight / (1 - web_weight) * chat_total / web_total if web_weight else 0.0
    out = dict(chat)
    for k, v in web.items():
        out[k] = out.get(k, 0.0) + v * scale
    return out


def select(mixed, bigram, n, discount, min_count, keep):
    ctot = defaultdict(float)
    dmass = defaultdict(float)
    for (a, b, c), v in mixed.items():
        ctot[(a, b)] += v
        dmass[(a, b)] += min(v, discount)
    cands = []
    for (a, b, c), v in mixed.items():
        if v < min_count or v <= discount:
            continue
        ab = (a, b)
        p3 = (v - discount) / ctot[ab]
        if keep == "count":
            score = v
        else:
            g0 = dmass[ab] / ctot[ab]
            pb = bigram.prob(b, c)
            score = v * (math.log(p3 + g0 * pb) - math.log((g0 + p3) * pb))
        cands.append((-score, a, b, c, p3))
    cands.sort()
    return cands[:n] if n else cands


def encode(chosen):
    by_ctx = defaultdict(list)
    for _, a, b, c, p3 in chosen:
        by_ctx[(a, b)].append([c, p3, max(0, round(10 * math.log10(p3 * 1e9)))])
    lines = []
    for (a, b), items in by_ctx.items():
        items.sort(key=lambda x: (-x[1], x[0]))
        while sum(10 ** (x[2] / 10) / 1e9 for x in items) > MAX_SUM:
            top = max(items, key=lambda x: (x[2], x[0]))
            top[2] -= 1
        lines.extend((a, b, c, z) for c, _, z in items)
    lines.sort(key=lambda t: (-t[3], t[0], t[1], t[2]))
    return lines


def build(chat, chat_total, web, web_total, bigram, n, discount, min_count, keep, web_weight):
    mixed = mix(chat, chat_total, web, web_total, web_weight)
    return encode(select(mixed, bigram, n, discount, min_count, keep))


def merge(path, text, n, discount):
    src = open(path, encoding="utf-8").read()
    m = re.search(r'globalThis\.__oskLM = \{ version: (\d+), source: ("(?:[^"\\]|\\.)*"), text: ("(?:[^"\\]|\\.)*") \};', src)
    source = json.loads(m.group(2)).split(TRI_NOTE)[0]
    pairs = [line for line in json.loads(m.group(3)).split("\n") if line and line.count(" ") == 2]
    note = f"{TRI_NOTE}{n} word triples a b c z10 from the same lines (build_trigrams.py: z10 = 10*log10(1e9 x P(c | a b)), absolute discount {discount:g})"
    body = "\n".join(pairs) + "\n" + text.rstrip("\n")
    with open(path, "w", encoding="utf-8") as f:
        f.write(f"globalThis.__oskLM = {{ version: {MERGED_VERSION}, source: {json.dumps(source + note)}, text: {json.dumps(body)} }};\n")


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument("-n", type=int, default=25000)
    ap.add_argument("--discount", type=float, default=3.0)
    ap.add_argument("--min-count", type=float, default=1)
    ap.add_argument("--keep", choices=["wd", "count"], default="wd")
    ap.add_argument("--web-weight", type=float, default=0.3)
    ap.add_argument("--exclude", nargs="*", default=[])
    ap.add_argument("--inputs", default=os.path.join(here, "..", "data", "inputs"))
    ap.add_argument("--words", default=os.path.join(here, "..", "data", "words.js"))
    ap.add_argument("--lm", default=os.path.join(here, "..", "data", "lm.js"))
    ap.add_argument("-o", "--out", default="-")
    ap.add_argument("--merge", action="store_true")
    a = ap.parse_args()
    zipf = load_words(a.words)
    dmap = drop_map(zipf)
    excl = exclude_keys(a.exclude)
    chat, ct = count_triples(os.path.join(a.inputs, "chat-lines.txt.xz"), zipf, dmap, excl)
    web, wt = count_triples(os.path.join(a.inputs, "web-lines.txt.xz"), zipf, dmap, excl)
    lines = build(chat, ct, web, wt, Bigram(zipf, load_pairs(a.lm)), a.n, a.discount, a.min_count, a.keep, a.web_weight)
    text = "".join(f"{x} {y} {w} {z}\n" for x, y, w, z in lines)
    if a.merge:
        merge(a.lm, text, len(lines), a.discount)
    elif a.out == "-":
        sys.stdout.write(text)
    else:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(text)
    print(f"{len(lines)} trigrams, {len(text.encode())} bytes", file=sys.stderr)


if __name__ == "__main__":
    main()
