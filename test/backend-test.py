import asyncio
import importlib
import json
import os
import shutil
import sys
import tempfile

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


asyncio.run(run())
shutil.rmtree(work, ignore_errors=True)
print("ALL PASS" if not failures else f"{failures} failed")
sys.exit(1 if failures else 0)
