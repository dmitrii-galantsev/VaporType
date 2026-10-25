# How the keyboard works

What `keyboard/src/` does inside Steam, the injector API and the simulator. User-facing docs are in the
[README](../README.md); measurements and the decisions taken from them in [BAKEOFFS.md](BAKEOFFS.md).

The keyboard calls itself **VaporType** to users (panel title, version line, first-use card); code and files keep the
`osk` names. `patch.js` (v30) runs in Steam's `SharedJSContext` and changes Steam's own keyboard (gamepad UI module with
`TypeKeyInternal`, live in `steamui/sp.js`; `steamui/virtualkeyboard.js` is a stale standalone copy):

- **Swipe typing.** Hold a trackpad click on a letter and drag across the word, like Gboard or Swype; release to
  type it. Each pad covers 55 % of the keyboard (Steam maps the left pad onto the left 55 %, the right pad
  onto the right 55 %), so a word that spans both halves is swiped with both thumbs: every press while a word
  is in progress, or within 220 ms of its last release, continues the same word, and a press without movement
  adds that letter. Example "hello": right pad on h, left pad clicks e, right pad drags l to o. Two quick words
  on alternating pads stay two words: the decoder also scores the split at every release gap and at every press
  that lands while the other pad is still held, and keeps the more likely reading, so two swipes pressed at the
  same time type both words in press order. A swipe is typed as soon as the last pad is released. A press within
  220 ms of that release still joins: the word is decoded again with the new stroke, and if the joined reading wins the
  typed word is replaced with Backspaces; if the first word stays, nothing is retyped (that split gets a 4-point
  bonus, `REWRITE_COST`, since the word is already on screen). The decodes after a release (whole gesture, then each split's
  halves) run in slices of at most 8 ms (`SLICE_MS`), and any key, press, pick, bumper or close in between finishes them first; the live preview in the suggestion row pauses while both pads are
  held. Tapped letters are typed on release even while the other pad is still held, in press order. The touchscreen swipes the same way. A blue (left pad) / orange
  (right pad) trail shows the path.
- **Steam's per-open input leak.** Every time Steam's keyboard opens it builds a new component, and its
  constructor makes a new gamepad input source (`m_trackpadInput`, module 17900) that registers
  `HandleControllerInputMessages` with `SteamClient.Input.RegisterForControllerInputMessages` and
  `RegisterForControllerAnalogInputMessages`, `HandleSystemKeyEvents` with `SteamClient.System.UI.RegisterForSystemKeyEvents`,
  and two controller-list notifications, and never unregisters any of them. Each open therefore adds one more handler
  that runs on every pad sample until Steam restarts, which is why typing with both pads gets slower the longer Steam
  runs (reported for Steam Deck and Steam Machine: "Virtual keyboard performance degrades dramatically at some point",
  Steam Controller bug forum, 2026-10-22). The patch wraps those three `Register…` calls to keep each returned handle,
  and after the keyboard's `componentWillUnmount` unregisters the handles of that keyboard's input source and turns
  its `OnAnalogPad`, `OnButtonDown`, `OnButtonUp` and `OnSystemButtonPress` into no-ops (a keyboard mounted again
  gets them back). Handlers registered before the patch loaded cannot be reached: a Steam restart clears them. The
  two controller-list notifications go through Steam's service transport and are left alone; they run only when a
  controller connects or disconnects.
- **Zoomed windows.** Desktop Mode zooms the keyboard window's root 1.5x; `zoomOf()` measures whether rects
  include that zoom, so touches, the trail, the mode overlay, the tip and the panel line up with the screen.
- **Pad reach** (setting "Pad reach", Input tab: Own half 55 default, Past middle 75, Whole 100, Right pad only).
  `padSpan(side)` is the share of the keyboard's width a pad covers: reach / 100 for both pads, or with Right pad only
  1 for the right pad and 0.55 for the left. The patch sets Steam's pointer containers to that width
  (`TouchpadPointerContainer.LeftTrackpad` / `RightTrackpad`), so Steam's x mapping follows, and the typing modes' pad
  maps (`modeApi.spans()`), the decoder's per-pad reach (`ctx.pads`), the movement gate that turns a press into a
  swipe and the cursor-slide distances follow it. At 75 or 100 the pads overlap, so either thumb alone can swipe
  "testing"; a word still continues across both pads when both are used. Right pad only works like a phone: one
  thumb on the right pad reaches every key, and the left pad keeps its own half.
- **Full-width pad up/down** (setting, Input tab, shown only while a pad covers the whole keyboard). Steam alone
  would stretch the 32.5 mm pad over the keyboard's full height too, so a thumb movement would go about 3x farther
  sideways than up or down. On a pad at 100 % `modes.js` remaps y (`isoY`): the pad's y gain is its x gain over the
  letters divided by the setting (Balanced 2:1 default; Even 1:1 is the same movement both ways; Stretched 3:1 is
  Steam's own), centred on the middle letter row and clamped at the keyboard's top and bottom, so the outer part of
  the pad lands on the top or bottom row. The overlay draws the pointer at the remapped place and Steam's own pointer
  is hidden. 2:1 rather than 1:1: at 1:1 a key row is 1.8 mm of pad and one-thumb swipes drop to 34 % top-1
  ([BAKEOFFS.md](BAKEOFFS.md#one-thumb-vertical-mapping-v16)). Two pads stay more accurate than one (91.6 % against
  57-69 % one-thumb, held-out seed), which is why Own half is the default.
- **Look and see-through** (Look tab). "Look" picks the colours (Modern rounded keys with gaps, the default; Steam's
  original; OLED black). Four sliders and the Glass choice (`SLIDERS` in `patch.js`; rows `s_` and `c_blur`, see
  Settings panel) set how much of the game shows through, each independently and in every look:

  | setting | slider | default | what |
  |---|---|---|---|
  | `boardAlpha` | Keyboard background | 40 | the board between the keys |
  | `keyAlpha` | Keys | 100 | letter keys; other keys get `keyAlpha - (100 - boardAlpha) / 10` |
  | `spaceAlpha` | Space bar | 30 | the space bar, also while it shows the typed text or "◂ cursor ▸" |
  | `stripAlpha` | Top strip | 90 | the typed-text field and suggestion row |
  | `blur` | Glass (segmented) | Off | Off / Light / Strong: a 6 / 16 px backdrop blur on the board only |

  The four alphas are 0-100 in steps of 5 (0 clear, 100 solid). They go to the page as CSS variables (`--osk-ba`,
  `--osk-ka`, `--osk-ma`, `--osk-sa`, `--osk-ra`) in a small stylesheet of their own (`osk-look-vars`, `lookVars()`);
  the look stylesheet (`osk-look-style`) only references them, so a change rewrites that one small sheet once and
  nothing else (while the settings panel is open, only when it closes; the panel's preview shows it meanwhile). Labels stay opaque; the space-bar label, the typed text shown in the space bar and "◂ cursor ▸" carry a
  dark text shadow and use the look's main text colour, and `look-test.mjs` asserts at least 4.5:1 for each at the
  defaults over black and mid-grey (6.8:1 or more). Steam's dark `BackgroundGlass` under the keyboard is cleared so the
  game shows through. Blur costs 4.5-5.3 ms per frame on the compositor thread in the simulator (software
  compositing, animated backdrop), so it is off by default; whether gamescope lets the overlay's
  backdrop filter see the game at all is unverified on the Deck. "Reset look" restores the look and all five to their
  defaults. Older saved settings carry `opacity` (100/90/80, 70 read as 80) instead: it becomes
  `boardAlpha = opacity - 50` (OLED + 30; 100 stays 100), `keyAlpha` the old letter-key alpha rounded to 5 (100), and
  `stripAlpha = max(90, opacity)`, so 80 % loads as 30 / 100 / 90 and the space bar takes the default 30. Only the
  default keyboard theme is restyled; a points-shop theme is left alone. One blue, `#0a74d6` (white text 4.69:1),
  fills the chip that space or punctuation will apply (autocorrect target) or the word just swiped, ON switches,
  locked Shift/Caps/Ctrl/Alt and pressed keys; next-word predictions are never filled. Keys, chips and the typed-text
  field carry no outline, ring or edge; modifier keys are only slightly darker than letters. Letter labels are 20 px,
  modifier labels 14 px,
  Backspace/Enter/Shift show ⌫ ⏎ ⇧ next to Steam's controller glyphs (X, R2, L2; the glyphs are Steam's
  `/steaminputglyphs/*.svg`), Ctrl/Alt carry LB/RB badges while the bumpers hold them, shifted legends are lighter,
  and a hovered key in the Steam look is grey-blue instead of white. Arrow keys show Steam's own two glyphs (the
  small ▲/▼ is what Shift turns them into). Pressed keys flash blue, the swipe trail fades from tail to head and out on
  release. Unverified on the deck: whether gamescope shows the game through the overlay's CSS alpha (Steam's own
  "Evolve" keyboard theme uses a translucent background, which suggests it does).
- **Typed text.** The suggestion row starts with a field showing the end of what this keyboard sent (the last 60
  characters, about 30 visible), with a caret, for when the keyboard covers the text box (Moonlight). It follows what goes out: taps, swiped words,
  suggestion picks, autocorrect, Backspace. Enter, closing or reopening the keyboard start an empty line; arrows,
  Tab, Esc, Ctrl/Alt chords, Paste, a touch outside the keyboard and 30 s without typing start it with "…", since
  the field's content is then unknown. Longer text scrolls left behind a fade. The field is a light pill like the
  chips; a word autocorrect just changed is highlighted in it for 1.5 s, and a small badge just right of it (outside
  the text) shows the typing mode when it is not the default Big letter keys and "1-thumb" when Pad reach is Right
  pad only. The suggestion row is backed at the "Top strip" alpha (90 % by default) whatever the board alpha, so chat text
  barely shows through the field or the chips. The chips take the remaining 66 % of
  the row; key positions, the keyboard height and Steam's pad mapping do not change. With the suggestion row off
  it moves into the space bar. Hidden while the settings panel is open and in IME layouts; setting "Show typed
  text" (on by default). It cannot tell a password field, so it shows passwords as typed.
- **Cursor slide** (setting "Slide space bar to move cursor", on by default), as on Gboard: press and hold the
  space bar (pad click or touch) and slide sideways; each 0.5 key width sends one ArrowLeft/ArrowRight (0.25 when
  moving faster than 1.5 key widths per 100 ms; on a pad covering more than its half the distances are in pad millimetres, so wider on
  screen: 1.36x at 75 %, 1.82x at 100 %). While sliding the space bar reads "◂  cursor" moving left and "cursor  ▸" moving right. Released without sliding past 0.55 key widths it is a normal space, typed on release (a press
  on any other key while it is held types the space first, so rolled typing keeps its order). Arrows go out on
  Steam's text path through the output queue (one per call, 45 ms between arrows); at most 3 wait in the queue, so
  the cursor never trails the thumb by more than about 135 ms: further steps are dropped and a step back cancels a
  waiting one. The slide finishes the current word, resets the word tracker and marks the typed-text field as
  unknown. Off while Ctrl/Alt/AltGr is active. The right pad cannot slide left of its own edge (in two-pad mode
  that is near the middle of the space bar), so press farther right or use the left pad. Slide-to-delete from
  Backspace is not implemented.
- **Auto space** (setting "Remove auto space before punctuation", on by default). The tracker flag `T.auto` is set
  when VaporType itself types a trailing space the user did not press: picking a completion, a prediction or "+ add"
  in the suggestion row. The space the user presses (including the one that commits an autocorrection) and the leading
  space before a
  swiped word are not pending. The flag survives only while the next key is directly after the space: any other key
  (letter, space, Backspace, arrows, chords), a cursor slide, focus loss, closing the keyboard and the 30 s
  stale reset clear it; Shift, Caps Lock and the layout keys do not. Typing one of `. , ! ? : ; ) ] }` (with Shift
  where the key needs it: `!`, `?`, `:`, `)`, `}`) or pressing Enter then sends one Backspace through the same output
  queue (so the usual gaps apply: 100 ms between a Backspace and a different key) before the key. Quotes and `(` are
  left alone because they may open. After `. , ! ? : ;` the tracker is "punct", so a swiped word gets its normal
  space prefix ("hello. next"); after a pick the tracker is "space", so a swiped word is never given a second space.
  Off: the space stays ("hello ."). A tapped letter right after a swiped word (Automatic word spacing on)
  types the space first and starts a new word for the tracker and learner ("tracking a", not "trackinga"); a tapped
  punctuation mark attaches without one. Tested by `node keyboard/sim/autospace-test.mjs`.
- **Enter** (setting "Enter closes keyboard", off by default). Steam closes the keyboard after Enter when it was
  opened with the Steam+X chord or by a game asking for "dismiss on Enter" (`VirtualKeyboardManager.SetDismissOnEnterKey`,
  read once in `HandleVirtualKeyDown("Enter")`, unless Shift is held). With the setting off the patch clears
  `m_bDismissOnEnter` before Steam handles Enter, so chat can go on line after line; B, Close or Steam+X still close.
  It remembers that it cleared Steam's flag and sets it again at the next Enter once the setting is on, when the
  keyboard closes and on `stop()` (`dismissOnEnter`, `restoreDismiss`).
- **Taps vs swipes.** A press on a letter is a tap, typed on release in press order (rolled two-thumb typing stays
  in order), until the stroke is a deliberate drag. Released taps go out as soon as every earlier press is released,
  without waiting for a later press still held on the other pad. Taps that are followed within 220 ms by a swipe are
  folded into that word ("r" tapped, "ight" swiped = "right"). Presses on anything that is not a letter (space,
  Backspace, Shift, digits, suggestions) act on press. Swiping is off while Ctrl / Alt / AltGr is active.
  A swipe is typed as soon as the last pad is released; any other key pressed before that output (Y, X, RT, a
  touched key that is not a letter, LB / RB) types the pending word first: `settleSwipe` first finishes a decode
  still running in slices (`settleFinish`), then any released strokes, before the key, Ctrl / Alt or chord goes
  out. So Enter never sends the line without its last word, Backspace after a swipe takes the swiped word back,
  and an LB / RB press right after a two-pad swipe never sends a lone Ctrl / Alt tap ahead of the words.
- **Closing right after a swipe.** Every swipe released before the keyboard closes is typed whole: the close
  (`settleOnClose`) finishes a sliced decode synchronously, decodes released strokes still waiting for their
  timer, then cancels the slice timer so no decode resumes. The queue keeps every item emitted while committing a
  swipe (marked in the queue) and drops everything else (`keepWords`), so the app gets the whole word or words,
  never a first letter alone, and nothing queued by another action. A swipe still held when the keyboard closes types nothing.
- **Swipe threshold** (setting `deadzone`, "Swipe threshold", Input tab: Small 80, Normal 100 default, Large 130;
  `padMoved`).
  The pad gate runs on time stamps, in key widths (median letter width, scaled by pad reach like the cursor slide).
  A pad press starts a swipe when it moves more than 1.1 keys within the last 120 ms, or more than 1.5 keys from
  where the thumb was 70 ms after the press (the press itself jolts the thumb, so the first 70 ms only count when
  they already travel 1.1 keys). Resting, rolling and creeping thumbs never meet either test, and neither do the
  0.8-1.1 key flicks that tapping fast produces ("m" + "aybe"). A one-key hop ("as", 0.8 key) is therefore a tap; adjacent-key words ("we", "hi") are
  swiped through the second key and past it. Samples are kept from the first point, so the decoder sees the whole
  stroke. The setting multiplies the 1.1- and 1.5-key distances, whatever the speed. The touchscreen keeps its 0.55-key gate. Numbers and the
  corpora: [BAKEOFFS.md](BAKEOFFS.md#swipe-deadzone).
- **Supported layouts.** One predicate (`layoutSupported`: Steam layouts `qwerty` and `qwerty_int`, the ones the
  English dictionary fits) gates swipe, the suggestion row, autocorrect, learning, the typed-text field, the typing
  modes' pad remap and logging. Any other layout (AZERTY, QWERTZ, Dvorak, Cyrillic, IME ...) types exactly as stock
  Steam and has no suggestion row; the Esc row and the Ctrl/Alt keys stay.
- **Spacing and case.** A swiped word gets a space in front when it follows a word or `.,!?;:` (Gboard's
  automatic space); punctuation tapped after it attaches. Shift (key or held left trigger, any time during the swipe)
  capitalises it, Caps Lock upper-cases it.
- **Pad edges.** Steam maps each pad onto the whole keyboard element, so the top of a pad lands in the suggestion
  row (in Standard the top 18 % of the pad, on a full-width pad at 1:1 the top 37 %) and the very edges on the
  keyboard's border, where Steam's hover finds no key. Every pad sample outside the keys' interior (within half a key
  height of the outer keys' edges, or above them) snaps onto the nearest key: a chip counts only while it shows a
  word, so the typed-text field, empty chips and the gaps press the number-row key below, and the hover highlight
  always shows the key a click presses. Gaps between keys inside the keyboard behave as in Steam. Not done for
  layouts that behave like stock Steam or while the settings panel is open.
- **Geometry while the keyboard slides in.** The key bounds the pad clamp and snap use (`keyBounds`), the letter
  rectangles (`letterKeys`), the zoom (`zoomOf`) and the modes' pad geometry (`modes.js` `geometryFor`) are cached
  for 500 ms (zoom 1 s), but every cache entry also stores the keyboard element's rect (left, top, width, height) and is
  dropped as soon as the live rect differs; the caches are dropped as well when the keyboard shows or hides. Steam
  slides the keyboard in by animating the height of its element for about 300 ms and computes the pad x/y from the live
  rect on every sample, while the keys inside keep their final size; with the suggestion row added the keys are 47 px
  taller than the height Steam animates to, so for as long as the element's height differs from the keys' extent by more
  than 12 px (`SLIDE_TOL`) the pad y is re-expressed against the keys' extent (`keyExtent`, `slideY`; the modes build
  their maps on it, `L.steam` keeps Steam's own rect for the inverse). Without this, presses land a row low for up to
  0.6 s after opening; with it no press is wrong after the keyboard stops.
- **Suggestion row** above the number row, three slots, reachable by either pad (where a chip with a word is under the
  pointer), touch or gamepad:
  after a swipe the middle (blue) slot is the typed word and the sides are the next candidates; picking one
  replaces it. While tapping a word the left slot keeps the typed letters (“lpl”, or "+ add lpl" for a new word) and the
  middle and right slots come from `engine.suggest` (fuzzy: completions and corrections, "lpl" -> "lol"); the middle
  one is filled blue when autocorrect is on and will apply it on space (`correct()` gets `final: true` on space and punctuation only). Picking types it and a space. Right after an
  autocorrect the left chip is "↶ dont": picking it puts the typed word back with its space (Backspace still does
  too). Holding a chip blocks the word and the chip reads "blocked: word · tap to undo" for 3 s. After a space they
  offer next words learned from your own typing. Backspace right after a swipe deletes the whole
  word and its space.
- **Learning.** Words you finish with space, punctuation or the next swipe are counted: known words get more
  likely. A word ended by Enter or by closing the keyboard is never learned (no word, phrase or pair counts), so a
  password typed and submitted leaves nothing behind. A word not in the dictionary is learned the second time it is typed by
  tapping and ended with a space or punctuation within one Steam session (never from Enter alone, so a
  single password typed and submitted is not learned). Only letters with an optional apostrophe, 2-24 long,
  are learned; pairs of consecutive known words are counted for next-word suggestions. Every field is
  learned from, including password fields Steam cannot tell apart: a passphrase of ordinary words separated
  by spaces raises those words and their pairs. Deleting a swiped word with Backspace counts against it.
  `window.__oskTrackpadFix.forget("word")` and `forgetAll()` remove learned data. Learned data lives in
  `user-words.json` (previous version `.bak`; counts only, no timestamps): under `~/homebrew/settings/vaportype/`
  with the plugin, beside `inject.mjs` with the standalone injector, written within 5 s of a change, and in Steam's `localStorage`
  (`oskSwipeUserWords`) as a fallback. The tracked word resets when the screen is touched outside the
  keyboard, after 30 s without typing, and on arrows, Tab, Esc, chords and paste, so Backspace-undo and
  suggestion picks never delete text somewhere the caret has moved to.
- **Typing modes** (`modes.js`, setting "Typing mode": Standard or Big letter keys). Big letter keys (the default):
  the three letter rows fill 70 % of each pad's height and the other rows move to the pad edges, so a letter is
  4.5-5.4 x 7.6 mm on the pad instead of 4.2 x 5.3; taps and swipes work as in Standard and the overlay draws the
  pointer at the remapped position. Standard is Steam's mapping. A saved mode that no longer exists loads as Big
  letter keys. Prior art with sources: [research/typing-modes.md](research/typing-modes.md); measurements:
  [BAKEOFFS.md](BAKEOFFS.md).
- **Autocorrect.** On space or punctuation a tapped word goes through `engine.correct`: keyboard-distance
  typos, missing apostrophes ("dont" -> "don't", "im" -> "I'm"), run-together words and phrases ("imdone" ->
  "I'm done"). It is applied only when `confident`; learned words, words with digits, ALL-CAPS and common real
  words without strong context are never changed. Backspace right after it restores what was typed.
- **Dictionary and word pairs.** `keyboard/data/words.js` and `keyboard/data/lm.js`, built by
  `keyboard/build/build_words.py` from wordfreq, the SCOWL word lists and the generated chat and web pair counts in
  `keyboard/data/inputs/` (`pip install wordfreq==3.1.1`; `OSK_*` variables select variants; the default build
  reproduces the shipped files byte for byte). Sources and licenses: [DATA-LICENSES.md](../keyboard/data/DATA-LICENSES.md).
  `keyboard/src/engine.js` is
  the decoder and learner (`createEngine(words, { lm })` with `decode`, `complete`, `predict`, `correct`,
  `learn`, `unlearn`, `forget`, `info`, `warm`, `warmStep`, `setUser`, `exportUser`; `warmStep()` builds one index, 200 000
  characters of the pair table or one letter's completions per call, and the patch creates the engine and runs these
  steps in idle callbacks after it loads, so the first keyboard open does none of it); a word pair you typed twice comes
  first in `predict`. It splits the trace into one
  run per pad press (points tagged `L1`, `R2`, ... by `patch.js`), ignores a pad held still while the other
  works, splits the word's letters across the runs in order within each pad's reach (`ctx.pads`), and scores
  location (DTW), start/end keys, shape, length and word frequency, with a bonus for pauses or loops on
  double letters (bimanual approach of Bi et al., UIST 2012; constants tuned with `bench.mjs`).
- **Trackpad clamp.** Pad x/y are clamped onto the key area up to 80 px outside it, so an overshoot below the
  bottom row hits the key above it (ValveSoftware/steam-for-linux#10683).
- **Esc, Ctrl, Alt keys.** Esc goes left of the number row; Ctrl and Alt go to the bottom-left corner. They use
  Steam's own `Control` / `Alt` toggle states, which the keyboard already had but ignored on output: tap is
  one-shot (blue label), double tap locks (blue key), a third tap turns it off, like Shift. Holding the key on
  the touchscreen also works.
- **LB holds Ctrl, RB holds Alt** while the keyboard shows letters (left trigger already holds Shift). The
  bumpers only drive IME candidate paging, unused in Latin layouts; in the emoji layouts they still switch
  categories. Closing the keyboard forgets a bumper still held (its release may never reach the keyboard) and
  strips the held bit from Ctrl / Alt, so a reopened keyboard types plain keys; it also drops a pad hold on a
  suggestion chip or the emoji key, so the next press on that pad types.
- **Output.** While Ctrl or Alt is active, or for Esc, the key goes out as real key events through
  `SteamClient.Input.ControllerKeyboardSetKeyState(EHIDKeyboardKey, down)`, the same call Steam's Paste key
  uses (LControl 103, V 25). Keys 0-99 are USB HID usages; modifiers are LAlt 100, LShift 101, LWin 102,
  LControl 103, RShift 105. The real Ctrl/Alt is held down while the toggle is active and released when it
  clears or the keyboard closes; it never goes down while plain text is still queued: the press waits in the
  queue behind that text (40 ms chord gap), and a plain character or Backspace that finds Ctrl/Alt down releases
  it first and queues the press again after itself. Shift is added for Shift (key or left trigger) and for shifted symbols; Tab
  uses Right Shift because Steam takes LShift+Tab. Plain typing and swiped words stay on Steam's text path
  (`VirtualKeyboardManager.HandleVirtualKeyDown` -> `ControllerKeyboardSendText`, gamescope IME), always one
  character per call: gamescope types a multi-character string on a temporary keymap over KEY_1, KEY_2, ...,
  and Moonlight forwards scancodes, so Windows would receive "123456". Both paths are paced by shared send marks rather than
  one queue: `TypeKey` sends straight through when nothing is queued and that key's gap has passed, and records the send;
  otherwise the key waits in the queue — 30 ms between keys, 100 ms since the last press of the same physical key (even with other keys between;
  `a`/`A`, `1`/`!` share a key), 100 ms after Backspace, Enter or another named key, 60 ms when Shift turns on or off,
  and 40 ms around a Ctrl/Alt chord so Shift cannot leak; non-ASCII is not sent. Shift, Caps, Ctrl, Alt and
  layout switches (`SwitchKeys_*`) are never queued: Steam applies them at once, and a key that has to wait is
  queued with its case already decided (the character, and Steam's one-shots cleared, at the press), so a
  toggle touched while output is queued applies once. Held Backspace (X, or a pad or touch
  held on the key) repeats every 100 ms instead of Steam's 200 ms (`s_longPressRepeatThreshold`, restored by `stop()`;
  Steam's 450 ms first delay stays), the same 100 ms as the same-key gap, so repeats never wait in the queue; a repeat
  that finds a Backspace still queued is dropped, so nothing keeps deleting after release, and the suggestion row is
  refreshed 200 ms after the last repeat instead of on every one. Measured on a Deck streaming to
  Windows with Moonlight (the 30 ms base gap sits between the 25 ms row, 0 errors in 2161 chars, and the 35 ms row,
  0 in 1233), and in a local gamescope harness: [BAKEOFFS-output.md](BAKEOFFS-output.md); source reading behind it in
  [research/gamescope-ime.md](research/gamescope-ime.md) and [research/steam-text-path.md](research/steam-text-path.md).
- **Settings panel.** Holding the emoji key (550 ms) opens a panel over the keys, in the keyboard's own rectangle
  (854 x 286 CSS px on the Deck); a short press still switches to emoji. The emoji key has an 18 px dark corner badge
  with a 14 px light gear and a ring that fills while it is held. Works with a pad click, the touchscreen and A on the
  gamepad-focused key. It fades in over 90 ms with a 1.5 % scale (none with `prefers-reduced-motion`). Frame, top to
  bottom: a 36 px header (wordmark "VaporType", status "Big letter keys · 57 words · vN": the real learned count, "1 word" in the singular, a ✕ close button), a 40 px
  tab bar (icon and label, the active tab a dark blue pill with a 2 px #4aa8ff underline, the Words tab with its word
  count, "LB ◂ ▸ RB" at the right), the scrolling body, and a 32 px footer with one 13 px line naming what the buttons do on the focused row ("A Toggle", "◂ ▸ Change", "A Select", "A Forget", "L2/R2 Page" only on a paged Words list, then "LB/RB Tabs", "B Close"; "A Confirm · B Cancel" while Forget everything is armed),
  the Words undo and the Words pager. Tabs and rows (`PANEL_TABS`, `PANEL_ROWS` in `patch.js`, section headers in
  capitals):

  | tab | sections and rows |
  |---|---|
  | Typing | Layout: Typing mode (Standard / Big keys), Swipe typing · Spelling: Autocorrect, Suggestion row, Automatic word spacing, Remove auto space before punctuation, Learn new words |
  | Input | Pads: Pad reach (Own half / Past middle / Whole / Right only), Full-width pad up/down (Balanced / Even / Stretched; only while a pad covers 100 %), Swipe threshold (Small / Normal / Large) · Buttons: Slide space bar to move cursor, LB / RB hold Ctrl / Alt, Enter closes keyboard |
  | Look | Look (Modern / Steam / OLED) with the live preview in its row, Keyboard background, Keys, Space bar, Top strip (two per row, all four visible on open), Glass (Off / Light / Strong) · Feedback: Swipe trail, Show typed text · Reset look |
  | Words | List (Learned (n) / Blocked (n)), then 8 words a page with their count |
  | System | Privacy: Private mode, Keep typing log, Clear typing log · About: the version line · Controls: a gamepad help card · Forget everything |

  Row ids give the row type: `t_<setting>` a toggle (`TOGGLE_LABELS`: label and one-line description, a 44 x 24
  switch), `s_<setting>` a slider (`SLIDERS`: `label`, `desc`, `min`, `max`, `step`, `text(value)`; the value and a
  160 px track with a 14 px knob; 110 px in the Look tab's two-column grid, a nested list in `PANEL_ROWS`), `c_<setting>` a segmented row (`CHOICES`, or `GLASS` for `blur`: 2-4 buttons, the
  current one blue, the description line is the selected option's), then the actions `reset_look` and `clear_log`
  (chevron), the danger row `forget_all`, the list rows `w_0`..`w_7`, and the non-focusable `version` and
  `help`. Every row is at least 48 px tall with a 16 px semibold label and a 13 px description; segment buttons are
  40 px. One entry in the table adds a setting of that type; every write goes through `setSetting`, which saves it and
  repaints only the rows bound to that setting (`paintSetting`).

  Behaviour. One focus ring (3 px #4aa8ff outline on a lighter blue-grey fill) marks the focused row, and opening
  the panel focuses the tab's first row, so the ring is always there; up / down move through the active tab and
  the rows and wrap; the page scrolls just enough to keep the focused row (and its section header) visible. A held
  stick or D-pad repeats after 350 ms at 8 per second on its own timer; Steam's `is_repeat` events are ignored. On the
  tab bar left / right switch tabs and A goes into the list; LB / RB switch tabs from anywhere (wrapping) and focus the
  new tab; LT / RT page the Words list (wrapping) and switch tabs elsewhere. On a row: A switches a toggle, steps a
  slider up (wrapping) or a segmented row to the next choice, and runs an action; left / right switch a toggle, step a
  slider by `step` (holding repeats after 400 ms at about 12 per second until release or the end), or move a
  segmented choice (stopping at the ends). B cancels an armed Forget everything, otherwise closes the panel. X, Y and
  Backspace do nothing while it is open. Touch acts on release inside the same row and never when the drag scrolled the
  list; a horizontal drag on a slider sets it live; a pad click, touch or mouse click on a slider's track sets the value
  under it, on a segment picks it, and moves the focus to that row. Mouse and pad hover only shade a row. Words: A or a
  tap forgets a learned word or unblocks a blocked one and puts `Forgot "x" — A to undo` in the footer for 5 s with the
  focus on it (up / down go back to the list); the pager "‹ Page 1 / 4 ›" is tappable. Forget everything is armed by
  the first press (red, "Press again to forget everything", a 5 s countdown bar) and runs on a second press within
  5 s. Clear typing log is greyed out while the log is off and nothing was written (`logFile`).

  Live preview. The Look row carries a 230 x 52 px box between its label and its choices: a blue-to-orange striped
  "game" gradient with a checkerboard band, and over it a small keyboard (suggestion strip, q w e ⌫, space bar) painted with the look's colours and the same
  `--osk-ba`, `--osk-ka`, `--osk-ma`, `--osk-sa`, `--osk-ra` values as the real keyboard (`lookValues()`), each set on
  the one element that uses it, plus the glass blur. While the panel is open it covers the keyboard, so look changes
  update the preview at once and reach the keyboard's stylesheets (`applyLook`) when the panel closes; rewriting those
  sheets restyles the whole document.

  Performance. Each tab's DOM is built once (the open tab on open, the others one per 40 ms afterwards, laid out
  hidden and then kept with `content-visibility: hidden`), rows are kept in a map, and a change touches only its row:
  classes, inline transforms and text node data (replacing a text node re-runs Steam's `:has()` rules, 2.2 ms per
  value at 4x). Each page scrolls on its own, so a tab switch only swaps two classes. Tab icons are inline SVG (data-URL
  masks cost 20 ms of style on the first open). Measured with `node keyboard/sim/panel-perf.mjs` (`CPU=4` or `CPU=1`,
  `PATCH=<file>` for another version; synchronous handler plus style and layout, 8 opens and 20 of each step;
  `perf-test.mjs` checks the budgets; a task over 16 ms counts unless a V8 garbage collection of the engine's heap is
  most of it, 25-90 ms at 4x and listed as `gcTasks`), median / p95 ms:

  | at 4x CPU | measured | budget |
  |---|---|---|
  | first open | 34-42 | 60 |
  | open again | 10.4 | 60 |
  | tab switch (RB) | 2.6 / 7.3 | p95 16 |
  | toggle (A) | 1.6 / 3.3 | p95 8 |
  | Typing mode (◂ ▸) | 2.3 / 5.4 | p95 16 |
  | slider step (◂ ▸) | 2.4 / 3.2-4.6 | p95 4 |
  | tasks over 16 ms in 80 steps | 0 | 0 |
  | panel open and idle, CPU | 0.4 % | 2 % |

  The slider p95 is 3.2-3.6 ms on a quiet host and reached 4.2-4.6 ms in two of eight runs with other load; a
  step is about 1 ms of script, 1 ms restyling the fill, knob and four preview keys, and up to 1 ms of layout. At 1x:
  first open 18.6, open again 2.7, tab 0.7 / 2.0, toggle 0.5 / 0.9, slider 0.7 / 0.9. The panel builds nothing until
  it opens. The first open lays out about 90 elements under Steam's stylesheets (style and first text layout are most
  of it); every later open reuses them.

  The version line in System reads "VaporType vN · engine vN · words vN · pairs vN · modes vN · installed <date>"
  (`installed.json` beside the standalone injector; the plugin reports its own install date). Any hold (pad, touch,
  A) opens the panel with the focus on the first row. After first use is answered, a tip lists: hold the gear (the
  emoji key) for settings, hold and slide space to move the cursor, swipe words (setting `tipShown`); it goes away on
  the next key, pad or touch input, when the panel opens, or after 8 s. The gear is one SVG used on the emoji key, in
  the tip and on the first-use card.
- **First use.** With no saved settings anywhere (`__oskUserWords.settings` and `localStorage`), the first keyboard
  open shows a card: "VaporType can learn words you type and show what you typed above the keys. Both stay on this
  Deck." with Turn on / Keep off (pad, touch, D-pad and A), a gear hint and "B: later". Until it is answered, learning and the typed-text field
  are off; the answer sets both and is saved as `consent`. B or Close postpones it until the keyboard is next
  opened. Users with saved settings never see it and keep their settings. Pads, touch and mouse click the controls
  (they carry `data-key="OSKSet_*"`, so Steam's pad hit-test finds them); B, ✕ or hiding the keyboard closes the
  panel. Auto-repeats never repeat a tab or page step. A trigger the user has set to click the pad (Steam's trigger-as-click) still clicks the pad's pointer instead.
  Steam delivers the sticks (as D-pad directions), bumpers (5, 6) and triggers (7, 8) as digital `vgp_onbuttondown` /
  `vgp_onbuttonup` events, and thresholds the analog triggers itself, so no hysteresis is needed here. Pad clicks,
  triggers, bumpers and face buttons do nothing else while it is open, and never toggle Ctrl / Alt; the panel only
  takes the release of a press it took (bumpers and triggers included), so X still held from Steam+X when the card comes up reaches Steam on
  release and Steam's X Backspace repeat stops, and what the panel holds is cleared each time the keyboard opens. Settings
  are saved as `settings` in `user-words.json` (with the learned words) and in `localStorage`
  (`oskSwipeSettings`). Both copies carry `at`, the time of the last change (`setSetting`); on load the newer copy
  wins (the file when they tie or have no stamp), because the plugin writes the file at most every 60 s while the
  keyboard is open and a restart inside that window must not revert the change.
- **Tap positions.** Every tapped letter's position (pad x/y after Steam's mapping and the mode remap, or the touch
  point; CSS px like the key geometry) is kept beside the word buffer, one entry per character (null when unknown,
  e.g. gamepad A), and passed as `ctx.taps` to `engine.suggest` and `engine.correct`.
- **Typing log** (setting "Keep typing log", off in code). Per finished word: the swipe trace (points, pad tags,
  times) or the tap positions, the decoder's or suggestion row's top candidates, the typed and the committed text,
  and the outcome: kept, picked from the row, autocorrected, autocorrect undone, or deleted with Backspace (then
  with the word typed next, the intended word). `env` records carry the versions and key settings and `geo` records
  the key geometry whenever they change. Same privacy rule as learning: only words ended by space, punctuation or
  the next swipe are logged (not words ended by Enter or closing). The host appends to
  `typing-log.jsonl` (`~/homebrew/data/vaportype/` with the plugin, beside `user-words.json` with `inject.mjs`;
  rotated to `.1` at 5 MB, two files kept), acknowledging each batch; Steam keeps at most 400 unwritten lines. A typing
  log is private typing data: never commit one.
- **Private mode** (setting, off): no learning (words, pairs, new-word counts), no autocorrect, no typing log, no
  in-memory swipe log, and the typed-text field shows
  "Private mode · hold here to turn off" instead of the text. Hold the typed-text field 550 ms (touch; a pad
  there presses the number-row key below) to toggle it, or use the panel switch; a short press does nothing. Entering and leaving it reset the word
  context (previous word, buffer, taps, undo state), so "hello" typed
  in private mode and "world" after it never form a pair. `forgetAll()` (Forget everything) also resets that context,
  clears the in-memory swipe log and the typing log and asks the host to delete `user-words.json.bak` and both log
  files.
- **Safety.** Before changing anything the patch checks the Steam calls and keyboard methods it uses
  (`SteamClient.Input` send calls, the layout module, `VirtualKeyboardManager.HandleVirtualKeyDown`, then on the
  first keyboard `TypeKeyInternal`, `OnTrackpadAnalogInternal`, `StartLongPressTimer` and the rest of
  `KB_METHODS`); if one is missing, or a patching step throws, it rolls back to stock Steam and `status()` reads
  `vN unsupported Steam build: <what>`; re-injecting does not retry that build. Module scans back off from 30 s
  to 10 min. `stop()` cancels the output queue and its timer (queued work carries a
  generation number), restores every wrapped method and the pads' x/y properties, and releases held keys last;
  closing the keyboard drops queued output, except the letters of swipes already released, which finish first;
  `tapKey` releases in `finally`.
- `window.__oskTrackpadFix.stop()` removes everything (layouts, prototype wraps, listeners, held keys, style,
  trail, panel); `setSetting(name, on)` changes a setting,
  `openSettings()` / `closeSettings()` drive the panel; `status()` reports
  `vN layouts=N keyboard=patched|waiting swipe=on|off|no-engine mode=<id>`; `typeText(s)` sends text through the
  output queue; `idle()` is true when nothing is queued or pending (the simulator waits on it); `keyboardOpen()` is
  true while a keyboard is showing (the plugin saves when it closes).

The back grips cannot be used: while the keyboard is open Steam swaps the controller to its built-in
Big Picture config for app 769 (`controller_base/basicui_neptune.vdf`, log line "On Screen Keyboard Forcing to
window type: KB ActionSet, AppID 769"); the game's own controller layout is inactive, the grips reach neither the keyboard
nor the game, and user configs for 769 are ignored.

`inject.mjs` re-evaluates `patch.js` every 5 s over CEF remote debugging (`CEF_PORT`, default 8080), so it
survives Steam restarts. It first loads `swipe/words.js`, `swipe/lm.js`, `swipe/engine.js` and `modes.js` when Steam lacks their version,
hands Steam the saved user words once per Steam start, writes them back when `takeUserWords()` reports a
change and then confirms with `ackUserWords(rev)` (the patch keeps offering the data until confirmed), appends
`takeTypingLog()` lines and confirms with `ackTypingLog`, and carries out `takeRequests()` (delete the backup or
the log). Each cycle handles requests first. `takeRequests()` returns `{removeBackup?, clearLog?, rev}` and
keeps offering it until `ackRequests(rev)`. A host announces that it acknowledges by setting
`window.__oskTrackpadFix.hostAcks = true` after evaluating the patch, every cycle (the flag only turns on; reading it
returns the state); after that a request is never dropped without `ackRequests(rev)`, however many takes fail.
A host that never announces and never acknowledges has the request cleared after three offers. `inject.mjs`
announces each cycle and acknowledges only when every deletion succeeded (a missing file counts as deleted), and the `takeUserWords()` payload carries `forgetGen`, which goes up with every Forget everything:
when it changes within one Steam session (`hostSession`; a re-injected patch starts again at 0) the host writes the file without making a backup and deletes `.bak`, and if it changes while a
save is in flight (`window.__oskTrackpadFix.forgetGen` read after the write) the host handles the requests again
and saves the forgotten state before acknowledging, so a forget always wins over a save. A forget writes a
tombstone, `forget.json` beside `user-words.json` (`{key, session, gen, pending}`; key is the page's `hostSession`,
set by the injector, plus the request rev), listing `user-words.json`, `.bak`, `.tmp` and both log files, then
deletes them. Paths that could not be deleted stay in `pending` and are retried every cycle; `user-words.json` and
`.tmp` also leave it when a save from after the forget (same session with `forgetGen` at least the tombstone's, or a
later session) replaces the file. The request is acknowledged only when `pending` is empty, and `loadUserWords`
never loads a pending file, so a failed save after a forget cannot bring forgotten words back at the next Steam
start (as the Decky plugin's `main.py`). One injector at a time: `inject.lock` holds its pid, a second one waits. HTTP discovery times out after
3 s and the WebSocket open after 5 s; after failures it backs off up to 60 s. Overrides: `OSK_USER_WORDS`,
`OSK_TYPING_LOG`, `OSK_LOG_MAX`, `OSK_INSTALLED`, `OSK_LOCK`, `OSK_CYCLE_MS`, `OSK_HTTP_TIMEOUT_MS`.

To run it without Decky: enable CEF remote debugging in Steam, assemble a runtime folder with
`node keyboard/runtime.mjs <dir>` (`patch.js`, `modes.js`, `swipe/`, `inject.mjs`) and run `node <dir>/inject.mjs`,
for example from a systemd user unit. Stopping the injector and restarting Steam removes the patch.

## Simulator (`keyboard/sim/`)

Runs the deck's real Steam keyboard in headless Chromium without a deck: the steamui files (`scripts/fetch-steamui.sh`
copies them to `.steamui/`, or set `STEAMUI`) are served as `https://steamloopback.host/`,
`library.js`'s webpack runtime is kept but its app entry is replaced, the app module graph is initialised,
and Steam's `VirtualKeyboardContainer` renders with a real `VirtualKeyboardManager` and a mocked `SteamClient`
that records `ControllerKeyboardSendText` and `ControllerKeyboardSetKeyState`. Pads, triggers and bumpers are
driven with the same `vgp_onbuttondown/up` events Steam dispatches.

`keyboard/sim/test-all.sh` (`pnpm run test:sim` runs it with the plugin tests) runs every suite in parallel (one
Chromium each, `swipe-test` twice, plus `keyboard/bench/gates.mjs`), then `perf-test` alone, since its millisecond
budgets do not hold with eight throttled Chromiums beside it, and prints pass/fail counts and seconds per suite; logs go to `$OUT` or a temp
dir. The suites wait on conditions, not fixed sleeps: `run.mjs` exports `inject(page, src)` (waits until the
patch reports `keyboard=patched` or unsupported), `settle(page)` (until `__oskTrackpadFix.idle()`, no new
output for 40 ms and a frame; `join: false` skips the 220 ms swipe-join window), and `waitKeyboard(page)` (after
reopening: the keys exist and the space bar stopped moving, since Steam slides the keyboard in). Only real holds
(long-press 550 ms) and swipe pacing keep sleeps. Each suite picks its own CDP port or none, so they run side by
side. `run.mjs` serves Steam's controller glyphs from the local Steam install (`GLYPHS`, default
`$HOME/.local/share/Steam/controller_base/images/api/light`) so they do not show as broken images.

- `pnpm i`, then `node keyboard/sim/test.mjs`: first reproduces the stock bugs (rolled space comes out before `h`), then
  injects `patch.js` and checks what the Windows side would receive for rolled typing, overshoot, one-shot and
  locked Ctrl, Alt+Tab, Esc, Ctrl+Alt+Esc by mouse, Ctrl+Shift+T, LB/RB holds, LB / RB pressed while
  `typeText` output is queued (text first, no Ctrl/Alt held under it, then the chord), touched Shift and Ctrl
  while 10 characters are queued (`He`, Ctrl+c then a plain h), symbols, Shift+Tab, Ctrl+arrow, release on close, reopen, `stop()` and re-inject. `PRE_PATCH=<old patch.js>` tests the upgrade path,
  `SHOTS=<dir>` saves screenshots.
- `node keyboard/sim/swipe-test.mjs`: swipe typing end to end in Steam's real keyboard: one-pad and two-pad swipes, Right pad only driven through Steam's raw pad
  mapping, taps that stay taps, Backspace after a swipe, Y / X / RT / touched space 0, 40 and 120 ms after a pad swipe
  (always after the word), suggestion picks, completions, Shift, automatic space, punctuation,
  learning a new word by tapping and then swiping it (strokes of about one key, like the two-pad "lo" of "hello", stay taps under the swipe threshold, so those scenarios swipe 1.5 keys past the last letter), touchscreen swipes and taps, two quick words on
  alternating pads, tap-then-swipe, swipe off under Ctrl, left-pad-only "testing" at pad reach 75 and 100, the
  setting's storage and refusal of invalid values, and `takeUserWords()`. Every scenario fails on a
  multi-character SendText or the same physical key re-sent within 32 ms. `WITH_MODES=1` also loads `modes.js`
  (so the default Big letter keys mode is active).
- `node keyboard/sim/padedge-test.mjs`: pad edges through Steam's raw pad mapping in Standard, Big letter keys,
  reach 75 and 100, Right pad only 1:1/2:1/3:1, threshold 130, the typed-text field off and the suggestion
  row off, both pads: at uy ±1 and ±0.98 (ux -1, -0.5, 0, 0.5, 1) and ux ±1/±0.98 the hover and the press hit the
  same real key (the number row or a chip showing a word at the top, the bottom row at the bottom); clicks at the top
  edge press it; a word swiped off the top edge still decodes.
- `node keyboard/sim/open-bounds-test.mjs` (`PATCH_SRC=<file>`, `MODES_SRC=<file>` test other sources): hide, show,
  and every 30 ms for a second raw pad samples aimed at a row of letters on both pads (Standard, Big letter keys,
  reach 75 and 100, Right pad only 2:1 and 3:1), compared with stock Steam run the same way: after the space bar stops
  moving every press must hit the aimed key and none may be wrong later than stock's last wrong hit + 50 ms.
- `node keyboard/sim/twopad-test.mjs`: both pads at once through Steam's raw pad mapping (`twopad.mjs` drives both pads
  on an 8 ms tick, a resting thumb is a pad sampled with ±0.002 jitter and no press, a lift is no more samples):
  two swipes pressed at the same time (either pad first, and 3 s long at 120 Hz) type both words in press order;
  a swipe is typed within 100 ms of release with the thumb lifted, the other thumb resting, or both resting;
  alternating taps at 8 and 12 per second, and rolled taps with overlapping 110 ms holds, keep every letter in
  order, each out within 120 ms of its release; "drag" + "on" across the pads still joins with the second press
  30 and 120 ms after the first release; "the" then "only" 100 ms later stays two words without a Backspace;
  closing the keyboard 0/20/40/60 ms after a one-pad and a two-pad swipe types the whole word(s), a close with other
  output queued behind the word types only the word, a close with other output queued between two swipes types both
  words and drops the output between them, a close with no swipe still drops queued output; at 4x CPU,
  LB, RB, Y, X and RT pressed 0/10/20/40 ms after a two-pad swipe come out after both words, once.
  `node keyboard/sim/twopad-bench.mjs` (`N`, `N3`, `CPU`, `PATCH`,
  `MODES`, `CASES=1,3`, `PROFILE=<case>` for self time and forced-layout callers, `OUT=<json>`) prints the
  table in [BAKEOFFS.md](BAKEOFFS.md#two-pads-at-once).
- `node keyboard/sim/leak-test.mjs` (`OPENS`, `SAMPLES`, `CPU`): opens and closes the keyboard `OPENS` times (40) with
  stock Steam and with the patch, then sends pad samples to every handler registered with
  `RegisterForControllerAnalogInputMessages`, as Steam's client does. Stock must leak one registration per open of
  each of the three kinds; patched must stay at two (the keyboard that was open before the patch loaded and the live
  one), still drive both pads, give the input back to a keyboard that mounts again, and restore everything on
  `stop()`. The sim's `mock.js` keeps `Register…` callbacks in `window.__steamRegs` for this.
- `node keyboard/sim/deadzone-test.mjs`: the swipe-start gate on the pads, driven through Steam's raw pad mapping with
  timed samples: 10 seeded resting-thumb random walks (0.6-1.2 keys over 300-800 ms, touch-down jolt) must stay taps,
  smoothstep rolls may start at most 10 % swipes, seven accidental swipes logged on the Deck (the logged "red"
  replayed point by point, "as" x3, "hmm", "tree" and "oh" synthesized from the logged sample count, duration and path
  length in three speed profiles each) must all stay taps, fast "to", "it", "we", "hi" still decode, a press without
  movement, a 0.45-key jolt at touch-down and a slow 1.2-key creep stay taps. `DEADZONE_BENCH=1` runs 120 drifts per
  corpus plus 12 short words at 6, 10 and 16 keys/s and prints JSON (`STOCK=1` skips the patch, `PATCH_SRC=<file>`
  tests another patch.js, `DEADZONE=80|100|130` picks a preset).
- `node keyboard/sim/settings-test.mjs`: the settings panel: emoji tap vs hold by pad, touch and A, pad
  clicks on the panel not typing, B and ✕, D-pad focus, each switch's effect, the suggestion row removed
  with keycodes still aligned, the Pad reach segments (75 widens the pointer areas once the panel closes, an invalid
  value is refused; Full-width pad up/down shown only for Whole and Right pad only), the Words lists (counts, tap to forget with the undo offer, Blocked, the ‹ › pager over every learned word),
  Forget everything, closing with the keyboard, and settings coming back from the `takeUserWords()` JSON after a
  "Steam restart" (new page) and from `localStorage` (a setting changed after the last file save beats the older file
  copy; a newer file beats an older `localStorage`), the Look sliders (defaults, D-pad step and held repeat,
  clamping, a pad click on the track, the look CSS applied on close, Glass, Reset look), and the old `opacity`
  setting migrating (80, OLED 90, Steam 100, 70, a full v0.2.3 settings object, junk values), a saved Fast taps or
  Columns mode loading as Big letter keys and a saved `onePad: true` as Right pad only. `SHOTS=<dir>` saves
  panel screenshots.
- `node keyboard/sim/menu-test.mjs` (`PATCH=<file>` for another version): the panel's frame (header status, one-line
  tab bar of five tabs with icons, "LB ◂ ▸ RB", footer hints, section headers) and rows (16 px label, one-line 13 px
  description, control on the right, at least 48 px); LB / RB through all tabs with the wrap and the focus on the new
  tab, left / right and A on the tab bar, LT / RT paging an 8-a-page Words list and stepping tabs elsewhere; one focus
  ring, up / down wrapping and the list scrolling just enough; a held stick repeating at about 8 per second after
  350 ms with Steam's repeats ignored; toggles by A and left / right; X, Y and Backspace doing nothing; segmented rows
  by A, left / right (stopping at the ends) and a click; sliders by left / right, a held direction, A and a click on
  the track; the live preview following a slider step without re-rendering the rows; no node of the panel replaced by
  toggles, sliders or tab switches; Words forget / undo (and its 5 s expiry) and unblock / undo; Forget everything
  arming, B cancelling it before closing the panel, and the 5 s window; touch acting on release and not after a
  scroll, mouse hover not moving the focus; and with the panel open or closed that bumper, trigger, stick and face
  presses and releases reach Steam only when the panel did not take them and no Ctrl / Alt is left held (LB / RB on
  or off), and an LB held while the keyboard closes whose release never arrives leaves no Ctrl on reopening.
- `node keyboard/sim/latency.mjs` (`PATCH=<file>`, `SETTINGS='{"reach":"right"}'`, `N=20`, `WITH_MODES=0` to leave out
  `modes.js`): pad tap and swipe latency through Steam's real pad mapping, with raw pad positions computed through
  the mode's and the full-width remap. `openSim({ backdrop: true })` / `SIM_BACKDROP=1` puts a fake chat page behind the
  keyboard for see-through screenshots.
- `node keyboard/sim/perf-test.mjs` (`CPU=4`, Chromium CPU throttling): with the keyboard closed, loading `patch.js`
  does not build the engine, the engine is built and warmed in short background steps before the first open, and
  nothing paints; the first open is not rendered twice and does no engine work in its first 250 ms; an open, untouched
  keyboard requests no animation frames and changes no DOM; held X repeats Backspace about 10 times a second, never
  closer than 100 ms, does not pile up behind queued text; the settings panel budgets from `panel-perf.mjs` (open
  <= 60 ms first time included, tab p95 <= 16, toggle p95 <= 8, Typing mode p95 <= 16, slider step p95 <= 8, no task
  over 16 ms during the steps, idle panel <= 2 % CPU; a set over budget is measured once more and must pass then);
  `stop()` restores Steam's interval; typing works with no animation frames at all; stepping the Typing mode back and
  forth runs no task over 16 ms at 4x (a gap sampler, excluding the 150 ms after each switch itself). `node keyboard/sim/perf-bench.mjs` (`CPU=6`, `FPS=15` throttles rAF, `STOCK=1` for
  Steam's keyboard without the patch, `PROFILE=<file>` with `WINDOW=open|all` for a CPU profile) prints the costs
  in [BAKEOFFS.md](BAKEOFFS.md#startup-idle-and-backspace).
- `node keyboard/sim/echo-test.mjs`: the typed-text field: geometry and raw pad mapping unchanged with it on, its
  area hits no key, pad taps, a swiped word, Backspace after a swipe and after a tap, suggestion picks, Enter,
  outside touch, arrows, Tab, Ctrl chord, Esc, 60-character tail, the 30 s gap, hidden under the panel, the switch,
  the space-bar fallback, keyboard reopen, `stop()`. `SHOTS=<dir>` saves screenshots.
- `node keyboard/sim/look-test.mjs`: computed styles per look: at the defaults the space bar (0.3) is far more
  see-through than the keys (1.0); board, key, space-bar and top-strip alphas follow their own settings, 0 and 100 give
  clear and solid; contrast of the space-bar label, "◂ cursor ▸", the typed text in the space bar and in the top strip
  (>= 4.5:1 over black and mid-grey); Glass blur Light / Strong / Off on the board; 60 slider changes rewrite the
  variables sheet 60 times and the look stylesheet never; no DOM changes while idle.
- `node keyboard/sim/autospace-test.mjs`: the exact output stream for the auto space: pick then `.` `,` `?` `!` `:` `;` `)` or Enter (one
  Backspace first), a swiped word after them (spaced once), a typed space / cursor move / Backspace / letter in between (space kept),
  the setting off, Standard, and a tapped letter after a swipe starting a new word. The simulator logs the unshifted key for Shift + key.
- `node keyboard/sim/modes-test.mjs`: the typing modes through Steam's raw pad mapping (Big letter keys is the default,
  Standard's number row, Big letter keys taps and swipes, Right pad only reaching the left letters), the panel
  selector, an old mode refused, and `stop()`.
- `node keyboard/sim/input-test.mjs`: with `modes.js` loaded: no overlay pixels while no pad is touched in Big
  letter keys, the Right pad only y/x gain through Steam's raw pad mapping (1:1, 2:1 in Standard and Big letter keys,
  3:1) with the top and bottom rows reachable, Enter with Steam's dismiss flag set (setting off, then turned on: the
  flag comes back), space by pad and touch, cursor slides by pad (both ways, reversal, Right pad only) and touch, the word tracker reset, a fast
  8-key slide that must drain within 160 ms of the last move, the setting off, rolled space then letter, and the
  "lpl" suggestion row and picks. Pad reach 55, 75 and 100 in Standard
  and Big letter keys: which keys each pad reaches at its far edge through the raw pad mapping.
- `node keyboard/sim/privacy-test.mjs` (pages run one after another; `PARALLEL=1` runs them together): private mode boundary
  ("hello" in private, "world" after: no pair, nothing logged or kept), Enter- and
  close-ended words not learned (known word, phrase, repeated password-like word), forget requests pending until
  `ackRequests(rev)` with `forgetGen`, the French layout behaving like stock Steam, `hostAcks` keeping a forget through six unacknowledged takes while an unannounced host clears after three, the first-use card (Keep off by
  pad, Turn on by D-pad and A, existing users skip it), the VaporType title and version line, and the typing log off
  by default with nothing typed kept and `keyboardOpen()` following the keyboard. `inject-test.mjs` adds a forget
  whose replacement save fails (`user-words.json.tmp` undeletable): not acknowledged, no forgotten word on disk or
  after a restart, finished once the fault clears; a forget kept pending through five failed deliveries (`.bak` made
  undeletable) and delivered once it can be deleted; and a forget during an in-flight save. `run.mjs`'s `inject()` answers the first-use card for every suite unless called with
  `{ consent: false }`, and `openSim()` waits until the keyboard has slid into view.
- `node keyboard/sim/ux-test.mjs`: look and flows: slide arrow by direction, gear badge size and backing, focus on the first control after a pad hold, no box-shadow or
  outline on any key, chip, panel control or the field, "added: word" after "+ add", tip closed by the panel and drawn
  with the gear, version line in System, Clear typing log greyed out, opaque suggestion row at 100/90/80 %,
  top strip following its own alpha, smaller L3 glyph on Caps, focus on the first control after an A-hold, the mode
  badge rule, the first-run tip (shown once, hidden by a key, flag saved), 'teh ' ->
  'the ' on space, autocorrect target filled while typing, the corrected word marked in the field and gone after
  1.5 s, the ↶ undo chip and Backspace undo, the swiped word filled, hold-to-block notice and its undo, "+ add",
  the emoji badge and hold ring, the panel's five tabs/blue tab underline/single focus ring/label and description
  sizes/switch contrast/danger row,
  20 px letters, 14 px modifiers, ⌫ ⏎ ⇧, the LB badge, locked Shift contrast, "◂ cursor ▸" while sliding, the mode
  badge and the Look tab's four sliders and Glass choice with no old opacity setting.
- `node keyboard/sim/robust-test.mjs` (four pages in one browser, in parallel): `ctx.taps` from pad and touch taps reaching
  `suggest`/`correct`; typing-log records (kept, autocorrect undone, picked, swipe deleted with the next word, an
  Enter-ended word left out), versions, settings, geometry, traces and tap positions; log acknowledgement;
  private mode (no autocorrect, learning or log; the field's text) and its hold toggle by touch; the
  version line and new panel controls; Clear typing log and forgetAll requests; closing the keyboard drops queued
  output (hidden right after the first character goes out, so exactly 1 of 26 arrives); `stop()` cancels output, restores the pads' properties and releases Ctrl last; preflight with a missing
  keyboard method and a missing `SteamClient.Input` call, and rollback when a patching step throws.
- `node keyboard/sim/chord-test.mjs` (`PATCH=<file>` for another version): Steam+X with X released after the first-use
  card came up (no Backspace repeat once B closes it), a pad and X pressed on the settings panel and released while the
  keyboard was closed, X and B on the open panel staying in the panel, and a pad held on a suggestion chip while the
  keyboard closes (the same pad types after reopening). Pads, touch and typing must work at once.
- `node keyboard/sim/zoom-test.mjs`: `zoom: 1.5` on the keyboard root, once with legacy Chromium zoom (Desktop Mode's
  rects without zoom, standalone keyboard) and once standardized: touch taps and swipes, a pad swipe, trail, overlay,
  tip and settings panel placement, and closing the panel by pad and touch.
- `node keyboard/sim/inject-test.mjs`: the sim with a CDP port, patched by the real `inject.mjs` (250 ms cycle): user words
  loaded, written back and then acknowledged, the install date in the version line, typing-log append, ack,
  rotation (4000-byte limit in the test), Clear typing log and forgetAll deleting files, the lock file stopping a
  second injector, the HTTP discovery timeout against a silent port, and the words coming back after a "Steam
  restart".
- Benches in `keyboard/bench/`: `bench.mjs` (decoder on synthetic traces from the real key geometry,
  `geometry.json` from `keyboard/sim/dump-keys.mjs`), `bench-sentences.mjs` (`corpora/chat-corpus.txt` with context: swipe,
  phrases, autocorrect false and true fixes, next-word prediction), `bench-onepad.mjs`, `bench-modes.mjs`
  (pad taps with noise in mm on the Standard and Big letter keys maps, typed literally and through autocorrect). Results and the decisions taken from them are in
  [BAKEOFFS.md](BAKEOFFS.md); the traces and taps are simulated, not recorded on the deck.
