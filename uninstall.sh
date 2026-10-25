#!/bin/sh
set -eu

homebrew=${DECKY_HOME:-$HOME/homebrew}
plugins=$homebrew/plugins
name=VaporType
purge=no
[ "${1:-}" = "--purge" ] && purge=yes

die() {
  printf 'uninstall.sh: %s\n' "$*" >&2
  exit 1
}

[ "$(id -u)" -ne 0 ] || die "run this as your normal user (deck), not as root; it asks for sudo when needed"
[ -d "$plugins" ] || die "Decky Loader is not installed ($plugins is missing)"
command -v python3 > /dev/null || die "python3 is needed but not installed"

found=$(python3 - "$plugins" "$name" << 'EOF'
import json, os, sys
plugins, name = sys.argv[1:3]
for d in sorted(os.listdir(plugins)):
    try:
        with open(os.path.join(plugins, d, "plugin.json"), encoding="utf-8") as f:
            if json.load(f).get("name") == name:
                print(d)
    except (OSError, ValueError):
        pass
EOF
)

if [ -z "$found" ]; then
  printf 'VaporType is not installed in %s\n' "$plugins"
else
  for d in $found; do
    printf 'Removing %s (sudo asks for your password)\n' "$plugins/$d"
    sudo rm -rf "${plugins:?}/$d"
  done
  sudo systemctl restart plugin_loader.service
  printf "Removed. Steam's own keyboard is back.\n"
fi

if [ "$purge" = yes ]; then
  sudo rm -rf "$homebrew/settings/vaportype" "$homebrew/data/vaportype"
  printf 'Deleted learned words, settings and the typing log. Steam keeps its own copy of the words unless you pressed Forget everything before uninstalling.\n'
else
  printf 'Learned words and settings stay in %s; run with --purge to delete them:\n' "$homebrew/settings/vaportype"
  printf '  curl -L https://raw.githubusercontent.com/dmitrii-galantsev/VaporType/main/uninstall.sh | sh -s -- --purge\n'
fi
