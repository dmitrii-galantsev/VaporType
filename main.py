import asyncio
import json
import os
import shutil
import time

import decky

USER_WORDS = "user-words.json"
PLUGIN_SETTINGS = "plugin-settings.json"
TYPING_LOG = "typing-log.jsonl"
LOG_MAX = 5 * 1024 * 1024


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


class Plugin:
    lock = None
    prefs = None
    saved_forget_gen = None

    def _lock(self):
        if self.lock is None:
            self.lock = asyncio.Lock()
        return self.lock

    def _prefs(self):
        if self.prefs is None:
            self.prefs = read_json(settings_path(PLUGIN_SETTINGS)) or {}
            self.prefs.setdefault("enabled", True)
            self.prefs.setdefault("epoch", 0)
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

    async def _main(self):
        decky.logger.info("VaporType backend ready")

    async def _unload(self):
        decky.logger.info("VaporType backend unloading")

    async def _uninstall(self):
        decky.logger.info("VaporType uninstalled; learned words stay in %s until removed", decky.DECKY_PLUGIN_SETTINGS_DIR)
