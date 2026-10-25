#!/bin/sh
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/vaportype-pkg-XXXXXX")
trap 'rm -rf "$work"' EXIT
tar -C "$root" --exclude=node_modules --exclude=./keyboard/sim --exclude=./keyboard/bench --exclude=./keyboard/build --exclude=./keyboard/data/inputs --exclude=./out --exclude=./.steamui --exclude=./.git -cf - . | tar -C "$work" -xf -
node "$work/scripts/provenance.mjs" snapshot > "$work/before.json"
node "$work/scripts/provenance.mjs" record "$work/before.json" > /dev/null
fails=0
expect() {
  want=$1
  name=$2
  if sh "$work/scripts/package.sh" > "$work/last.log" 2>&1; then got=ok; else got=refused; fi
  if [ "$got" = "$want" ]; then echo "PASS $name ($got)"; else echo "FAIL $name: expected $want, got $got"; sed 's/^/    /' "$work/last.log"; fails=1; fi
}
expect ok "packages the tested tree"
echo "dist/extra.js" > "$work/dist/extra.js"
expect refused "refuses an unexpected extra file in dist/"
rm "$work/dist/extra.js"
cp "$work/README.md" "$work/README.bak"
printf '\nedited\n' >> "$work/README.md"
expect refused "refuses a changed README"
mv "$work/README.bak" "$work/README.md"
cp "$work/keyboard/data/DATA-LICENSES.md" "$work/dl.bak"
printf '\nedited\n' >> "$work/keyboard/data/DATA-LICENSES.md"
expect refused "refuses a changed DATA-LICENSES.md"
mv "$work/dl.bak" "$work/keyboard/data/DATA-LICENSES.md"
printf 'x' >> "$work/dist/index.js"
expect refused "refuses a changed dist/index.js"
exit $fails
