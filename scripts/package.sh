#!/bin/sh
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
list=$(node scripts/provenance.mjs package-list)
mkdir -p out
zip=out/VaporType.zip
rm -f "$zip" "$zip.tmp"
printf '%s\n' "$list" | python3 -c '
import hashlib, json, sys, zipfile
top = "vaportype"
out = sys.argv[1]
files = [l for l in sys.stdin.read().split("\n") if l]
record = json.load(open("test-record.json"))["files"]
def entry(name):
    info = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
    info.external_attr = 0o644 << 16
    return info
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for f in files:
        data = open(f, "rb").read()
        if hashlib.sha256(data).hexdigest() != record.get(f):
            sys.exit(f"package: {f} does not match test-record.json")
        z.writestr(entry(f"{top}/{f}"), data, zipfile.ZIP_DEFLATED, 9)
    z.writestr(entry(f"{top}/test-record.json"), open("test-record.json", "rb").read(), zipfile.ZIP_DEFLATED, 9)
with zipfile.ZipFile(out) as z:
    names = sorted(z.namelist())
    want = sorted([f"{top}/{f}" for f in files] + [f"{top}/test-record.json"])
    if names != want:
        sys.exit("package: zip contents differ from the allowlist")
    for f in files:
        if hashlib.sha256(z.read(f"{top}/{f}")).hexdigest() != record[f]:
            sys.exit(f"package: zipped {f} does not match test-record.json")
' "$zip.tmp"
mv "$zip.tmp" "$zip"
sha256sum "$zip"
