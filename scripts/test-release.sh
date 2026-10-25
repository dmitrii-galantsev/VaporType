#!/bin/sh
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
work=$(mktemp -d "${TMPDIR:-/tmp}/vaportype-test-XXXXXX")
trap 'rm -rf "$work"' EXIT
pnpm run build >/dev/null 2>&1 || npx -y pnpm@9 run build >/dev/null
node scripts/provenance.mjs snapshot > "$work/before.json"
mkdir -p "$work/logs"
echo "== simulator suites and engine gates (keyboard/sim/test-all.sh)"
OUT="$work/logs" bash keyboard/sim/test-all.sh
echo "== backend test (test/backend-test.py)"
python3 test/backend-test.py > "$work/backend.log" 2>&1 || { cat "$work/backend.log"; exit 1; }
tail -1 "$work/backend.log"
echo "== plugin test (test/plugin-sim.mjs)"
node test/plugin-sim.mjs
node scripts/provenance.mjs record "$work/before.json"
echo "== packaging test (test/package-test.sh)"
sh test/package-test.sh || { rm -f test-record.json; exit 1; }
