#!/bin/sh
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
work=$(mktemp -d "${TMPDIR:-/tmp}/vaportype-test-XXXXXX")
if command -v pnpm > /dev/null; then pnpm run build > "$work/build.log" 2>&1; else npx -y pnpm@9.15.9 run build > "$work/build.log" 2>&1; fi || {
  cat "$work/build.log"
  exit 1
}
node scripts/provenance.mjs snapshot > "$work/before.json"
mkdir -p "$work/logs"
echo "== simulator suites, plugin test and engine gates (keyboard/sim/test-all.sh)"
PLUGIN=1 OUT="$work/logs" bash keyboard/sim/test-all.sh || {
  echo "logs kept in $work/logs"
  exit 1
}
echo "== backend test (test/backend-test.py)"
python3 test/backend-test.py > "$work/backend.log" 2>&1 || {
  cat "$work/backend.log"
  exit 1
}
tail -1 "$work/backend.log"
node scripts/provenance.mjs record "$work/before.json"
echo "== packaging test (test/package-test.sh)"
sh test/package-test.sh || {
  rm -f test-record.json
  exit 1
}
rm -rf "$work"
