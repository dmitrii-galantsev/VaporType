# Bake-off: delivering OSK text to a Moonlight-like SDL2 X11 client under gamescope

Date 2026-10-23, on a desktop Linux PC (KDE neon, not the Deck). Everything in the tables below was measured on this host.
Statements marked *inferred* were not measured.

## Setup

- gamescope 3.16.31 (nix, `--backend headless -W 1280 -H 800`); Xwayland 24.1.13 from the gamescope closure; gamescope logs
  `Successfully initialized libei for input emulation!` and exports `LIBEI_SOCKET=gamescope-0-ei`,
  `GAMESCOPE_WAYLAND_DISPLAY=gamescope-0`, `DISPLAY=:3`.
- App: `keylog.c`, a 1280x800 SDL2 window linked against the system real SDL 2.30.0 (`libSDL2-2.0.so.0`, not sdl2-compat),
  `SDL_VIDEODRIVER=x11`, text input on. Logs every KEYDOWN/KEYUP (scancode, sym, mod, repeat) and TEXTINPUT.
- Reconstructed "Windows text" mirrors moonlight-qt `keyboard.cpp`: repeat==1 keydowns are dropped; each remaining keydown
  becomes its SDL scancode on a US layout; shift is taken from LShift/RShift key events that reached SDL
  (a second reconstruction using the `mod & KMOD_SHIFT` flag gave identical results in every trial); scancode 42 deletes.
- Injector: `inject.c`, one process, three transports:
  - `ime`: gamescope_input_method v3 (`set_string` + `commit(serial)`), the path `ControllerKeyboardSendText` takes.
    Backspace is `set_action(delete_left)` + `commit`, which is what Steam's `"\x02"` maps to.
  - `xk`: XTest `XTestFakeKeyEvent(evdev+8)` on the X server. Gamescope's own comment in `ime.cpp`
    ("Steam's virtual keyboard is based on XTest") makes this the likeliest `ControllerKeyboardSetKeyState` transport (*inferred*).
  - `ei`: a direct libei sender on `LIBEI_SOCKET` (gamescope `InputEmulation.cpp` → `wlserver_key`).
  uinput was not used: the headless backend has no libinput, so a uinput device would never reach gamescope.
- Each trial: marker, 30 ms, the strategy's command stream, 400 ms settle (> 100 ms keymap reset + 30 ms key release),
  marker. 5 reps per test per strategy, all trials of a batch shuffled (seed 20261023) in one gamescope session after a warmup.
- Test set: T1 `hello world`; T2 `Hello, I'm done!`; T3 `Okay?? Sure: 100% (yes)`; T4 `aaa bookkeeper committee`;
  T5 type `Test Backspace`, 3 backspaces, `ace` (expect `Test Backspace`); T6 `The quick brown fox jumps over the lazy dog by
  the riverbank` (60 chars); T7 `iPhone USA`; T8 (third batch only) `aAAa eEe 1!1 ;:; xXx Ss` (same physical key, case flips).
- Strategy names: `gN` = gap between chars (ms), `sN` = gap when the next char equals the previous one, `hN` = key hold.
  `ms/char` = span from first to last key event / keystrokes. CER = edit distance / expected length.

## Results (T1-T7, 35 trials each unless marked)

| strategy | exact | CER | ms/char | lost chars by class |
|---|---|---|---|---|
| a/ime-char g0 s0 | 4/35 | 0.241 | 1.3 | lower 106, space 36, double 32, shifted-sym 6, digit 5, inserted 4, sym 1 |
| a/ime-char g0 s30 | 3/35 | 0.267 | 3.8 | lower 127, space 37, double 34, inserted 8, shifted-sym 4, digit 1 |
| a/ime-char g0 s45 | 5/35 | 0.139 | 5.1 | lower 88, space 22 |
| a/ime-char g0 s60 | 7/35 | 0.120 | 6.4 | lower 65, space 30 |
| a/ime-char g12 s0 | 10/35 | 0.087 | 12.8 | double 35, lower 20, inserted 10, shifted-sym 4 |
| a/ime-char g12 s30 | 10/35 | 0.081 | 14.3 | double 35, lower 20, inserted 8, shifted-sym 1 |
| a/ime-char g12 s45 | 35/35 | 0.000 | 15.6 |  |
| a/ime-char g12 s60 | 35/35 | 0.000 | 16.9 |  |
| a/ime-char g20 s0 | 10/35 | 0.086 | 20.4 | double 33, lower 21, inserted 10, shifted-sym 4 |
| a/ime-char g20 s30 | 10/35 | 0.084 | 21.3 | double 35, lower 20, inserted 9, shifted-sym 2 |
| a/ime-char g20 s45 | 35/35 | 0.000 | 22.6 |  |
| a/ime-char g20 s60 | 35/35 | 0.000 | 23.9 |  |
| a/ime-char g40 s0 | 35/35 | 0.000 | 39.6 |  |
| a/ime-char g40 s45 | 35/35 | 0.000 | 40.0 |  |
| a/ime-char g40 s60 | 35/35 | 0.000 | 41.3 |  |
| a/ime-char g5 s0 | 10/35 | 0.081 | 6.1 | double 33, lower 19, inserted 10, shifted-sym 2 |
| a/ime-char g5 s30 | 10/35 | 0.087 | 8.2 | double 35, lower 20, inserted 10, shifted-sym 4 |
| a/ime-char g5 s45 | 35/35 | 0.000 | 9.5 |  |
| a/ime-char g5 s60 | 35/35 | 0.000 | 10.8 |  |
| b/ime-whole | 0/35 | 1.310 | 4.7 | lower 460, space 105, inserted 95, double 60, upper 55, shifted-sym 30, sym 10, digit 10 |
| b/ime-word g12 | 0/35 | 1.373 | 2.9 | lower 450, space 105, inserted 95, double 60, upper 55, shifted-sym 30, digit 10, sym 10 |
| b/ime-word g150 | 0/35 | 1.063 | 23.9 | lower 520, space 105, double 60, upper 55, shifted-sym 30, sym 10, digit 5 |
| c/ei g0 h0 | 4/35 | 0.275 | 0.0 | lower 130, space 36, double 32, digit 7, shifted-sym 5, sym 5, inserted 2 |
| c/ei g12 h0 | 35/35 | 0.000 | 11.5 |  |
| c/ei g12 h5 | 35/35 | 0.000 | 16.5 |  |
| c/ei g5 h0 | 35/35 | 0.000 | 4.8 |  |
| c/xk g0 h0 | 3/35 | 0.315 | 0.0 | lower 151, space 43, double 36, shifted-sym 7, digit 5, sym 4, inserted 3 |
| c/xk g12 h0 | 35/35 | 0.000 | 11.5 |  |
| c/xk g12 h5 | 35/35 | 0.000 | 16.5 |  |
| c/xk g5 h0 | 35/35 | 0.000 | 4.8 |  |
| d/ime_chars_xk_bs g12 s45 | 35/35 | 0.000 | 15.6 |  |
| d/ime_chars_xk_bs g20 s45 | 35/35 | 0.000 | 22.6 |  |
| d/keys_letters_ime_punct g12 s45 | 10/35 | 0.108 | 14.9 | lower 80, digit 5 |
| d/keys_letters_ime_punct g20 s45 | 10/35 | 0.051 | 21.9 | lower 40 |
| d/xk_chars_ime_bs g12 s45 | 35/35 | 0.000 | 14.3 |  |
| d/xk_chars_ime_bs g20 s45 | 35/35 | 0.000 | 21.3 |  |
| e/ei g1 h0 | 35/35 | 0.000 | 1.0 |  |
| e/ei g2 h0 | 35/35 | 0.000 | 1.9 |  |
| e/ei g3 h0 | 35/35 | 0.000 | 2.9 |  |
| e/ime-char g1 s45 | 35/35 | 0.000 | 6.0 |  |
| e/ime-char g12 s32 | 35/35 | 0.000 | 14.5 |  |
| e/ime-char g12 s35 | 35/35 | 0.000 | 14.8 |  |
| e/ime-char g12 s40 | 35/35 | 0.000 | 15.2 |  |
| e/ime-char g2 s45 | 35/35 | 0.000 | 6.9 |  |
| e/ime-char g3 s45 | 35/35 | 0.000 | 7.8 |  |
| e/ime-char g5 s32 | 35/35 | 0.000 | 8.4 |  |
| e/ime-char g5 s35 | 35/35 | 0.000 | 8.6 |  |
| e/ime-char g5 s40 | 35/35 | 0.000 | 9.1 |  |
| e/keys_letters_ime_punct g35 s45 | 35/35 | 0.000 | 34.9 |  |
| e/keys_letters_ime_punct g40 s45 | 35/35 | 0.000 | 39.3 |  |
| e/xk g1 h0 | 35/35 | 0.000 | 1.0 |  |
| e/xk g2 h0 | 35/35 | 0.000 | 1.9 |  |
| e/xk g3 h0 | 35/35 | 0.000 | 2.9 |  |

Third batch, T1-T8, 40 trials each:

| strategy | exact | CER | ms/char | lost chars by class |
|---|---|---|---|---|
| k/ei g5 h0 (T1-T8) | 40/40 | 0.000 | 4.8 |  |
| k/ime-char-bychar g12 s45 (T1-T8) | 35/40 | 0.045 | 15.4 | lower 16, shifted-sym 8, upper 7, digit 4, sym 3, double 3 |
| k/ime-char-bychar g5 s45 (T1-T8) | 35/40 | 0.060 | 9.3 | lower 20, shifted-sym 10, upper 9, double 5, digit 5, sym 5 |
| k/ime-char-bykey g12 s45 (T1-T8) | 40/40 | 0.000 | 17.4 |  |
| k/ime-char-bykey g5 s45 (T1-T8) | 40/40 | 0.000 | 11.7 |  |
| k/xk g5 h0 (T1-T8) | 40/40 | 0.000 | 4.8 |  |

## What the numbers say

1. **Whole strings through SendText are unusable** (b/*: 0/105). Multi-char commits take gamescope's scratch keymap over
   KEY_1, KEY_2, ...; Moonlight forwards scancodes, so Windows gets `1234...`. A 150 ms gap between words does not help.
   Single chars sent within 100 ms of such a commit also become digits (`1234123456...`).
2. **Per-char SendText is 100% reliable once two timing rules hold** (every `g>=1, s>=32` cell is 35/35, 245 trials):
   - the gap between chars must be at least ~1 ms. With g0, so several commits handled in one dispatch, chars vanish everywhere,
     not only doubles. One g0 log showed a lost KEYUP, after which every later press of that key arrived as repeat=1 and was
     dropped: one lost release corrupts the rest of the session for that key.
   - a repeat of the **same physical key** must wait more than gamescope's 30 ms release timer. s0 and s30 lose every double
     letter (`aaa bookkeeper committee` → `a bokeper comite`). s32, s35, s40, s45 and s60 all pass. Below 30 ms the key is still held,
     so gamescope releases and re-presses it back-to-back, SDL2 X11 marks the press as autorepeat, and Moonlight drops it.
3. **The same-key rule must be keyed by physical key, not by character.** T8, gap keyed by char: 0/10 exact,
   e.g. `aAAa eEe 1!1 ;:; xXx Ss` → `aA e 1 ; x S`. The same strings with the 45 ms gap keyed by HID code: 10/10.
   `patch.js` keys it by physical key: `emit` runs every key through `physKey()` and `waitFor` measures the last send of
   that key from `OUT.at`, so these pairs take the same-key gap.
   `a`/`A`, `1`/`!`, `;`/`:` and `s`/`S` are one keycode to gamescope.
4. **Capitals and shifted symbols via SendText are fine** under those rules (T2, T3, T7, T8 bykey all pass, strict
   key-event shift reconstruction). gamescope wraps them in a real LShift press/release that SDL sees. Consecutive capitals produce
   a repeat=1 LShift keydown whose release was also dropped, so shift simply stays down. Harmless.
5. **SetKeyState-style injection (XTest or direct EI) with explicit LShift is reliable at any gap >= 1 ms**, doubles and
   case flips included, at 1-5 ms/char (c/*, e/xk, e/ei, k/xk, k/ei). Only g0 fails. Holding the key 5 ms changes nothing.
6. **Mixing transports:** after a SendText of a shifted char, gamescope keeps LShift (and the key) down for 30 ms or until
   the next SendText. A SetKeyState key sent inside that window comes out shifted (`OKAy?? SURe: !00% (YEs)` at g12/g20; 35/35 at g35/g40).
   Backspace interleaving is safe both ways: SendText chars + XTest Backspace, and XTest chars + SendText delete_left, 70/70 each.
7. **First keydown after a new input client** is sometimes lost; its KEYUP still arrives. Seen on the first IME commit of a fresh
   IME object (2/2), the first direct-EI key after connecting (1/1), and with `--xwayland-count 2` on the first XTest event sent from
   the *other* Xwayland (5 of 14 probes: lost after 10-20 s of no input, never on clients started 1-3 s after the previous one; once in a client that then sent 5 more keys fine). Later keys in the same client,
   even after 15-20 s idle, were never lost. Cause not determined. The shuffled batches warm up first, so the tables are not affected.
8. Cross-display: with two Xwaylands, XTest from the non-app display (:4) reached the SDL app on :3 through Xwayland's
   libei → gamescope EIS, so a Steam XTest call on Steam's own Xwayland can reach Moonlight on the game Xwayland (measured).

## Recommendation for patch.js

Winner: **per-char `ControllerKeyboardSendText`, which is what `patch.js` ships**, and the one fix this table asked for is in:
the repeat gap is keyed by the physical key (`physKey()` into `OUT.at`), so `aA`, `Ss`, `1!`, `;:`, `,<` get that gap.

The shipped gaps are the ones measured on the Deck, not the 12/45 ms of this harness: **30 ms between keys, 100 ms since the
same physical key, 100 ms after a named key, 60 ms around Shift changes** — see the "On a real Deck (v22)" table in
[BAKEOFFS.md](BAKEOFFS.md), where 12 ms between keys with the other gaps in place lost three characters and 25 ms and 35 ms none.

- Never send multi-char strings (whole words, autocorrect replacements) through SendText. Keep emitting them char by char.
- Capitals and shifted symbols need no separate path through SendText.
- Backspace through `HandleVirtualKeyDown("Backspace")` → `"\x02"` → delete_left is safe and stays in order with chars.
  Consecutive backspaces are the same key, so the same-key gap applies (the patch keys them as `"Backspace"`).
- `sendChord`/`tapKey` (SetKeyState) right after a SendText capital or shifted symbol can inherit LShift. Route chords through the
  `emit` queue or wait >=35 ms after the last SendText. SetKeyState itself is the fastest reliable path in this harness
  (needs >=1 ms between keystrokes and explicit LShift), but its transport on the Deck is unverified, so it is not the recommended default.

## Measured vs inferred / Deck differences

- Measured here: everything in the tables and points 1-8, against gamescope 3.16.31, Xwayland 24.1.13, SDL 2.30.0.
- Inferred: that Steam's `ControllerKeyboardSendText` issues exactly one `set_string`+`commit` per call with no batching or delay,
  and that `ControllerKeyboardSetKeyState` uses XTest. Steam's client is closed. If Steam coalesces calls made in one tick into
  one commit, that is the g0 row (bad), which is one more reason to keep real gaps in JS.
- The Deck runs its own gamescope/Xwayland/SteamOS builds, a real DRM backend and Steam's Xwayland separately from the game's.
  The Moonlight flatpak bundles its own SDL2 (the 2 ms autorepeat heuristic exists across SDL2 2.x X11, *inferred*).
  Sunshine/GFE on Windows may treat the modifier flags differently, but both reconstructions agreed everywhere.
- JS timers on the Deck jitter. The margins (12 ms vs 1 ms minimum, 45 ms vs 32 ms minimum) cover a few ms of jitter, not
  a stalled frame that fires two queued sends in one tick. `emit` should measure elapsed time before each send, as it does now.

## Files

The harness (an SDL2 X11 key logger and an input-method / XTest / libei injector built against gamescope's
`gamescope-input-method.xml`) was a one-off and is not kept in the repository.
