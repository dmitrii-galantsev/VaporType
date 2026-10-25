#!/bin/sh
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

everywhere='dgalants|dmitrii|galantsev|lsttserver|lsttdev|amd\.com|PCI 0000|0000:[0-9a-f]{2}:[0-9a-f]{2}\.[0-9]|/dev/dri|jev-serve|rat-danio|ts\.net|100\.99\.|\.nvm/|steamdeck\.local|steamdeck\.rat|opencode|osk-trackpad-fix|ewasd|chezmoi|/home/[a-z_][a-z0-9_-]*|/Users/[A-Za-z]|C:\\\\Users|~/git/|~/jev|\.cache/opencode'
names='\b(popi|fenix|yummy|amd|mi210|mi300|instinct|gfx9[0-9a-f]+|runaway)\b'
allowed='dmitrii-galantsev\.github\.io/VaporType\b|((github\.com|githubusercontent\.com|githubassets\.com/1)/)?dmitrii-galantsev/VaporType\b|(github\.com|githubusercontent\.com|githubassets\.com/1)/dmitrii-galantsev(/|\b)|/home/deck/homebrew|/home/deck/\.local/share/Steam|/home/deck/\.config'

scan() {
  pattern=$1
  shift
  grep -rnoIiE ".{0,40}($pattern).{0,40}" \
    --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.steamui --exclude-dir=out \
    --exclude=check-private.sh --exclude=pnpm-lock.yaml "$@" . 2>/dev/null || true
}

hits=$(
  {
    scan "$everywhere"
    scan "$names" --exclude-dir=inputs --exclude=words.js --exclude=lm.js
  } | sed -E "s#$allowed#<allowed>#gI" | grep -iE "$everywhere|$names" || true
)

if [ -n "$hits" ]; then
  echo "private-looking strings found:" >&2
  printf '%s\n' "$hits" >&2
  exit 1
fi
echo "check-private: clean"
