import asyncio
import hashlib
import http.server
import importlib
import io
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import zipfile

sys.dont_write_bytecode = True
work = tempfile.mkdtemp(prefix="vaportype-backend-")
os.environ["HOME"] = work
here = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(here, "fake_decky"), os.path.dirname(here)]

decky = importlib.import_module("decky")

main = importlib.import_module("main")

failures = 0
WORDS = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "user-words.json")
BAK = WORDS + ".bak"
LOG = os.path.join(decky.DECKY_PLUGIN_RUNTIME_DIR, "typing-log.jsonl")
OLD = json.dumps({"version": 1, "words": {"secretword": {"c": 9}}, "bigrams": {}})
EMPTY = json.dumps({"version": 1, "words": {}, "bigrams": {}, "settings": {"consent": True}})


def check(name, ok, detail=""):
    global failures
    print(("PASS " if ok else "FAIL ") + name + (f": {detail}" if detail else ""))
    if not ok:
        failures += 1


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)


def block(path):
    if os.path.lexists(path):
        os.remove(path)
    os.makedirs(os.path.join(path, "stuck"))


def unblock(path, text=None):
    shutil.rmtree(path)
    if text is not None:
        write(path, text)


def holds_secret(path):
    try:
        with open(path) as f:
            return "secretword" in f.read()
    except OSError:
        return False


async def run():
    p = main.Plugin()
    await p._main()
    forget = json.dumps({"removeBackup": True, "clearLog": True, "rev": 1})

    write(WORDS, OLD)
    write(BAK, OLD)
    write(LOG, '{"committed":"secretword"}\n')
    block(WORDS)
    r1 = await p.handle_requests(forget, "s1")
    check("first attempt reports failure while the primary file cannot be deleted", r1["ok"] is False, json.dumps(r1))
    check("the other paths are deleted on the first attempt", not os.path.lexists(BAK) and not os.path.lexists(LOG))
    r2 = await p.handle_requests(forget, "s1")
    check(
        "a same-revision retry still fails while the primary file is there (reviewer probe)",
        r2["ok"] is False and os.path.lexists(WORDS),
        json.dumps(r2),
    )
    check("a retry does not bump the epoch again", r2["epoch"] == r1["epoch"], f"{r1['epoch']} {r2['epoch']}")
    unblock(WORDS, OLD)
    r3 = await p.handle_requests(forget, "s1")
    check(
        "once deletable, the retry deletes the old primary file and only then succeeds",
        r3["ok"] is True and not os.path.lexists(WORDS),
        json.dumps(r3),
    )

    p2 = main.Plugin()
    write(WORDS, OLD)
    block(WORDS + ".bak")
    forget2 = json.dumps({"removeBackup": True, "rev": 2})
    r4 = await p2.handle_requests(forget2, "s1")
    epoch = r4["epoch"]
    check(
        "a new forget deletes the primary file even when the backup is stuck",
        r4["ok"] is False and not os.path.lexists(WORDS),
        json.dumps(r4),
    )
    p3 = main.Plugin()
    pending = (p3._prefs().get("forget") or {}).get("pending", [])
    check("unresolved paths are persisted with the tombstone", pending == [BAK], json.dumps(pending))
    s1 = await p3.save_user_words(json.dumps({**json.loads(EMPTY), "rev": 1, "forgetGen": 1}), epoch)
    check("the post-forget state can be saved while another path is pending", s1["saved"] is True and not holds_secret(WORDS))
    r5 = await p3.handle_requests(forget2, "s1")
    check(
        "a restarted backend keeps retrying the stuck path and does not re-delete the saved state",
        r5["ok"] is False and os.path.isfile(WORDS) and r5["epoch"] == epoch,
        json.dumps(r5),
    )
    unblock(BAK)
    r6 = await p3.handle_requests(forget2, "s1")
    check(
        "acknowledged only after the stuck path is gone",
        r6["ok"] is True and os.path.isfile(WORDS) and not os.path.lexists(BAK),
        json.dumps(r6),
    )

    write(WORDS, OLD)
    block(WORDS)
    forget3 = json.dumps({"removeBackup": True, "rev": 3})
    r7 = await p3.handle_requests(forget3, "s1")
    try:
        await p3.save_user_words(EMPTY, r7["epoch"])
        replaced = True
    except OSError:
        replaced = False
    check(
        "when the replacement save fails the primary path stays pending",
        r7["ok"] is False and not replaced and WORDS in p3._prefs()["forget"]["pending"],
    )
    unblock(WORDS, OLD)
    r8 = await p3.handle_requests(forget3, "s1")
    check(
        "the retry then deletes the old primary file before acknowledging", r8["ok"] is True and not os.path.lexists(WORDS), json.dumps(r8)
    )

    write(WORDS, OLD)
    forget4 = json.dumps({"removeBackup": True, "rev": 4})
    r9 = await p3.handle_requests(forget4, "s1")
    block(BAK)
    s2 = await p3.save_user_words(json.dumps({**json.loads(EMPTY), "rev": 2}), r9["epoch"])
    check(
        "a save right after a forget replaces the primary file and makes no backup of old content",
        s2["saved"] and not holds_secret(WORDS) and not holds_secret(BAK),
    )
    unblock(BAK)

    stale = await p3.save_user_words(OLD, r9["epoch"] - 1)
    check("saves from before a forget are refused", stale["saved"] is False and not holds_secret(WORDS))
    write(LOG, '{"committed":"secretword"}\n')
    block(LOG + ".1")
    forget5 = json.dumps({"removeBackup": True, "clearLog": True, "rev": 5})
    r10 = await p3.handle_requests(forget5, "s1")
    a1 = await p3.append_typing_log(['{"committed":"new"}'], r10["epoch"])
    check(
        "a typing-log append waits while a log path is still pending", r10["ok"] is False and a1["saved"] is False and not holds_secret(LOG)
    )
    unblock(LOG + ".1")
    a2 = await p3.append_typing_log(['{"committed":"new"}'], r10["epoch"])
    check("then appends once the old log is gone", a2["saved"] is True and not holds_secret(LOG))
    a3 = await p3.append_typing_log({"lines": ['{"committed":"batched"}']}, r10["epoch"])
    with open(LOG, encoding="utf-8") as f:
        batched = f.read()
    check("an append sent as an object writes its lines", a3["saved"] is True and '"committed":"batched"' in batched)
    payload = {**json.loads(EMPTY), "words": {"objword": {"c": 2}}, "rev": 7, "forgetGen": 0}
    s3 = await p3.save_user_words(payload, r10["epoch"])
    with open(WORDS, encoding="utf-8") as f:
        written = json.load(f)
    check(
        "words sent as an object are saved without rev or forgetGen",
        s3["saved"] is True and s3["rev"] == 7 and "objword" in written["words"] and "rev" not in written and payload["rev"] == 7,
        json.dumps(written)[:80],
    )
    await p3.save_user_words({**json.loads(EMPTY), "rev": 8, "forgetGen": 2}, r10["epoch"])
    await p3.save_user_words({**json.loads(EMPTY), "rev": 9, "forgetGen": 2}, r10["epoch"])
    await p3.save_user_words({**json.loads(EMPTY), "rev": 1, "forgetGen": 0}, r10["epoch"])
    check("a forget counter reset by a Steam restart keeps the backup", os.path.isfile(WORDS + ".bak"))
    r11 = await p3.handle_requests(json.dumps({"removeBackup": True, "rev": 1}), "s2")
    check("the same revision from a new Steam session is a new forget", r11["epoch"] == r10["epoch"] + 1, f"{r10['epoch']} {r11['epoch']}")

    real_remove = os.remove
    stuck = {WORDS}

    def failing_remove(path):
        if path in stuck:
            raise PermissionError(13, "Permission denied", path)
        return real_remove(path)

    write(WORDS, OLD)
    write(BAK, OLD)
    main.os.remove = failing_remove
    try:
        r12 = await p3.handle_requests(json.dumps({"removeBackup": True, "rev": 6}), "s3")
        check("a forget whose primary file cannot be deleted leaves it pending", r12["ok"] is False and holds_secret(WORDS))
        p4 = main.Plugin()
        await p4._main()
        state = await p4.load_state()
        check(
            "a restarted backend does not load words from a file pending deletion",
            state["userWords"] is None,
            json.dumps(state["userWords"]),
        )
        stuck.add(BAK)
        write(BAK, OLD)
        p4._prefs()["forget"]["pending"].append(BAK)
        p4._save_prefs()
        state2 = await p4.load_state()
        check("nor from a pending backup", state2["userWords"] is None)
    finally:
        main.os.remove = real_remove
    p5 = main.Plugin()
    state3 = await p5.load_state()
    check(
        "once the fault clears, loading retries the deletion and finds nothing",
        state3["userWords"] is None and not os.path.lexists(WORDS) and not os.path.lexists(BAK) and not p5._prefs()["forget"]["pending"],
    )


ROOT = os.path.dirname(here)
TOP_FILES = ["plugin.json", "package.json", "main.py", "LICENSE", "README.md", "test-record.json"]


def package_tree(version, main_extra=""):
    tree = {}
    for f in TOP_FILES:
        with open(os.path.join(ROOT, f), "rb") as fh:
            tree[f] = fh.read()
    pkg = json.loads(tree["package.json"])
    pkg["version"] = version
    tree["package.json"] = json.dumps(pkg, indent=2).encode()
    tree["main.py"] += main_extra.encode()
    dist = os.path.join(ROOT, "dist")
    if os.path.isfile(os.path.join(dist, "index.js")):
        for d, _, names in os.walk(dist):
            for n in names:
                full = os.path.join(d, n)
                with open(full, "rb") as fh:
                    tree[os.path.relpath(full, ROOT).replace(os.sep, "/")] = fh.read()
    else:
        tree["dist/index.js"] = b"export default 1;"
        tree["dist/keyboard/patch.js"] = b"0;"
    tree["dist/index.js"] += f"//{version}".encode()
    return tree


def zip_of(tree, top="vaportype"):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for rel, data in tree.items():
            z.writestr(rel if rel.startswith(("/", "..")) or top is None else f"{top}/{rel}", data)
    return buf.getvalue()


class Server:
    def __init__(self):
        self.routes = {}
        self.hits = []
        owner = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                owner.hits.append(self.path)
                body = owner.routes.get(self.path)
                if body is None:
                    self.send_response(404)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a):
                pass

        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def release(self, version, zdata, sha=None):
        self.routes["/api"] = json.dumps(
            {
                "tag_name": f"v{version}",
                "html_url": f"{self.base}/release",
                "assets": [
                    {"name": "VaporType.zip", "browser_download_url": f"{self.base}/zip"},
                    {"name": "VaporType.zip.sha256", "browser_download_url": f"{self.base}/sha"},
                ],
            }
        ).encode()
        self.routes["/zip"] = zdata
        self.routes["/sha"] = f"{sha or hashlib.sha256(zdata).hexdigest()}  VaporType.zip\n".encode()


def lay_out(root, tree):
    for rel, data in tree.items():
        path = os.path.join(root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)


def state_of(root):
    out = {}
    for d, _, names in os.walk(root):
        for n in names:
            full = os.path.join(d, n)
            with open(full, "rb") as f:
                out[os.path.relpath(full, root)] = f.read()
    return out


async def updates():
    srv = Server()
    os.environ["VAPORTYPE_UPDATE_API"] = srv.base + "/api"
    root = os.path.join(work, "plugins", "VaporType")
    old = package_tree("0.3.0")
    old["dist/keyboard/stale.js"] = b"stale"
    lay_out(root, old)
    main.plugin_dir = lambda: root
    p = main.Plugin()

    srv.release("0.3.0", zip_of(package_tree("0.3.0")))
    s1 = await p.check_update(False)
    check(
        "update: the same version is up to date", s1["current"] == "0.3.0" and s1["available"] is False and not s1["error"], json.dumps(s1)
    )
    srv.release("0.3.1", zip_of(package_tree("0.3.1")))
    hits = len(srv.hits)
    s2 = await p.check_update(False)
    check("update: a second check within 12 h makes no request", len(srv.hits) == hits and s2["available"] is False)
    s3 = await p.check_update(True)
    check("update: a forced check finds the newer release", s3["available"] is True and s3["latest"] == "0.3.1", json.dumps(s3))
    s3b = await main.Plugin().get_update_status()
    check("update: the result is kept in plugin-settings.json", s3b["latest"] == "0.3.1" and s3b["checkedAt"], json.dumps(s3b))
    p._prefs()["update"]["checkedAt"] = time.time() - 13 * 3600
    srv.release("0.2.9", zip_of(package_tree("0.2.9")))
    s4 = await p.check_update(False)
    d4 = await p.install_update("0.2.9")
    check("update: an older release is not offered or installed", s4["available"] is False and d4["ok"] is False, json.dumps(d4))
    srv.routes.pop("/api")
    s5 = await p.check_update(True)
    check("update: a failed check is recorded quietly", bool(s5["error"]) and s5["available"] is False, json.dumps(s5["error"]))

    def attempt(zdata, sha=None):
        srv.release("0.3.1", zdata, sha)

    async def install():
        await p.check_update(True)
        return await p.install_update("0.3.1")

    before = state_of(root)
    attempt(zip_of(package_tree("0.3.1")), sha="0" * 64)
    r1 = await install()
    check(
        "update: a checksum mismatch is refused and nothing changes",
        not r1["ok"] and "checksum" in r1["error"] and state_of(root) == before,
        r1,
    )
    bad = package_tree("0.3.1")
    bad["../evil.py"] = b"x"
    attempt(zip_of(bad))
    r2 = await install()
    check("update: a zip with an unsafe path is refused", not r2["ok"] and "unsafe" in r2["error"] and state_of(root) == before, r2)
    extra = package_tree("0.3.1")
    extra["NEWS.md"] = b"new"
    attempt(zip_of(extra))
    r3 = await install()
    s6 = await p.get_update_status()
    check(
        "update: a new top-level file needs Decky's installer and touches nothing",
        r3.get("needsDecky") and r3["sha256"] and r3["url"] and state_of(root) == before and s6["needsDecky"]["version"] == "0.3.1",
        r3,
    )
    flags = package_tree("0.3.1")
    meta = json.loads(flags["plugin.json"])
    meta["flags"] = ["root"]
    flags["plugin.json"] = json.dumps(meta).encode()
    attempt(zip_of(flags))
    r4 = await install()
    check("update: changed plugin.json flags need Decky's installer", r4.get("needsDecky") and state_of(root) == before, r4)

    real = main.write_in_place

    def failing(path, data):
        if path.endswith("main.py"):
            raise PermissionError(13, "Permission denied", path)
        return real(path, data)

    attempt(zip_of(package_tree("0.3.1")))
    main.write_in_place = failing
    try:
        r5 = await install()
    finally:
        main.write_in_place = real
    s7 = await p.get_update_status()
    check(
        "update: a failure while applying restores every file and is shown in the status",
        not r5["ok"] and "undone" in r5["error"] and state_of(root) == before and s7["failed"]["version"] == "0.3.1",
        r5,
    )

    new = package_tree("0.3.1", "\nUPDATED = True\n")
    meta = json.loads(new["plugin.json"])
    meta["publish"] = {**meta.get("publish", {}), "description": "changed"}
    new["plugin.json"] = json.dumps(meta).encode()
    new.pop("dist/keyboard/patch.js", None)
    attempt(zip_of(new))
    top_before = {n: os.stat(os.path.join(root, n)).st_ino for n in os.listdir(root)}
    os.chmod(root, 0o555)
    try:
        r6 = await install()
    finally:
        os.chmod(root, 0o755)
    after = state_of(root)
    top_after = {n: os.stat(os.path.join(root, n)).st_ino for n in os.listdir(root)}
    check(
        "update: a publish-only plugin.json change is applied in place with the folder read-only",
        r6["ok"] is True and top_after == top_before,
        r6,
    )
    check(
        "update: dist and main.py are replaced, stale dist files removed, plugin.json kept",
        after.get("main.py") == new["main.py"]
        and after.get("dist/index.js") == new["dist/index.js"]
        and "dist/keyboard/stale.js" not in after
        and after["plugin.json"] == before["plugin.json"]
        and json.loads(after["package.json"])["version"] == "0.3.1"
        and all(after.get(rel) == data for rel, data in new.items() if rel != "plugin.json"),
        sorted(set(after) ^ set(new)),
    )
    s8 = await p.get_update_status()
    check("update: after the update it is up to date", s8["current"] == "0.3.1" and not s8["available"] and not s8["failed"], s8)
    rec1 = await main.Plugin().take_update_record()
    rec2 = await main.Plugin().take_update_record()
    check(
        "update: the record of the update is read once", rec1 and rec1["from"] == "0.3.0" and rec1["to"] == "0.3.1" and rec2 is None, rec1
    )
    auto = await main.Plugin().set_auto_update(False)
    check(
        "update: automatic updates can be turned off and the choice is kept",
        auto is False and (await main.Plugin().get_update_status())["autoUpdate"] is False,
    )
    srv.httpd.shutdown()


asyncio.run(run())
asyncio.run(updates())
shutil.rmtree(work, ignore_errors=True)
print("ALL PASS" if not failures else f"{failures} failed")
sys.exit(1 if failures else 0)
