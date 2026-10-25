import asyncio
import importlib
import json
import os
import sys

sys.dont_write_bytecode = True

here = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(here, "fake_decky"), os.path.dirname(here)]

main = importlib.import_module("main")

real_remove = os.remove


def faulty_remove(path):
    faults = os.environ.get("VAPORTYPE_REMOVE_FAULTS")
    if faults and os.path.exists(faults):
        with open(faults) as f:
            if os.fspath(path) in json.load(f):
                raise PermissionError(13, "Permission denied", path)
    return real_remove(path)


main.os.remove = faulty_remove


async def handle(plugin, req):
    try:
        result = await getattr(plugin, req["name"])(*req["args"])
        reply = {"id": req["id"], "result": result}
    except Exception as e:
        reply = {"id": req["id"], "error": f"{type(e).__name__}: {e}"}
    print(json.dumps(reply), flush=True)


async def run():
    plugin = main.Plugin()
    await plugin._main()
    print(json.dumps({"ready": True}), flush=True)
    loop = asyncio.get_running_loop()
    tasks = set()
    while True:
        line = await loop.run_in_executor(None, sys.stdin.readline)
        if not line:
            break
        task = asyncio.create_task(handle(plugin, json.loads(line)))
        tasks.add(task)
        task.add_done_callback(tasks.discard)
    if tasks:
        await asyncio.gather(*tasks)


asyncio.run(run())
