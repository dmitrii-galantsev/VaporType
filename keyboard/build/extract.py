import glob
import json
import re
import sys
from collections import Counter

from wordfreq import zipf_frequency

SRC = sys.argv[1]
OUT_LINES = sys.argv[2]
OUT_COUNTS = sys.argv[3]
BULLETS = len(sys.argv) > 4 and sys.argv[4] == "bullets"

name_re = re.compile(r"^[A-Za-z0-9_.\- ]{1,24}:\s*(.*)$")
tok_re = re.compile(r"[a-z]+(?:'[a-z]+)?")
bad_re = re.compile(r"https?:|www\.|===|\.com|</|<[a-z]|\[|\]|\{|\}|@\w|#\w|\\")

known = {}


def is_word(t):
    if t not in known:
        known[t] = zipf_frequency(t, "en") >= 1.0
    return known[t]


def clean(text):
    text = text.replace("\u2019", "'").replace("\u2018", "'").strip()
    if not text or len(text) > 220 or bad_re.search(text):
        return None
    if sum(ch.isascii() for ch in text) < 0.97 * len(text):
        return None
    toks = tok_re.findall(text.lower())
    if not toks:
        return None
    if sum(is_word(t) for t in toks) < 0.85 * len(toks):
        return None
    return text, toks


def main():
    seen = set()
    lines = []
    raw = 0
    for path in sorted(glob.glob(SRC)):
        with open(path, encoding="utf-8") as f:
            for row in f:
                try:
                    r = json.loads(row)
                except json.JSONDecodeError:
                    continue
                g = r["g"].split("\n")
                if BULLETS:
                    g = g[: next((i for i, x in enumerate(g) if x.startswith("===")), len(g))]
                    cand = [g[0]] + [x[2:] for x in g[1:] if x.startswith("- ")] if g else []
                else:
                    cand = [g[0]] + [m.group(1) for m in map(name_re.match, g[1:]) if m]
                for c in cand:
                    raw += 1
                    got = clean(c)
                    if not got:
                        continue
                    key = " ".join(got[1])
                    if key in seen:
                        continue
                    seen.add(key)
                    lines.append(got)
    counts = Counter()
    nwords = 0
    for _, toks in lines:
        nwords += len(toks)
        for a, b in zip(toks, toks[1:], strict=False):
            counts[(a, b)] += 1
    with open(OUT_LINES, "w", encoding="utf-8") as f:
        for text, _ in lines:
            f.write(text + "\n")
    with open(OUT_COUNTS, "w", encoding="utf-8") as f:
        for (a, b), c in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])):
            f.write(f"{a} {b}\t{c}\n")
    print(f"raw {raw} kept {len(lines)} lines {nwords} words {len(counts)} bigram types {sum(counts.values())} bigrams")


if __name__ == "__main__":
    main()
