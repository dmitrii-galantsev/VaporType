import asyncio
import hashlib
import io
import json
import os
import re
import shutil
import ssl
import time
import urllib.request
import zipfile

import decky

USER_WORDS = "user-words.json"
PLUGIN_SETTINGS = "plugin-settings.json"
TYPING_LOG = "typing-log.jsonl"
LOG_MAX = 5 * 1024 * 1024
NAME = "VaporType"
RELEASES_API = "https://api.github.com/repos/dmitrii-galantsev/VaporType/releases/latest"
PAGES_ZIP = "https://dmitrii-galantsev.github.io/VaporType/VaporType.zip"
CHECK_EVERY = 12 * 3600
RETRY_AFTER_ERROR = 3600
ZIP_MAX = 32 * 1024 * 1024
HTTP_TIMEOUT = 10


def settings_path(name):
    return os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, name)


def runtime_path(name):
    return os.path.join(decky.DECKY_PLUGIN_RUNTIME_DIR, name)


def write_atomic(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def remove_quietly(path):
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    except OSError as e:
        decky.logger.warning("could not delete %s: %s", path, e)
        return False
    return True


def remove_all(paths):
    ok = True
    for path in paths:
        ok = remove_quietly(path) and ok
    return ok


def plugin_dir():
    return os.path.dirname(os.path.abspath(__file__))


def word_files(directory):
    return [os.path.join(directory, USER_WORDS + suffix) for suffix in ("", ".bak", ".tmp")]


def log_files(directory):
    return [os.path.join(directory, TYPING_LOG + suffix) for suffix in ("", ".1")]


def version_tuple(v):
    m = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)", str(v or "").strip())
    return tuple(int(x) for x in m.groups()) if m else None


def installed_version():
    return (read_json(os.path.join(plugin_dir(), "package.json")) or {}).get("version")


def tls_context():
    try:
        import certifi
    except ImportError:
        return ssl.create_default_context()
    return ssl.create_default_context(cafile=certifi.where())


def http_get(url, limit):
    req = urllib.request.Request(url, headers={"User-Agent": f"{NAME}-updater", "Accept": "application/vnd.github+json, */*"})
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT, context=tls_context()) as r:
        data = r.read(limit + 1)
    if len(data) > limit:
        raise ValueError(f"{url} is larger than {limit} bytes")
    return data


def fetch_release():
    rel = json.loads(http_get(os.environ.get("VAPORTYPE_UPDATE_API") or RELEASES_API, 1024 * 1024))
    assets = {a.get("name"): a.get("browser_download_url") for a in rel.get("assets") or [] if isinstance(a, dict)}
    return {
        "latest": str(rel.get("tag_name") or "").lstrip("v"),
        "htmlUrl": rel.get("html_url"),
        "zip": assets.get("VaporType.zip"),
        "sha": assets.get("VaporType.zip.sha256"),
    }


def zip_tree(data, version):
    z = zipfile.ZipFile(io.BytesIO(data))
    files = {}
    for info in z.infolist():
        name = info.filename
        if name.startswith("/") or "\\" in name or ".." in name.split("/") or ":" in name:
            raise ValueError(f"unsafe path in zip: {name}")
        if (info.external_attr >> 16) & 0o170000 == 0o120000:
            raise ValueError(f"link in zip: {name}")
        if not name.endswith("/"):
            files[name] = info
    tops = {n.split("/", 1)[0] for n in files}
    if len(tops) != 1 or any("/" not in n for n in files):
        raise ValueError("the zip does not hold exactly one top folder")
    top = tops.pop()
    out = {n[len(top) + 1 :]: z.read(info) for n, info in files.items()}
    if any(not rel or rel.endswith("/") for rel in out):
        raise ValueError("unsafe path in zip")
    meta = json.loads(out.get("plugin.json") or b"null")
    if not isinstance(meta, dict) or meta.get("name") != NAME:
        raise ValueError("the zip is not VaporType")
    pkg = json.loads(out.get("package.json") or b"null")
    if not isinstance(pkg, dict) or pkg.get("version") != version:
        raise ValueError(f"the zip holds version {(pkg or {}).get('version')}, not {version}")
    if "main.py" not in out or "dist/index.js" not in out:
        raise ValueError("the zip lacks main.py or dist/index.js")
    return out


def needs_decky(tree, root):
    old = read_json(os.path.join(root, "plugin.json")) or {}
    new = json.loads(tree["plugin.json"])
    if {k: v for k, v in old.items() if k != "publish"} != {k: v for k, v in new.items() if k != "publish"}:
        return "plugin.json changed"
    for rel in tree:
        first = rel.split("/", 1)[0]
        path = os.path.join(root, first)
        if "/" in rel and not os.path.isdir(path):
            return f"new folder {first}"
        if "/" not in rel and not os.path.isfile(path):
            return f"new file {first}"
    return None


def write_in_place(path, data):
    with open(path, "r+b") as f:
        f.write(data)
        f.truncate()
        f.flush()
        os.fsync(f.fileno())


def write_dist(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".vt-new"
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def files_under(root, sub):
    out = {}
    base = os.path.join(root, sub)
    for d, _, names in os.walk(base):
        for n in names:
            full = os.path.join(d, n)
            out[os.path.relpath(full, root).replace(os.sep, "/")] = full
    return out


def snapshot(root, tree):
    snap = {}
    for rel, full in files_under(root, "dist").items():
        with open(full, "rb") as f:
            snap[rel] = f.read()
    for rel in tree:
        if "/" not in rel and rel != "plugin.json":
            with open(os.path.join(root, rel), "rb") as f:
                snap[rel] = f.read()
    return snap


def apply_tree(root, tree):
    for rel, data in tree.items():
        if rel.startswith("dist/"):
            write_dist(os.path.join(root, rel), data)
    for rel, full in files_under(root, "dist").items():
        if rel not in tree:
            os.remove(full)
    for d, subs, names in os.walk(os.path.join(root, "dist"), topdown=False):
        if not subs and not names and d != os.path.join(root, "dist"):
            os.rmdir(d)
    for rel in sorted(r for r in tree if "/" not in r and r not in ("plugin.json", "main.py")):
        if read_bytes(os.path.join(root, rel)) != tree[rel]:
            write_in_place(os.path.join(root, rel), tree[rel])
    write_in_place(os.path.join(root, "main.py"), tree["main.py"])


def restore_tree(root, snap):
    for rel, full in files_under(root, "dist").items():
        if rel not in snap:
            os.remove(full)
    for rel, data in snap.items():
        path = os.path.join(root, rel)
        if rel.startswith("dist/"):
            if read_bytes(path) != data:
                write_dist(path, data)
        elif read_bytes(path) != data:
            write_in_place(path, data)


def read_bytes(path):
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        return None


class Plugin:
    lock = None
    update_lock = None
    prefs = None
    saved_forget_gen = None

    def _lock(self):
        if self.lock is None:
            self.lock = asyncio.Lock()
        return self.lock

    def _update_lock(self):
        if self.update_lock is None:
            self.update_lock = asyncio.Lock()
        return self.update_lock

    def _prefs(self):
        if self.prefs is None:
            self.prefs = read_json(settings_path(PLUGIN_SETTINGS)) or {}
            self.prefs.setdefault("enabled", True)
            self.prefs.setdefault("epoch", 0)
            self.prefs.setdefault("autoUpdate", True)
        return self.prefs

    def _save_prefs(self):
        write_atomic(settings_path(PLUGIN_SETTINGS), json.dumps(self._prefs()))

    def _forget_targets(self):
        return word_files(decky.DECKY_PLUGIN_SETTINGS_DIR) + log_files(decky.DECKY_PLUGIN_RUNTIME_DIR)

    def _forget(self, key):
        prefs = self._prefs()
        prefs["epoch"] += 1
        prefs["forget"] = {"key": key, "epoch": prefs["epoch"], "pending": self._forget_targets()}
        self._save_prefs()
        return self._settle()

    def _settle(self):
        forget = self._prefs().get("forget")
        if not forget:
            return True
        left = []
        for path in forget["pending"]:
            remove_quietly(path)
            if os.path.lexists(path):
                left.append(path)
        if left != forget["pending"]:
            forget["pending"] = left
            self._save_prefs()
        decky.logger.info("forget epoch %d: %s", forget["epoch"], "done" if not left else "still to delete: " + ", ".join(left))
        return not left

    def _pending(self, path):
        forget = self._prefs().get("forget")
        return bool(forget) and path in forget["pending"]

    def _resolved(self, path):
        forget = self._prefs().get("forget")
        if forget and path in forget["pending"]:
            forget["pending"] = [p for p in forget["pending"] if p != path]
            self._save_prefs()

    async def load_state(self):
        async with self._lock():
            self._settle()
            words = None
            for path in word_files(decky.DECKY_PLUGIN_SETTINGS_DIR)[:2]:
                if self._pending(path):
                    continue
                words = read_json(path)
                if words is not None:
                    break
            prefs = self._prefs()
            try:
                installed = time.strftime("%Y-%m-%d", time.localtime(os.path.getmtime(os.path.join(plugin_dir(), "plugin.json"))))
            except OSError:
                installed = None
            version = (read_json(os.path.join(plugin_dir(), "package.json")) or {}).get("version")
            return {
                "userWords": words,
                "enabled": prefs["enabled"],
                "epoch": prefs["epoch"],
                "install": {"date": installed, "via": "decky", "decky": decky.DECKY_VERSION, "plugin": version},
            }

    async def set_enabled(self, enabled: bool):
        async with self._lock():
            self._prefs()["enabled"] = bool(enabled)
            self._save_prefs()
            return self._prefs()["enabled"]

    async def save_user_words(self, payload, epoch: int):
        async with self._lock():
            current = self._prefs()["epoch"]
            if epoch != current:
                return {"saved": False, "epoch": current}
            data = json.loads(payload) if isinstance(payload, str) else payload
            if not isinstance(data, dict):
                raise ValueError("user words must be a JSON object")
            data = dict(data)
            rev = data.pop("rev", None)
            gen = data.pop("forgetGen", None)
            path = settings_path(USER_WORDS)
            forgot = gen is not None and self.saved_forget_gen is not None and gen > self.saved_forget_gen
            if forgot or self._pending(path):
                remove_quietly(path + ".bak")
            elif os.path.isfile(path):
                shutil.copyfile(path, path + ".bak")
            write_atomic(path, json.dumps(data))
            self._resolved(path)
            self._resolved(path + ".tmp")
            self.saved_forget_gen = gen
            return {"saved": True, "rev": rev, "gen": gen, "epoch": current}

    async def append_typing_log(self, lines, epoch: int):
        if isinstance(lines, dict):
            lines = lines.get("lines")
        if not isinstance(lines, list):
            raise ValueError("typing log lines must be a list")
        async with self._lock():
            current = self._prefs()["epoch"]
            if epoch != current or not lines:
                return {"saved": False, "epoch": current}
            path = runtime_path(TYPING_LOG)
            if (
                (self._pending(path) or self._pending(path + ".1"))
                and not self._settle()
                and (self._pending(path) or self._pending(path + ".1"))
            ):
                return {"saved": False, "epoch": current}
            os.makedirs(os.path.dirname(path), exist_ok=True)
            try:
                if os.path.getsize(path) >= LOG_MAX:
                    os.replace(path, path + ".1")
            except OSError:
                pass
            with open(path, "a", encoding="utf-8") as f:
                f.write("".join(str(line) + "\n" for line in lines))
            return {"saved": True, "epoch": current}

    async def handle_requests(self, payload: str, session: str = ""):
        async with self._lock():
            req = json.loads(payload)
            rev = req.get("rev")
            ok = True
            if req.get("forget") or req.get("removeBackup"):
                key = f"{session}:{rev}" if session and rev is not None else None
                forget = self._prefs().get("forget")
                if key is not None and forget and forget.get("key") == key:
                    ok = self._settle()
                else:
                    ok = self._forget(key)
            if req.get("clearLog"):
                paths = log_files(decky.DECKY_PLUGIN_RUNTIME_DIR)
                remove_all(paths)
                ok = not any(os.path.lexists(p) for p in paths) and ok
            return {"epoch": self._prefs()["epoch"], "rev": rev, "ok": ok}

    async def forget_all(self):
        async with self._lock():
            ok = self._forget(None)
            return {"epoch": self._prefs()["epoch"], "ok": ok}

    def _update_status(self):
        prefs = self._prefs()
        u = dict(prefs.get("update") or {})
        current = installed_version()
        latest = u.get("latest")
        available = bool(version_tuple(latest) and version_tuple(current) and version_tuple(latest) > version_tuple(current))
        nd = u.get("needsDecky") if (u.get("needsDecky") or {}).get("version") == latest else None
        failed = u.get("failed") if (u.get("failed") or {}).get("version") == latest else None
        return {
            "current": current,
            "latest": latest,
            "available": available,
            "htmlUrl": u.get("htmlUrl"),
            "checkedAt": u.get("checkedAt"),
            "error": u.get("error"),
            "needsDecky": nd if available else None,
            "failed": failed if available else None,
            "autoUpdate": prefs["autoUpdate"],
        }

    async def get_update_status(self):
        return self._update_status()

    async def set_auto_update(self, on: bool):
        self._prefs()["autoUpdate"] = bool(on)
        self._save_prefs()
        return self._prefs()["autoUpdate"]

    async def check_update(self, force: bool = False):
        async with self._update_lock():
            u = self._prefs().get("update") or {}
            last = u.get("checkedAt") or 0
            wait = RETRY_AFTER_ERROR if u.get("error") else CHECK_EVERY
            if force or time.time() - last >= wait:
                try:
                    rel = await asyncio.get_running_loop().run_in_executor(None, fetch_release)
                    if not version_tuple(rel["latest"]):
                        raise ValueError(f"unexpected release tag {rel['latest']!r}")
                    keep = {k: u[k] for k in ("needsDecky", "failed") if k in u}
                    u = {**keep, **rel, "checkedAt": time.time(), "error": None}
                except Exception as e:
                    u = {**u, "checkedAt": time.time(), "error": str(e)[:200]}
                    decky.logger.info("update check failed: %s", e)
                self._prefs()["update"] = u
                self._save_prefs()
            return self._update_status()

    async def install_update(self, version: str, auto: bool = False):
        async with self._update_lock():
            status = self._update_status()
            u = self._prefs().get("update") or {}
            if status["latest"] != version or not status["available"]:
                return {"ok": False, "error": f"{version} is not a newer release"}
            try:
                result = await asyncio.get_running_loop().run_in_executor(None, self._install, version, u["zip"], u["sha"])
            except Exception as e:
                result = {"ok": False, "error": str(e)[:200]}
            if result.get("needsDecky"):
                u["needsDecky"] = {"version": version, "url": result["url"], "sha256": result["sha256"], "reason": result["reason"]}
            elif not result["ok"]:
                u["failed"] = {"version": version, "error": result["error"], "at": time.time()}
            else:
                u.pop("failed", None)
                self._prefs()["updated"] = {"from": status["current"], "to": version, "at": time.time(), "auto": bool(auto)}
            self._prefs()["update"] = u
            self._save_prefs()
            return result

    def _install(self, version, zip_url, sha_url):
        if not zip_url or not sha_url:
            raise ValueError("the release has no VaporType.zip or its .sha256")
        want = http_get(sha_url, 4096).decode("ascii", "replace").split()[0].lower()
        data = http_get(zip_url, ZIP_MAX)
        got = hashlib.sha256(data).hexdigest()
        if got != want:
            raise ValueError(f"checksum mismatch: expected {want[:12]}, got {got[:12]}")
        tree = zip_tree(data, version)
        root = plugin_dir()
        reason = needs_decky(tree, root)
        if reason:
            return {"ok": False, "needsDecky": True, "reason": reason, "url": PAGES_ZIP, "sha256": got, "version": version}
        snap = snapshot(root, tree)
        backup = runtime_path("update-backup.zip")
        os.makedirs(os.path.dirname(backup), exist_ok=True)
        with zipfile.ZipFile(backup, "w", zipfile.ZIP_DEFLATED) as z:
            for rel, b in snap.items():
                z.writestr(rel, b)
        try:
            apply_tree(root, tree)
        except Exception as e:
            try:
                restore_tree(root, snap)
            except Exception as e2:
                decky.logger.error("update restore failed: %s", e2)
                return {"ok": False, "error": f"update failed ({e}) and the restore failed ({e2}); reinstall from Decky"}
            decky.logger.warning("update to %s failed, restored: %s", version, e)
            return {"ok": False, "error": f"update failed and was undone: {e}"}
        decky.logger.info("updated to %s", version)
        return {"ok": True, "version": version}

    async def take_update_record(self):
        rec = self._prefs().pop("updated", None)
        if rec is not None:
            self._save_prefs()
        return rec

    async def _main(self):
        decky.logger.info("VaporType backend ready")

    async def _unload(self):
        decky.logger.info("VaporType backend unloading")

    async def _uninstall(self):
        decky.logger.info("VaporType uninstalled; learned words stay in %s until removed", decky.DECKY_PLUGIN_SETTINGS_DIR)
