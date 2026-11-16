# Bake-off: delivering OSK text to a Moonlight-like SDL2 X11 client under gamescope

Date 2026-10-23, on a desktop Linux PC (KDE neon, not the Deck). Everything in the tables was measured on this host.
Statements marked *inferred* were not measured. The gaps the patch ships were measured later on a Deck: see
[BAKEOFFS.md](BAKEOFFS.md#on-a-real-deck-v22).

## Setup

- gamescope 3.16.31 (`--backend headless -W 1280 -H 800`) with its Xwayland 24.1.13; gamescope exports
  `LIBEI_SOCKET=gamescope-0-ei` for input emulation.
- App: `keylog.c`, an SDL2 window linked against the real SDL 2.30.0 (`SDL_VIDEODRIVER=x11`, text input on), logging
  every KEYDOWN/KEYUP (scancode, sym, mod, repeat) and TEXTINPUT.
- Reconstructed "Windows text" mirrors moonlight-qt `keyboard.cpp`: repeat==1 keydowns are dropped; each remaining
  keydown becomes its SDL scancode on a US layout; shift comes from LShift/RShift key events (reconstructing from
  `mod & KMOD_SHIFT` gave identical results); scancode 42 deletes.
- Injector: `inject.c` with three transports:
  - `ime`: gamescope_input_method v3 (`set_string` + `commit(serial)`), the path `ControllerKeyboardSendText` takes.
    Backspace is `set_action(delete_left)` + `commit`, which is what Steam's `"\x02"` maps to.
  - `xk`: XTest `XTestFakeKeyEvent` on the X server, the likeliest `ControllerKeyboardSetKeyState` transport given
    gamescope's comment "Steam's virtual keyboard is based on XTest" (*inferred*).
  - `ei`: a direct libei sender on `LIBEI_SOCKET`.
- Each trial: marker, 30 ms, the strategy's command stream, 400 ms settle, marker. 5 reps per test per strategy, all
  trials shuffled (seed 20261023) in one gamescope session after a warmup.
- Test set: T1 `hello world`; T2 `Hello, I'm done!`; T3 `Okay?? Sure: 100% (yes)`; T4 `aaa bookkeeper committee`; T5
  `Test Backspace` with 3 backspaces and `ace`; T6 a 60-character pangram sentence; T7 `iPhone USA`; T8 (third batch
  only) `aAAa eEe 1!1 ;:; xXx Ss` (same physical key, case flips).
- `gN` = gap between chars (ms), `sN` = gap when the next char is the same key, `hN` = key hold.

## Results (T1-T7, 35 trials per strategy)

| strategy | exact | what was lost |
|---|---|---|
| whole string or whole word per SendText, any gap | 0/35 | nearly everything: letters arrive as digits |
| one char per SendText, g0 (any s) | 3-7/35 | letters, spaces, doubles everywhere |
| one char per SendText, g5-g20, s0 or s30 | 10/35 | every doubled letter |
| one char per SendText, every cell with g ≥ 1 and s ≥ 32 (g1-g40, s32-s60) | 35/35 each | nothing |
| XTest or libei key events with explicit LShift, g ≥ 1 | 35/35 each | nothing (1-5 ms per char) |
| XTest or libei, g0 | 3-4/35 | letters, spaces, doubles |
| key-event letters with SendText punctuation, g12-g20 | 10/35 | letters come out shifted |
| the same at g35-g40 | 35/35 | nothing |
| SendText chars with XTest Backspace, or XTest chars with SendText Backspace | 35/35 each | nothing |

Third batch, T1-T8, 40 trials each: one char per SendText with the same-key gap keyed by character 35/40 (T8 lost:
`aA e 1 ; x S`), keyed by physical key 40/40; XTest and libei at g5 40/40.

## What the numbers say

1. **Whole strings through SendText are unusable.** Multi-char commits take gamescope's scratch keymap over KEY_1,
   KEY_2, ...; Moonlight forwards scancodes, so Windows gets `1234...`. Single chars sent within 100 ms of such a
   commit also become digits.
2. **Per-char SendText is reliable once two timing rules hold:**
   - the gap between chars must be at least ~1 ms. At g0 several commits are handled in one dispatch and chars vanish
     everywhere. One g0 log showed a lost KEYUP, after which every later press of that key arrived as repeat=1 and was
     dropped for the rest of the session.
   - a repeat of the **same physical key** must wait more than gamescope's 30 ms release timer. Below that the key is
     still held, so gamescope releases and re-presses it back to back, SDL2 X11 marks the press as autorepeat, and
     Moonlight drops it (`aaa bookkeeper committee` → `a bokeper comite`).
3. **The same-key rule must be keyed by physical key, not by character:** `a`/`A`, `1`/`!`, `;`/`:` and `s`/`S` are
   one keycode to gamescope. `patch.js` runs every key through `physKey()` and measures the last send of that key
   from `OUT.at`.
4. **Capitals and shifted symbols via SendText are fine** under those rules: gamescope wraps them in a real LShift
   press and release that SDL sees.
5. **SetKeyState-style injection (XTest or libei) with explicit LShift is reliable at any gap ≥ 1 ms**, doubles and
   case flips included.
6. **Mixing transports:** after a SendText of a shifted char, gamescope keeps LShift down for 30 ms or until the next
   SendText, so a key event sent inside that window comes out shifted. Backspace interleaving is safe both ways.
7. **The first keydown after a new input client** is sometimes lost (its KEYUP still arrives). Later keys in the same
   client were never lost. Cause not determined; the batches warm up first, so the tables are not affected.
8. With two Xwaylands, XTest from the other display reached the SDL app through Xwayland's libei → gamescope, so a
   Steam XTest call on Steam's own Xwayland can reach Moonlight on the game's Xwayland (measured).

## What `patch.js` does with this

- Text goes out as one character per `ControllerKeyboardSendText`, never as a string; capitals and shifted symbols
  need no separate path.
- The repeat gap is keyed by the physical key (`physKey()` into `OUT.at`).
- Backspace goes through `HandleVirtualKeyDown("Backspace")` → `"\x02"` → delete_left, which stays in order with
  chars; consecutive Backspaces are the same key.
- Chords (`ControllerKeyboardSetKeyState`) go through the same queue with 40 ms on either side, so they cannot inherit
  LShift from a SendText capital. SetKeyState is the fastest reliable path in this harness, but its transport on the
  Deck is unverified and it lost Shift there, so it is not used for text.

## Measured vs inferred

- Inferred: that Steam's `ControllerKeyboardSendText` issues one `set_string` + `commit` per call with no batching,
  and that `ControllerKeyboardSetKeyState` uses XTest. If Steam coalesced calls made in one tick into one commit, that
  would be the g0 row, which is one more reason to keep real gaps in JavaScript.
- The Deck runs its own gamescope, Xwayland and SteamOS builds with a real DRM backend, and Steam's Xwayland separately
  from the game's. The Moonlight flatpak bundles its own SDL2 (the autorepeat heuristic exists across SDL2 2.x X11,
  *inferred*).
- JavaScript timers on the Deck jitter, so the queue measures elapsed time before each send.

The harness (an SDL2 X11 key logger and an input-method / XTest / libei injector built against gamescope's
`gamescope-input-method.xml`) was a one-off and is not kept in the repository.
