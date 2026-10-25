#!/bin/sh
set -eu
usage="usage: scripts/fetch-steamui.sh <ssh destination, e.g. deck@my-deck> [remote steamui dir] [local dir]"
host=${1:?$usage}
remote=${2:-.local/share/Steam/steamui/}
root=$(cd "$(dirname "$0")/.." && pwd)
dest=${3:-$root/.steamui}
mkdir -p "$dest"
rsync -a --delete "$host:${remote%/}/" "$dest/"
test -f "$dest/library.js" || { echo "no library.js in $host:$remote; is that Steam's steamui folder?" >&2; exit 1; }
echo "copied $(find "$dest" -type f | wc -l) files to $dest"
