#!/bin/sh
set -eu

repo=dmitrii-galantsev/VaporType
url=${VAPORTYPE_URL:-https://dmitrii-galantsev.github.io/VaporType/VaporType.zip}
homebrew=${DECKY_HOME:-$HOME/homebrew}
plugins=$homebrew/plugins
name=VaporType

say() { printf '%s\n' "$*"; }
die() {
  printf 'install.sh: %s\n' "$*" >&2
  exit 1
}

[ "$(id -u)" -ne 0 ] || die "run this as your normal user (deck), not as root; it asks for sudo when needed"
[ -d "$plugins" ] || die "Decky Loader is not installed ($plugins is missing); install it from https://decky.xyz first"
for tool in curl python3 sudo systemctl; do
  command -v "$tool" > /dev/null || die "$tool is needed but not installed"
done
if ! systemctl cat plugin_loader.service > /dev/null 2>&1; then
  die "the plugin_loader service is missing; reinstall Decky Loader from https://decky.xyz"
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

say "Downloading $url"
curl -fL --retry 3 -o "$work/VaporType.zip" "$url" || die "download failed"
curl -fsL --retry 3 -o "$work/VaporType.zip.sha256" "$url.sha256" || die "checksum download failed: $url.sha256"
want=$(cut -d' ' -f1 < "$work/VaporType.zip.sha256")
got=$(sha256sum "$work/VaporType.zip" | cut -d' ' -f1)
[ "$want" = "$got" ] || die "checksum mismatch: expected $want, got $got"
say "Checksum ok"

folder=$(python3 - "$work/VaporType.zip" "$work/x" "$name" << 'EOF'
import json, sys, zipfile
zip_path, dest, name = sys.argv[1:4]
with zipfile.ZipFile(zip_path) as z:
    tops = [n for n in z.namelist() if n.count("/") == 1 and n.endswith("/plugin.json")]
    if len(tops) != 1:
        sys.exit("the zip does not hold exactly one <folder>/plugin.json")
    if json.loads(z.read(tops[0])).get("name") != name:
        sys.exit(f"the zip is not {name}")
    for n in z.namelist():
        if n.startswith("/") or ".." in n.split("/"):
            sys.exit(f"unsafe path in zip: {n}")
    z.extractall(dest)
print(tops[0].split("/")[0])
EOF
) || die "not a usable VaporType zip"

old=$(python3 - "$plugins" "$name" << 'EOF'
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

say "Installing into $plugins/$folder (sudo asks for your password)"
user=$(id -un)
group=$(id -gn)
for d in $old; do
  sudo rm -rf "${plugins:?}/$d"
done
sudo cp -a "$work/x/$folder" "$plugins/$folder"
sudo chown -R "$user:$group" "$plugins/$folder"
sudo chown root:root "$plugins/$folder" "$plugins/$folder/plugin.json"
sudo chmod 755 "$plugins/$folder" "$plugins/$folder/plugin.json"

say "Restarting Decky Loader"
sudo systemctl restart plugin_loader.service

say ""
say "VaporType is installed. Open the keyboard (STEAM + X) and make the first-use choice."
say "Settings: ... -> Decky -> VaporType. Learned words and settings from earlier installs are kept."
say "Uninstall: curl -L https://raw.githubusercontent.com/$repo/main/uninstall.sh | sh"
