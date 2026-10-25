# How the plugin fits into Decky Loader

Read from the sources on 2026-10-23: decky-loader `main` at 00cd2028 (latest tag v3.3.0), decky-plugin-template
at 90d0780e, Decky CLI at 6c32da73, @decky/api 1.1.3, @decky/ui 4.16.0.

## Which JavaScript context

Decky injects its frontend into the Steam tab whose title is `SharedJSContext` (or one of its older names) and
whose URL is `https://steamloopback.host/routes/...` or `.../index.html`
(`backend/decky_loader/injector.py`: `SHARED_CTX_NAMES`, `tab_is_gamepadui`; `main.py`: `loader_reinjector`).
Plugin frontends are ES modules imported into that same window from
`http://127.0.0.1:1337/plugins/<name>/dist/index.js` (`frontend/src/plugin-loader.tsx`, `ESMODULE_V1`, chosen when
`package.json` has `"type": "module"`). @decky/ui reaches Steam's webpack modules through
`window.webpackChunksteamui` and windows through `window.SteamUIStore` (`dist/webpack.js`, `dist/modules/Router.js`).

`patch.js` uses exactly these globals (`SteamClient.Input`, `webpackChunksteamui`, `SteamUIStore` and the keyboard
component found through the window documents), and the standalone injector evaluates it in the tab titled
`SharedJSContext`. So the plugin evaluates the same files in the same window. Decky's own legacy loader uses
`eval` in that window, so indirect `eval` is allowed there.

## How the files load

`pnpm run build` copies the runtime files unchanged to `dist/keyboard/` (`patch.js`, `modes.js`, `swipe/`; the map
from `keyboard/src` and `keyboard/data` is `keyboard/runtime.mjs`) and writes `manifest.json` (version, size,
sha256). The loader serves anything under `/plugins/<name>/dist/` without the auth token (`helpers.py`:
`dist_regex`; `loader.py`: `handle_plugin_dist`). `src/keyboard.ts` fetches the files relative to
`import.meta.url` and evaluates them with indirect `eval`, in the order words, lm, engine, modes (each only when the
loaded version differs) and then `patch.js`, as the standalone injector does.

## Persistence

Python backend (`main.py`, `Plugin` class, methods called with `callable()` from @decky/api). Files:

- `~/homebrew/settings/vaportype/user-words.json` (+ `.bak`), written through a temp file, fsync and rename
- `~/homebrew/settings/vaportype/plugin-settings.json` (enabled, forget epoch, migration tombstones)
- `~/homebrew/data/vaportype/typing-log.jsonl` (+ `.1`, rotated at 5 MB)

`DECKY_PLUGIN_SETTINGS_DIR` and `DECKY_PLUGIN_RUNTIME_DIR` are named after the plugin's folder, which is the zip's
top folder (`sandboxed_plugin.py`). Every 5 s the frontend runs the standalone injector's protocol, requests first:
`takeRequests` → handle → `ackRequests(rev)` when the request carries a revision, `takeUserWords` → save →
`ackUserWords(rev)`, `takeTypingLog` → append → `ackTypingLog(upTo)`. Requests are handled on every cycle; words
and the typing log are taken only when the keyboard is closed (`keyboardOpen()`), after 60 s with it open, when
200 log lines are waiting, and on disable, unload and forget. Typing 50 words in one keyboard session is one save
and, with the typing log on, one append.

Decky Loader (v3.3.0, `frontend/src/wsrouter.ts`) logs every call with `console.debug("Calling PY method … with
args", args)`, unconditionally, and Steam writes that line to `~/.local/share/Steam/logs/webhelper_js.txt` with the
arguments turned into strings. A JSON string argument lands there whole (0.2.0 put the whole dictionary and every
typing-log line into Steam's log, once per word). The frontend therefore sends the words and the log lines as
objects, which that line shows as `[object Object]`; what Steam logs is the method name, the epoch, the request
flags (`{"removeBackup":true,"rev":3}`) and the Steam-session id. The words payload carries `forgetGen`
(not written to the file): when it differs from the last saved one the backend writes without a backup and deletes
`.bak`; if `window.__oskTrackpadFix.forgetGen` moved while the save was in flight, the frontend handles the requests
again and saves once more before acknowledging, so a forget always wins. The frontend sets `hostAcks = true` on
every cycle and acknowledges a request only when every deletion succeeded (a missing file counts as deleted); the
backend keeps every path a forget could not delete in `plugin-settings.json` with the tombstone (keyed by the
frontend's Steam-session id and the request revision), retries exactly those, and reports success only when each is
gone from disk or, for `user-words.json`, replaced by a save made after the forget. A retry does not bump the epoch. Nothing reads a path that is still pending deletion: `load_state`
skips it, and `load_state` retries the deletions first. Snapshots taken before a
forget (words or typing log) are dropped, and the backend refuses saves and appends from an older epoch. This matches the standalone `inject.mjs`.

All backend calls go through one queue in the frontend and one lock in the backend. A forget (Quick Access
button, or the keyboard panel's request) bumps a persisted epoch; saves carry the epoch they were taken under and
the backend refuses older ones, so a save in flight cannot bring forgotten words back.

Every transition (start, enable, disable, unload) bumps a generation; code is evaluated only while the generation
that fetched it is current and the plugin is enabled and not unloaded, so a slow fetch cannot leave the patch
running after disable or unload. Disable and unload stop the patch synchronously, before any backend call.

## Install, update, uninstall

- Zip layout: one top folder holding `plugin.json`, `package.json`, `main.py`, `LICENSE`, `README.md` and `dist/`
  (template README "Distribution"; CLI `src/cli/plugin/build.rs`, `zip_plugin`). A dev install needs exactly one
  `<folder>/plugin.json` (`browser.py`, `_install`).
- Manual install: Decky settings → General → Developer mode, then Developer → "Install Plugin from URL" or "Install
  Plugin from ZIP File" (`frontend/src/components/settings/pages/developer/index.tsx`, locale
  `SettingsDeveloperIndex.third_party_plugins`). ZIP install exists since 2023-04 (decky-loader #405); reading the
  plugin name from the zip's `plugin.json` since 2024-02 (#578).
- Installing over an existing copy uninstalls it first and that calls `_uninstall` (`browser.py`, `_install` →
  `uninstall_plugin` → `stop(uninstall=True)`). So `_uninstall` must not delete learned words, or every update
  would wipe them. Decky does not remove `~/homebrew/settings/<plugin>` on uninstall either.
- Unload, disable and uninstall call the frontend's `onDismount` (`plugin-loader.tsx`, `unloadPlugin`), where the
  plugin calls `stop()`.

## Store

Submission is a pull request adding the repo as a submodule to SteamDeckHomebrew/decky-plugin-database, reviewed by
the Loader team and tested on SteamOS Stable and Beta (https://wiki.deckbrew.xyz/en/plugin-dev/submitting-plugins).
The PR template requires ticking "Generative AI was NOT used to write a majority of the code I am submitting", and
the wiki says "We do not accept any plugin that uses any LLM based code". Until that is settled, releases are
installed from the GitHub release URL, a zip, or `install.sh`.
