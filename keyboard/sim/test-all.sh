#!/usr/bin/env bash
set -uo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
out=${OUT:-$(mktemp -d "${TMPDIR:-/tmp}/vaportype-tests-XXXX")}
mkdir -p "$out"
jobs=()
start=$SECONDS
limit=${JOBS:-$(( $(nproc) / 2 > 0 ? $(nproc) / 2 : 1 ))}
only=" $* "
wanted() { [ "$only" = "  " ] || [[ "$only" == *" $1 "* ]]; }
run() {
  local name=$1 dir=$2; shift 2
  wanted "$name" || return 0
  while [ "$(jobs -rp | wc -l)" -ge "$limit" ]; do wait -n; done
  (
    t0=$(date +%s%N)
    cd "$root/$dir" && env "$@"
    c=$?
    LC_ALL=C awk -v ns="$(( $(date +%s%N) - t0 ))" 'BEGIN { printf "secs %.9f\n", ns / 1e9 }'
    echo "exit $c"
  ) > "$out/$name.log" 2>&1 &
  jobs+=("$name")
}
first=(twopad-test settings-test)
if [ -n "${PLUGIN:-}" ] || [[ "$only" == *" plugin-sim "* ]]; then run plugin-sim ../test timeout 900 node plugin-sim.mjs; fi
for n in "${first[@]}"; do run "$n" sim timeout 900 node "$n.mjs"; done
run swipe-test-modes sim WITH_MODES=1 timeout 900 node swipe-test.mjs
for f in "$root"/sim/test.mjs "$root"/sim/*-test.mjs; do
  n=$(basename "$f" .mjs)
  [ "$n" = perf-test ] && continue
  [[ " ${first[*]} " == *" $n "* ]] && continue
  run "$n" sim timeout 900 node "$(basename "$f")"
done
run gates bench timeout 900 node gates.mjs --jobs 4
wait
limit=1
run perf-test sim timeout 900 node perf-test.mjs
wait
if [ ${#jobs[@]} -eq 0 ]; then
  echo "no suite matches: $*" >&2
  exit 2
fi
fail=0
for n in "${jobs[@]}"; do
  log="$out/$n.log"
  code=$(tail -1 "$log" | sed -n 's/^exit //p')
  p=$(grep -c '^PASS' "$log"); f=$(grep -c '^FAIL' "$log")
  if [ "$code" = 0 ] && [ "$f" = 0 ]; then s=ok; else s=FAIL; fail=1; fi
  t=$(sed -n 's/^secs //p' "$log" | tail -1)
  printf '%-18s %-4s pass %-3s fail %-3s %6.1f s\n' "$n" "$s" "$p" "$f" "${t:-0}"
  if [ "$s" = FAIL ]; then
    case "$code" in
      0) ;;
      124) printf '    timeout (exit 124); log: %s\n' "$log" ;;
      *) printf '    exit %s; log: %s\n' "${code:-unknown}" "$log" ;;
    esac
    grep -m 8 -E '^FAIL|Error' "$log" | sed 's/^/    /'
  fi
done
echo "logs: $out  wall: $((SECONDS - start)) s"
exit $fail
