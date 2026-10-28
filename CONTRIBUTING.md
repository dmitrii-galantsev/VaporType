# Contributing

## Layout

| path | what |
|---|---|
| `keyboard/src/patch.js` | the keyboard change itself, evaluated in Steam's `SharedJSContext` |
| `keyboard/src/modes.js` | typing modes (Standard, Big letter keys): pad maps and the pointer overlay |
| `keyboard/src/engine.js` | swipe decoder, suggestions, autocorrect, learning |
| `keyboard/src/inject.mjs` | optional standalone injector (no Decky): loads the files over CEF remote debugging |
| `keyboard/data/` | `words.js`, `lm.js` (CC BY-SA 4.0, see `DATA-LICENSES.md`) and `inputs/` they are built from |
| `keyboard/build/` | `build_words.py` (rebuilds `words.js` / `lm.js` byte for byte) and the chat/web text generators |
| `keyboard/bench/` | engine and pad-tap benches, `gates.mjs` (accuracy floors), `corpora/`, `geometry.json` |
| `keyboard/sim/` | simulator: Steam's real keyboard in headless Chromium, every suite, `test-all.sh` |
| `keyboard/runtime.mjs` | the map from sources to the runtime layout (`patch.js`, `modes.js`, `swipe/*.js`) |
| `src/` | Decky frontend: loads the runtime files, saves learned words, Quick Access panel |
| `main.py` | Decky backend: reads and writes the files under `~/homebrew/settings` and `~/homebrew/data` |
| `test/` | backend test, plugin glue against the simulator with the real `main.py`, packaging test |
| `scripts/` | build, provenance record, packaging, notices, privacy scan, steamui fetch |
| `docs/` | how the keyboard works (`KEYBOARD.md`), Decky integration, bake-off results, research notes |
| `licenses/` | MIT text, Decky template license and SCOWL notices used to generate `LICENSE` |

The runtime files work without Decky too: anything that evaluates `swipe/words.js`, `swipe/lm.js`,
`swipe/engine.js`, `modes.js` and then `patch.js` in Steam's `SharedJSContext` gets the keyboard
(`node keyboard/runtime.mjs <dir>` assembles them with `inject.mjs`). `window.__oskTrackpadFix` is the API, described
in [docs/KEYBOARD.md](docs/KEYBOARD.md).

## Setup

Node 20+ (CI uses 24), pnpm 9 (`corepack enable`, or `npx pnpm@9` in place of `pnpm`), Python 3.10+ and
[Ruff](https://docs.astral.sh/ruff/) (`pip install ruff`):

```sh
pnpm i
pnpm run lint            # ESLint, tsc --noEmit, ruff check
pnpm run format          # Prettier and ruff format; format:check only checks
pnpm test                # build, engine gates, backend test, provenance, packaging test, privacy scan
pnpm run test:sim        # simulator suites + plugin test; records test-record.json (needs Steam's UI files)
pnpm run package         # -> out/VaporType.zip, only from files test:sim recorded
```

Formatting: Prettier with `printWidth` 140 (the code was written with long lines; 140 keeps the one-time reformat
small and still fits a side-by-side diff), Ruff with the same line length. Markdown is not run through Prettier: the
docs are wrapped by hand at about 120 columns and their wide tables would be padded out. `keyboard/data/words.js`,
`lm.js`, the corpora and the inputs are data and are left as built.

## Release

`test:sim` runs `keyboard/sim/test-all.sh` (every simulator suite and the engine gates), `test/backend-test.py` and
`test/plugin-sim.mjs`, then writes the hashes of every shipped file and its sources to `test-record.json`. Commit that
file with the change. `package.sh` zips an explicit allowlist (`PACKAGE` in `scripts/provenance.mjs`) and refuses
unless every listed file, its sources and nothing else in `dist/` match `test-record.json`; the record ships in the zip.

Pushing a tag `v<version>` (matching `package.json`) runs `.github/workflows/release.yml`: `pnpm test`, the
provenance check against the committed record, `package.sh`, then a GitHub release with `VaporType.zip` and its
`.sha256`, and the same two files on GitHub Pages. Decky's "Install Plugin from URL" and `install.sh` use the Pages copy,
`https://dmitrii-galantsev.github.io/VaporType/VaporType.zip`: Decky cannot download `github.com/.../releases` URLs,
because their redirect carries a response header longer than aiohttp's 8190-byte limit.

Data notices in `LICENSE` and the README come from `keyboard/data/DATA-LICENSES.md` (its summary table and
"Attribution text for a release"), plus the SCOWL notice from `licenses/`: run `pnpm run notices` after changing it.

## Simulator

The simulator loads Steam's own keyboard code, which is not redistributable, so copy it from your Deck first.
Enable SSH on the Deck (set a password with `passwd`, then `sudo systemctl start sshd`) and run:

```sh
sh scripts/fetch-steamui.sh deck@<your-deck-address>     # -> .steamui/ (gitignored)
pnpm run test:sim                         # everything, in parallel
node keyboard/sim/test.mjs                # output path: rolled typing, Esc/Ctrl/Alt, chords, stop and re-inject
node keyboard/sim/swipe-test.mjs          # swipe typing end to end
node test/plugin-sim.mjs                  # the plugin end to end: load, save, disable, restart, forget, unload, call counts
node keyboard/sim/media.mjs               # re-record the README GIFs and pictures into docs/media (needs ffmpeg);
                                          # one of them: node keyboard/sim/media.mjs docs/media swipe
```

`fetch-steamui.sh` takes any ssh destination and, optionally, the remote steamui folder (default
`.local/share/Steam/steamui/`) and a local folder. Set `STEAMUI=<dir>` to use another copy and `CHROME=<path>` if
Chromium is not at `/usr/bin/chromium`. After a Steam update, fetch again and rerun the tests before reporting
that something broke.

## Pull requests

Run `pnpm run lint`, `pnpm run format:check`, `pnpm test` and, for keyboard changes, `pnpm run test:sim`. Keep typing
logs, `real-swipes.json` and anything from your own Deck's data out of commits; `scripts/check-private.sh` (part of
`pnpm test`) looks for personal paths and host names.
