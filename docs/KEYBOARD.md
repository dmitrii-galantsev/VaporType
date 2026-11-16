# How the keyboard works

What `keyboard/src/` does inside Steam, the injector API and the simulator. User-facing docs are in the
[README](../README.md); measurements and the decisions taken from them in [BAKEOFFS.md](BAKEOFFS.md).

Users see the name **VaporType**; code and files keep the `osk` names. `patch.js` runs in Steam's `SharedJSContext`
and changes Steam's own keyboard (the gamepad UI module with `TypeKeyInternal`, in `steamui/sp.js`;
`steamui/virtualkeyboard.js` is a stale standalone copy). Its version is `VERSION` at the top of the file.

- **Swipe typing.** Hold a pad click on a letter, drag across the word and release. Each pad covers 55 % of the
  keyboard (Steam maps the left pad onto the left 55 %, the right pad onto the right 55 %), so a word that spans
  both halves is swiped with both thumbs: a press while a word is in progress, or within 220 ms (`JOIN_MS`) of its
  last release, continues it, and a press without movement adds that letter. Example "hello": right pad on h, left
  pad clicks e, right pad drags l to o. The decoder also scores a split into two words at every release gap and at
  every press that lands while the other pad is held, so two quick words on alternating pads, or two swipes pressed
  at once, stay two words in press order. A swipe is typed as soon as the last pad is released; if a press within
  220 ms then joins and the joined reading wins, the typed word is replaced with Backspaces (keeping the word on
  screen gets a 4-point bonus, `REWRITE_COST`). The decodes after a release run in slices of at most 8 ms
  (`SLICE_MS`); any key, press, pick, bumper or close in between finishes them first. The live preview in the
  suggestion row pauses while both pads are held. The touchscreen swipes the same way. The trail is blue for the
  left pad and orange for the right.
- **Steam's per-open input leak.** Each time Steam's keyboard opens it builds a new gamepad input source
  (`m_trackpadInput`) whose constructor registers `HandleControllerInputMessages` with
  `SteamClient.Input.RegisterForControllerInputMessages` and `RegisterForControllerAnalogInputMessages`,
  `HandleSystemKeyEvents` with `SteamClient.System.UI.RegisterForSystemKeyEvents`, and two controller-list
  notifications, and never unregisters them. Every pad sample then runs one more handler per open until Steam
  restarts, so two-pad typing gets slower the longer Steam runs. The patch wraps the three `Register…` calls
  (`INPUT_REGISTERS`) to keep the handles; after the keyboard's `componentWillUnmount` it unregisters that input
  source's handles and turns its `OnAnalogPad`, `OnButtonDown`, `OnButtonUp` and `OnSystemButtonPress` into no-ops
  (a keyboard mounted again gets them back). Handlers registered before the patch loaded stay until Steam restarts.
  The controller-list notifications are left alone; they run only when a controller connects or disconnects.
- **Zoomed windows.** Desktop Mode zooms the keyboard window's root 1.5x; `zoomOf()` measures whether rects
  include that zoom, so touches, the trail, the mode overlay, the tip and the panel line up with the screen.
- **Pad reach** (Input tab: Own half 55, the default; Past middle 75; Whole 100; Right only). `padSpan(side)` is the
  share of the keyboard's width a pad covers: reach / 100 for both pads, or with Right only 1 for the right pad and
  0.55 for the left. The patch sets Steam's pointer containers (`TouchpadPointerContainer.LeftTrackpad` /
  `RightTrackpad`) to that width, so Steam's x mapping follows, and so do the modes' pad maps, the decoder's per-pad
  reach (`ctx.pads`), the swipe gate and the cursor-slide distances. At 75 or 100 either thumb alone can swipe any
  word. Two pads stay more accurate than one ([BAKEOFFS.md](BAKEOFFS.md#one-thumb-on-the-right-pad)), which is why
  Own half is the default.
- **Full-width pad up/down** (Input tab, shown only while a pad covers the whole keyboard). Steam alone would stretch
  the 32.5 mm pad over the keyboard's full height too, so a thumb movement would go about 3x farther sideways than up
  or down. On a full-width pad `modes.js` remaps y (`isoY`): the y gain is the x gain over the letters divided by the
  setting (Balanced 2:1, the default; Even 1:1; Stretched 3:1, Steam's own), centred on the middle letter row and
  clamped at the keyboard's top and bottom. The overlay draws the pointer at the remapped place and Steam's pointer
  is hidden. Why 2:1: [BAKEOFFS.md](BAKEOFFS.md#one-thumb-vertical-mapping-v16).
- **Look and see-through** (Look tab). "Look" picks the colours (Modern rounded keys with gaps, the default; Steam's
  original; OLED black). Four sliders and the Glass choice (`SLIDERS` in `patch.js`; rows `s_` and `c_blur`, see
  Settings panel) set how much of the game shows through, each independently and in every look:

  | setting | slider | default | what |
  |---|---|---|---|
  | `boardAlpha` | Keyboard background | 100 | the board between the keys |
  | `keyAlpha` | Keys | 100 | letter keys; other keys get `keyAlpha - (100 - boardAlpha) / 10` |
  | `spaceAlpha` | Space bar | 30 | the space bar, also while it shows the typed text or "◂ cursor ▸" |
  | `stripAlpha` | Top strip | 100 | the typed-text field and suggestion row |
  | `blur` | Glass (segmented) | Off | Off / Light / Strong: a 6 / 16 px backdrop blur on the board only |

  The four alphas are 0-100 in steps of 5 (0 clear, 100 solid). They go to the page as CSS variables (`--osk-ba`,
  `--osk-ka`, `--osk-ma`, `--osk-sa`, `--osk-ra`) in a small stylesheet of their own (`osk-look-vars`, `lookVars()`);
  the look stylesheet (`osk-look-style`) only references them, so a change rewrites that one small sheet once and
  nothing else (while the settings panel is open, only when it closes; the panel's preview shows it meanwhile). Labels
  stay opaque; the space-bar label, the typed text shown in the space bar and "◂ cursor ▸" carry a dark text shadow and
  use the look's main text colour, and `look-test.mjs` asserts at least 4.5:1 for each at the defaults over black and
  mid-grey (6.8:1 or more). Steam's dark `BackgroundGlass` under the keyboard is cleared so the game shows through. Blur
  costs 4.5-5.3 ms per frame on the compositor thread in the simulator (software compositing, animated backdrop), so it
  is off by default; whether gamescope lets the overlay's backdrop filter see the game at all is unverified on the Deck.
  The keyboard is opaque by default; the space bar keeps 30, which on a solid board reads as a darker key with its label
  at full contrast. "Reset look" restores the look and all five to their defaults; saved settings keep their own values.
  Older saved settings carry `opacity` (100/90/80, 70 read as 80) instead: it becomes `boardAlpha = opacity - 50`
  (OLED + 30; 100 stays 100), `keyAlpha` the old letter-key alpha rounded to 5 (100), and `stripAlpha = max(90,
  opacity)`, so 80 % loads as 30 / 100 / 90 and the space bar takes the default 30. Only the default keyboard theme is
  restyled; a points-shop theme is left alone. One blue, `#0a74d6` (white text 4.69:1), fills the chip that space or
  punctuation will apply (autocorrect target) or the word just swiped, ON switches, locked Shift/Caps/Ctrl/Win/Alt and
  pressed keys; next-word predictions are never filled. Keys, chips and the typed-text field carry no outline, ring or
  edge; modifier keys are only slightly darker than letters. Letter labels are 20 px, modifier labels 14 px,
  Backspace/Enter/Shift show ⌫ ⏎ ⇧ next to Steam's controller glyphs (X, R2, L2; the glyphs are Steam's
  `/steaminputglyphs/*.svg`), Ctrl/Alt carry LB/RB badges while the bumpers hold them, shifted legends are lighter, and
  a hovered key in the Steam look is grey-blue instead of white. Arrow keys show Steam's own two glyphs (the small ▲/▼
  is what Shift turns them into). Pressed keys flash blue, the swipe trail fades from tail to head and out on release.
  Unverified on the deck: whether gamescope shows the game through the overlay's CSS alpha (Steam's own "Evolve"
  keyboard theme uses a translucent background, which suggests it does).
- **Typed text.** The suggestion row starts with a field showing the end of what this keyboard sent (the last 60
  characters, about 30 visible), with a caret, for when the keyboard covers the text box (Moonlight). It follows what
  goes out: taps, swiped words, suggestion picks, autocorrect, Backspace. Enter, closing or reopening the keyboard start
  an empty line; arrows, Tab, Esc, Ctrl/Win/Alt chords, Paste, a touch outside the keyboard and 30 s without typing
  start it with "…", since the field's content is then unknown. Longer text scrolls left behind a fade. The field is a
  light pill like the chips; a word autocorrect just changed is highlighted in it for 1.5 s, and a small badge just
  right of it (outside the text) shows the typing mode when it is not the default Big letter keys and "1-thumb" when Pad
  reach is Right pad only. The suggestion row is backed at the "Top strip" alpha (100 % by default) whatever the board
  alpha, so chat text barely shows through the field or the chips. The chips take the remaining 66 % of the row; key
  positions, the keyboard height and Steam's pad mapping do not change. With the suggestion row off it moves into the
  space bar. Hidden while the settings panel is open and in IME layouts; setting "Show typed text" (off by default). It
  cannot tell a password field, so it shows passwords as typed.
- **Cursor slide** (setting "Slide space bar to move cursor", on by default). Press and hold the space bar (pad
  click or touch) and slide sideways; each 0.5 key width sends one ArrowLeft/ArrowRight (0.25 when moving faster than
  1.5 key widths per 100 ms; on a pad covering more than its half the distances are in pad millimetres). The space bar
  reads "◂  cursor" or "cursor  ▸" while sliding. Released without sliding past 0.55 key widths it is a normal space,
  typed on release (a press on another key while it is held types the space first). Arrows go out through the output
  queue 45 ms apart, and at most 3 wait, so the cursor trails the thumb by at most about 135 ms: further steps are
  dropped and a step back cancels a waiting one. The slide finishes the current word, resets the word tracker and
  marks the typed-text field unknown. Off while Ctrl/Win/Alt/AltGr is active. The right pad cannot slide left of its
  own edge, so press farther right or use the left pad.
- **Auto space** (setting "Remove auto space before punctuation", on by default). The tracker flag `T.auto` is set
  when VaporType types a trailing space the user did not press: picking a completion, a prediction or "+ add". Any
  other key, a cursor slide, focus loss, closing the keyboard and the 30 s stale reset clear it; Shift, Caps Lock
  and the layout keys do not. Typing one of `. , ! ? : ; ) ] }` or Enter while it is set sends one Backspace through
  the output queue before the key. Quotes and `(` are left alone because they may open. A swiped word after `. , !
  ? : ;` gets its normal space ("hello. next"); after a pick it gets none, so there is never a second space. With
  Automatic word spacing on, a letter tapped right after a swiped word types a space first and starts a new word; a
  tapped punctuation mark attaches without one.
- **Enter** (setting "Enter closes keyboard", off by default). Steam closes the keyboard after Enter when it was
  opened with Steam+X or a game asked for "dismiss on Enter" (`VirtualKeyboardManager.SetDismissOnEnterKey`, read in
  `HandleVirtualKeyDown("Enter")` unless Shift is held). With the setting off the patch clears `m_bDismissOnEnter`
  before Steam handles Enter, so chat can go on line after line; B, Close or Steam+X still close. It sets the flag
  again when the setting is turned on, the keyboard closes or `stop()` runs (`dismissOnEnter`, `restoreDismiss`). A
  key that will close the keyboard (such an Enter, Close, Done) pressed with a pad or a trigger acting as one is held
  until every pad or trigger click pressed meanwhile comes up and its pad is untouched, or 250 ms after the click
  comes up while the thumb stays (`closesKeyboard`, `releaseCloseHold`). Steam hands the pads back to the game as the
  keyboard hides, and a click still held would reach the game (a mouse click on a pad set to mouse).
- **Taps vs swipes.** A press on a letter is a tap, typed on release in press order (rolled two-thumb typing stays
  in order), until the stroke is a deliberate drag. Released taps go out as soon as every earlier press is released.
  Taps followed within 220 ms by a swipe are folded into that word ("r" tapped, "ight" swiped = "right"). Presses on
  anything that is not a letter act on press, except a key that closes the keyboard (above). Swiping is off while
  Ctrl / Win / Alt / AltGr is active. Any other key pressed before a released swipe is typed (Y, X, RT, a touched key
  that is not a letter, LB / RB) types the word first (`settleSwipe`, which also finishes a sliced decode with
  `settleFinish`), so Enter never sends the line without its last word.
- **Closing right after a swipe.** Every swipe released before the keyboard closes is typed whole: `settleOnClose`
  finishes a sliced decode synchronously, decodes released strokes still waiting, then cancels the slice timer. The
  output queue keeps the items of those swipes and drops everything else (`keepWords`). A swipe still held when the
  keyboard closes types nothing.
- **Swipe threshold** (setting `deadzone`, Input tab: Small 80, Normal 100, the default, Large 130; `padMoved`). In
  key widths (median letter width, scaled by pad reach like the cursor slide), a pad press starts a swipe when it
  moves more than 1.1 keys within the last 120 ms, or more than 1.5 keys from where the thumb was 70 ms after the
  press (the press itself jolts the thumb). The setting multiplies both distances. Resting, rolling and creeping
  thumbs and the 0.8-1.1 key flicks of fast tapping stay taps; adjacent-key words ("we", "hi") are swiped through the
  second key and past it. The decoder still gets the stroke from its first point. The touchscreen uses a 0.55-key
  gate. Measurements: [BAKEOFFS.md](BAKEOFFS.md#swipe-deadzone).
- **Supported layouts.** `layoutSupported` (Steam layouts `qwerty` and `qwerty_int`, which the English dictionary
  fits) gates swipe, the suggestion row, autocorrect, learning, the typed-text field, the typing modes' pad remap and
  logging. Other layouts type exactly as stock Steam; the Esc key and Ctrl/Win/Alt stay.
- **Spacing and case.** A swiped word gets a space in front when it follows a word or `.,!?;:`; punctuation tapped
  after it attaches. Shift (key or held left trigger, any time during the swipe) capitalises it, Caps Lock upper-cases
  it.
- **Pad edges.** Steam maps each pad onto the whole keyboard element, so the top of a pad lands in the suggestion row
  and the very edges on the keyboard's border, where Steam's hover finds no key. Every pad sample outside the keys'
  interior (within half a key height of the outer keys' edges, or beyond them) snaps onto the nearest key; a chip
  counts only while it shows a word, so the typed-text field, empty chips and gaps press the number-row key below.
  The hover always shows the key a click presses. Pad x/y are also clamped onto the key area up to 80 px outside it
  (`EDGE_PX`), so an overshoot below the bottom row hits the row above (ValveSoftware/steam-for-linux#10683). Neither
  applies to unsupported layouts or while the settings panel is open.
- **Geometry while the keyboard slides in.** `keyBounds`, `letterKeys`, `zoomOf` and `modes.js` `geometryFor` are
  cached for 500 ms (zoom 1 s), but each entry stores the keyboard element's rect and is dropped when the live rect
  differs, and all are dropped when the keyboard shows or hides. Steam slides the keyboard in by animating its
  element's height for about 300 ms and maps pad x/y from the live rect, while the keys keep their final size. While
  the element's height differs from the keys' extent by more than 12 px (`SLIDE_TOL`) the pad y is re-expressed
  against the keys' extent (`keyExtent`, `slideY`). Without this, presses land a row low for up to 0.6 s after
  opening.
- **Suggestion row** above the number row, three chips, reachable by either pad, touch or gamepad. After a swipe the
  middle (blue) chip is the typed word and the sides are the next candidates; picking one replaces it. While tapping
  a word the middle and right chips are `engine.suggest`'s best two (completions and corrections, "lpl" -> "lol").
  The left chip shows a third candidate while the letters are a word in progress (at least two of the first three
  candidates extend them, "wh": who / what / when); otherwise it shows the typed letters, or "+ add lpl" for a new
  word. When autocorrect is on and will change the word on space, that correction is the middle chip, filled blue,
  and the left chip is the typed letters (`correct()` gets `final: true` only on space and punctuation). Picking types
  the word and a space. Right after an autocorrect the left chip is "↶ dont", which puts the typed word back (so does
  Backspace). Holding a chip blocks the word ("blocked: word · tap to undo", 3 s). After a space the chips offer next
  words; after Enter and when the keyboard opens, the words you start lines with (none until some are learned).
  Backspace right after a swipe deletes the whole word and its space.

  One word model ranks the row (`rowP` in `engine.js`): the probability of a word after the two previous words. Its
  base is the dictionary frequency mixed half and half with the word's share of the pair table (`rowChat`), then the
  pair table, then the word triples. The user's own typing sits on top as counts: a learned use weighs against 1,000
  words of that base (`rowAlpha`), a learned pair against 5 plus the number of different words typed after the first
  one (`rowBeta`, `rowBetaTypes`). A completion is ranked by that probability alone; a correction also pays its edit
  cost and a typo cost (`rowTypoCost` 2); a split into two words that are not a dictionary phrase pays
  `rowSplitCost` 3; one-letter words are not offered as corrections. Measurements:
  [BAKEOFFS.md](BAKEOFFS.md#one-word-model-for-the-suggestion-row-engine-v10-pairs-v6-keyboard-v37).
- **Learning.** A word finished with space, punctuation or the next swipe is counted, with its pair (previous word,
  word). `.`, `!` and `?` end the sentence: the next word has no previous word. A word ended by Enter is learned when
  the line already had a word; the only word of a line (nothing typed since the last Enter, open or reset) is never
  learned, so a password typed alone and submitted leaves nothing behind. A word left in the buffer when the keyboard
  closes, hides or stops is never learned. A new word is learned on its second tapped use in one Steam session. A swiped
  word under zipf 3.5 that the user has not typed before is not learned unless it was picked from the row. Only letters
  with an optional apostrophe, 2-24 long, are learned. The first word of a line is also stored as the pair `^ word`
  (line starts). Deleting a swiped word with Backspace counts against it. Steam cannot tell password fields apart, so a
  passphrase of ordinary words raises those words and pairs. The tracked word and previous word reset on an outside
  touch, after 30 s without typing, and on arrows, Tab, Esc, chords and paste, so Backspace-undo and picks never delete
  text where the caret has moved. Backspace right after the space or punctuation that ended a typed word takes the word
  back: what it learned (word, pair, line start, new-word count) is undone, its log record is dropped unless the host
  already took it, and the letters typed next continue it, so "comr", Backspace twice, "e" counts once as "come". Any
  other Backspace on an empty buffer takes one off the line's word count. `forget("word")` and `forgetAll()` remove
  learned data. Learned data lives in `user-words.json` (counts only, no timestamps; the previous version as `.bak`):
  under `~/homebrew/settings/vaportype/` with the plugin, beside `inject.mjs` with the standalone injector; Steam's
  `localStorage` (`oskSwipeUserWords`) is the fallback.
- **Typing modes** (`modes.js`, setting "Typing mode": Standard or Big letter keys). Big letter keys (the default):
  the three letter rows fill 70 % of each pad's height and the other rows move to the pad edges, so a letter is
  4.5-5.4 x 7.6 mm on the pad instead of 4.2 x 5.3; the overlay draws the pointer at the remapped position. Standard
  is Steam's mapping. A saved mode that no longer exists loads as Big letter keys. Prior art:
  [research/typing-modes.md](research/typing-modes.md); measurements: [BAKEOFFS.md](BAKEOFFS.md#typing-modes).
- **Autocorrect.** On space or punctuation a tapped word goes through `engine.correct`: keyboard-distance typos, tap
  positions (`ctx.taps`), missing apostrophes ("dont" -> "don't", "im" -> "I'm"), run-together words and phrases
  ("imdone" -> "I'm done"). It is applied only when `confident`; learned words, words with digits, ALL-CAPS and common
  real words without strong context are never changed. Backspace right after it restores what was typed.
- **Dictionary and word pairs.** `keyboard/data/words.js` and `keyboard/data/lm.js`, built by
  `keyboard/build/build_words.py` from wordfreq, the SCOWL word lists and the generated chat and web pair counts in
  `keyboard/data/inputs/` (`pip install wordfreq==3.1.1`; `OSK_*` variables select variants; the default build
  reproduces words.js byte for byte and lm.js up to the triples). `python3 keyboard/build/build_trigrams.py --merge`
  then appends 25,000 word triples (lines `a b c z10`, skipped by engines before v10) and sets the pair-table version
  to 6; it needs no wordfreq. Sources and licenses: [DATA-LICENSES.md](../keyboard/data/DATA-LICENSES.md).
- **Engine.** `keyboard/src/engine.js`: `createEngine(words, { lm })` with `decode`, `complete`, `suggest`,
  `predict`, `correct`, `learn`, `unlearn`, `forget`, `info`, `warm`, `warmStep`, `setUser`, `exportUser`.
  `warmStep()` builds one index, 200,000 characters of the pair table or one letter's completions per call; the patch
  creates the engine and runs these steps in idle callbacks after it loads, so the first keyboard open does none of
  it. `suggest` and `predict` take `ctx.prev` (up to two previous words) and `ctx.start` at the start of a line.
  `decode` and `correct` keep their own prior (dictionary frequency, the pair table with one previous word, a bonus
  per learned use), which the swipe and autocorrect gates are tuned on. `decode` splits the trace into one run per pad
  press (points tagged `L1`, `R2`, ... by `patch.js`), ignores a pad held still while the other works, splits the
  word's letters across the runs in order within each pad's reach (`ctx.pads`), and scores location (DTW), start/end
  keys, shape, length and word frequency, with a bonus for pauses or loops on double letters (bimanual approach of Bi
  et al., UIST 2012).
- **Esc, Ctrl, Win, Alt keys.** Esc goes left of the number row; Ctrl, Win and Alt go to the bottom-left corner, each as
  wide as a letter key (6.45 % of the row; why:
  [BAKEOFFS.md](BAKEOFFS.md#space-bar-width-with-the-win-key-keyboard-v34)). They use Steam's own `Control` / `Alt`
  toggle states, which the keyboard had but ignored on output, and a `Meta` state the patch adds to `s_keyToggleData`
  (restored on stop): a tap is one-shot (blue label), a double tap locks (blue key), a third tap turns it off, like
  Shift. Holding the key on the touchscreen also works. Win is for Windows hosts over Moonlight, which passes it on when
  it captures system keyboard shortcuts.
- **LB / RB** (Input tab: Ctrl / Alt, the default; Pick words; Off). In Steam's keyboard the bumpers only page IME
  candidates, unused in Latin layouts; in the emoji layouts they still switch categories.
  - Ctrl / Alt: LB holds Ctrl and RB holds Alt while the keyboard shows letters (the left trigger already holds
    Shift). Closing the keyboard forgets a bumper still held (its release may never arrive) and drops the held bit
    from Ctrl / Alt, so a reopened keyboard types plain keys; it also drops a pad hold on a chip or the emoji key.
    A press while words are still going out is sent after them; a tap released before that, or before Steam's
    keyboard state caught up with the press, still goes out once as a press and release, and never leaves the key
    held.
  - Pick words: a bumper press picks a chip as a click on it would (`pickByBumper`). RB takes the best chip and LB
    the other one (`PICK_SLOTS`): while tapping a word RB is the middle chip and LB the right one; after a space RB is
    the middle prediction and LB the left one; after a swipe RB is the left alternative and LB the right one; right
    after an autocorrect LB is the "↶" undo chip. Those chips carry RB and LB badges, never the literal, "+ add" or a
    notice; with no badge the press does nothing. A swipe still being decoded is typed first. The press and its
    release are kept from Steam, held repeats are ignored, and a tracker gone stale (30 s) is reset instead of picked
    from. Needs the suggestion row. Why: [BAKEOFFS.md](BAKEOFFS.md#typing-log-review-2026-10-30).
  - Off: the bumpers do nothing on the letters.
- **Output.** While Ctrl, Win or Alt is active, or for Esc, the key goes out as real key events through
  `SteamClient.Input.ControllerKeyboardSetKeyState(EHIDKeyboardKey, down)`, the call Steam's Paste key uses. Keys 0-99
  are USB HID usages; modifiers are LAlt 100, LShift 101, LWin 102, LControl 103, RShift 105. The real Ctrl/Win/Alt is
  held down while the toggle is active and released when it clears or the keyboard closes. It never goes down while
  plain text is still queued: the press waits behind that text, and a plain character or Backspace that finds
  Ctrl/Win/Alt down releases it first. Shift is added for Shift (key or left trigger) and shifted symbols; Tab uses
  Right Shift because Steam takes LShift+Tab. Plain typing and swiped words stay on Steam's text path
  (`VirtualKeyboardManager.HandleVirtualKeyDown` -> `ControllerKeyboardSendText`, gamescope IME), always one character
  per call: gamescope types a multi-character string on a temporary keymap over KEY_1, KEY_2, ..., and Moonlight
  forwards scancodes, so Windows would receive "123456". Both paths share the send marks in `OUT.at`: a key goes
  straight through when nothing is queued and its gaps have passed, otherwise it waits in the queue. The gaps: 30 ms
  between keys, 100 ms since the last press of the same physical key (`a`/`A` and `1`/`!` share a key), 100 ms after
  Backspace, Enter or another named key, 60 ms when Shift turns on or off, and 40 ms around a Ctrl/Win/Alt chord.
  Non-ASCII is not sent. Shift, Caps, Ctrl, Win, Alt and layout switches (`SwitchKeys_*`) are never queued: a key that
  has to wait is queued with its case already decided. Held Backspace (X, or a pad or touch held on the key) repeats
  every 100 ms instead of Steam's 200 ms (`s_longPressRepeatThreshold`, restored by `stop()`; Steam's 450 ms first delay
  stays); a repeat that finds a Backspace still queued is dropped, and the suggestion row refreshes 200 ms after the
  last repeat. Measurements: [BAKEOFFS-output.md](BAKEOFFS-output.md) and [BAKEOFFS.md](BAKEOFFS.md#on-a-real-deck-v22);
  source reading in [research/gamescope-ime.md](research/gamescope-ime.md) and
  [research/steam-text-path.md](research/steam-text-path.md).
- **Settings panel.** Holding the emoji key (550 ms) opens a panel over the keys, in the keyboard's own rectangle, at
  least `PANEL_MIN_H` (252 px) tall: with the suggestion row off the keyboard is shorter, so the panel grows upward
  and the pads' up/down range is stretched onto it (`panelPadY`). A short press still switches to emoji. The emoji key
  carries a gear badge and a ring that fills while it is held. Pad click, touchscreen and A on the gamepad-focused key
  all work. The frame is a tab bar of five tabs and a ✕, the body, and a footer naming what the buttons do on the
  focused row. Tabs and rows (`PANEL_TABS`, `PANEL_ROWS` in `patch.js`; each tab is a left and a right column):

  | tab | left column | right column |
  |---|---|---|
  | Typing | Keys: Typing mode (Standard / Big keys), Swipe typing, Suggestion row | Spelling: Autocorrect, Learn new words, Automatic word spacing, Remove auto space before punctuation |
  | Input | Pads: Pad reach (Own half / Past middle / Whole / Right only), Full-width pad up/down (Balanced / Even / Stretched; only while a pad covers 100 %), Swipe threshold (Small / Normal / Large) | Buttons: Slide space bar to move cursor, LB / RB (Ctrl / Alt / Pick words / Off), Enter closes keyboard |
  | Look | Style: Theme (Modern / Steam / OLED), Glass (Off / Light / Strong), Swipe trail, Show typed text, Reset look | Opacity: the live preview, Keyboard background, Keys, Space bar, Top strip |
  | Words | List (Learned (n) / Blocked (n)) across both columns, then 12 words a page with their count | |
  | System | Privacy: Private mode, Keep typing log, Clear typing log, Forget everything | Controls: Updates (plugin only), a help card for the pads and buttons, the version line |

  The two columns meet at the middle of the panel, where Steam splits the pads, so each thumb has its own column and
  both reach the tabs and the ✕. Row ids give the row type: `t_<setting>` a toggle (`TOGGLE_LABELS`), `s_<setting>`
  a slider (`SLIDERS`), `c_<setting>` a segmented row (`CHOICES`, or `GLASS` for `blur`), the actions `reset_look`,
  `clear_log` and `forget_all`, the list rows `w_0`..`w_11`, and the non-focusable `preview`, `version` and `help`.
  One entry in those tables adds a setting of that type; every write goes through `setSetting`, which saves it and
  repaints only the rows bound to that setting (`paintSetting`). Narrower than 600 px the columns stack and the page
  scrolls; narrower than 420 px the tab labels, descriptions and footer hints go.

  Pads. A pad pointing at a row rings it; pointing at a segment rings that segment and shows its description in place
  of the row's own, so a choice can be read before it is clicked. Steam keeps the last hit element while the pad stays
  inside its rectangle, so `panelPadNested` re-runs the hit-test on rows with segments. A pad click on a slider sets
  the value under it and drags it until that pad is released (a mouse does the same). Holding a pad near the top or
  bottom of a page that does not fit scrolls it.
  Behaviour. One focus ring (2 px #4aa8ff outline on a blue fill) marks the focused row, and opening the panel focuses
  the tab's first row, so the ring is always there; up / down move through the active tab (the tab, the left column,
  then the right column) and wrap; the page scrolls just enough to keep the focused row (and its section header)
  visible. A held stick or D-pad repeats after 350 ms at 8 per second on its own timer; Steam's `is_repeat` events
  are ignored. On the tab bar left / right switch tabs and A goes into the list; LB / RB switch tabs from anywhere
  (wrapping) and focus the new tab; LT / RT page the Words list (wrapping) and switch tabs elsewhere. On a row: A
  switches a toggle, steps a slider up (wrapping) or a segmented row to the next choice, and runs an action; left /
  right step a slider by `step` (holding repeats after 400 ms at about 12 per second until release or the end), move a
  segmented choice (stopping at the ends), and on any other row move the focus to the nearest row of the other column
  (`sideStep`). B cancels an armed Forget everything, otherwise closes the panel. X, Y and Backspace do nothing while
  it is open. Touch acts on release inside the same row and never when the drag scrolled the list; a horizontal drag
  on a slider sets it live; a pad click, touch or mouse click on a slider's track sets the value under it, on a segment
  picks it, and moves the focus to that row. Mouse and pad hover never move the focus. Words: A or a tap forgets a
  learned word or unblocks a blocked one and puts `Forgot "x" — A to undo` in the footer for 5 s with the focus on it
  (up / down go back to the list); the pager "‹ Page 1 / 4 ›" is tappable; the "Forget" on each word is dim until the
  row is pointed at or focused. Forget everything is armed by the first press (red, "Press again to forget", "B
  cancels · this cannot be undone", a 5 s countdown bar) and runs on a second press within 5 s. Clear typing log is
  greyed out while the log is off and nothing was written (`logFile`), and reads "Typing log cleared" for 5 s after
  it ran. A toggle that private mode or the unanswered first-use card holds off keeps its switch, dimmed, with "Paused
  while private mode is on" in amber as its description.

  Live preview. The Opacity column starts with a 36 px box as wide as the column: a blue-to-orange striped "game"
  gradient with a checkerboard band, and over it a small keyboard (suggestion strip, q w e ⌫, space bar) painted with
  the look's colours and the same `--osk-ba`, `--osk-ka`, `--osk-ma`, `--osk-sa`, `--osk-ra` values as the real
  keyboard (`lookValues()`), each set on the one element that uses it, plus the glass blur. While the panel is open it
  covers the keyboard, so look changes update the preview at once and reach the keyboard's stylesheets (`applyLook`)
  when the panel closes; rewriting those sheets restyles the whole document.

  Performance. The panel builds nothing until it opens. Each tab's DOM is built once (the open tab on open, the
  others one per 40 ms afterwards, laid out hidden and then kept with `content-visibility: hidden`), rows are kept in a
  map, and a change touches only its row: classes, inline transforms and text node data (replacing a text node re-runs
  Steam's `:has()` rules). Each page scrolls on its own, so a tab switch only swaps two classes. Tab icons are inline
  SVG (data-URL masks cost 20 ms of style on the first open). `node keyboard/sim/panel-perf.mjs` (`CPU=4` or `CPU=1`,
  `PATCH=<file>`) measures open, tab, toggle, Typing mode and slider steps; `perf-test.mjs` holds them to these budgets
  at 4x CPU: open <= 60 ms (first open included), tab switch and Typing mode p95 <= 16 ms, toggle and slider step p95
  <= 8 ms, no task over 16 ms during the steps (unless a V8 garbage collection of the engine's heap is most of it,
  listed as `gcTasks`), and an open idle panel <= 2 % CPU.

  The version line in System reads "VaporType vN · engine vN · words vN · pairs vN · modes vN · installed <date>"
  (`installed.json` beside the standalone injector; the plugin reports its own install date). Any hold (pad, touch,
  A) opens the panel with the focus on the first row. After first use is answered, a tip lists: hold the gear (the
  emoji key) for settings, hold and slide space to move the cursor, swipe words (setting `tipShown`); it goes away on
  the next key, pad or touch input, when the panel opens, or after 8 s. The gear is one SVG used on the emoji key, in
  the tip and on the first-use card.
- **First use.** The keyboard shows a card whenever it opens while `consent` is false: on a new install (no saved
  settings in `__oskUserWords.settings` or `localStorage`) and until the card is answered. Saved settings without a
  `consent` key (from before the card existed) count as answered. The card: "Learn the words you type? VaporType can
  remember new words and the words you often type together, to suggest them. They stay on this Deck." with Learn my
  words / Don't learn (pad, touch, D-pad and A), a gear hint and "B: later". The focus starts on Don't learn, so
  learning comes on only when the user moves to Learn my words and presses it. Learning is off by default and until the
  card is answered; the answer sets `learn` and is saved as `consent`. Switching Learn new words on in Settings is an
  answer too (it sets `consent`; switching it off does not). B or Close postpones it until the keyboard is next opened.
  Show typed text (`echo`) is an ordinary setting, off by default; saved settings with `consent: false` load it as off,
  because 0.2 installs saved it on before anyone answered (the cost: turned on while the card is still postponed, it is
  off again after the next load). Users who answered keep their settings. Pads, touch and mouse click the controls (they
  carry `data-key="OSKSet_*"`, so Steam's pad hit-test finds them); B, ✕ or hiding the keyboard closes the panel.
  Auto-repeats never repeat a tab or page step. A trigger the user has set to click the pad (Steam's trigger-as-click)
  still clicks the pad's pointer instead. Steam delivers the sticks (as D-pad directions), bumpers (5, 6) and triggers
  (7, 8) as digital `vgp_onbuttondown` / `vgp_onbuttonup` events, and thresholds the analog triggers itself, so no
  hysteresis is needed here. Pad clicks, triggers, bumpers and face buttons do nothing else while it is open, and never
  toggle Ctrl / Alt; the panel only takes the release of a press it took (bumpers and triggers included), so X still
  held from Steam+X when the card comes up reaches Steam on release and Steam's X Backspace repeat stops, and what the
  panel holds is cleared each time the keyboard opens. Settings are saved as `settings` in `user-words.json` (with the
  learned words) and in `localStorage` (`oskSwipeSettings`). Both copies carry `at`, the time of the last change
  (`setSetting`); on load the newer copy wins (the file when they tie or have no stamp), because the plugin writes the
  file at most every 60 s while the keyboard is open and a restart inside that window must not revert the change.
- **Tap positions.** Every tapped letter's position (pad x/y after Steam's mapping and the mode remap, or the touch
  point; CSS px like the key geometry) is kept beside the word buffer, one entry per character (null when unknown,
  e.g. gamepad A), and passed as `ctx.taps` to `engine.suggest` and `engine.correct`.
- **Typing log** (setting "Keep typing log", off by default). Per finished word: the swipe trace (points, pad tags,
  times) or the tap positions, the decoder's or the row's top candidates, the typed and the committed text, and the
  outcome: kept, picked, autocorrected, autocorrect undone, or deleted with Backspace (then with the word typed next).
  A tapped word also carries `erased`, the letters Backspace took out of it (with tap positions, at most 24), and a
  bumper pick carries `via` ("LB" or "RB"). A word record carries `how` (`space`, `punct`, `stop` for `.` `!` `?`,
  `swipe`, `enter`) and `prev`, the previous word the engine used. `env` records carry the versions and key settings
  and `geo` records the key geometry whenever it changes (none while the keyboard has no keys on screen; the benches
  skip the empty ones older logs have). Learning's privacy rule applies: the only word of a line is
  logged (`lone: true`) only if the engine already knows it, and a word left in the buffer at close is not logged.
  When Enter ends a line that wrote no `enter` record, a `{type: "line", t}` record marks the boundary, never twice
  in a row. The host appends to `typing-log.jsonl` (`~/homebrew/data/vaportype/` with the plugin, beside
  `user-words.json` with `inject.mjs`; rotated to `.1` at 5 MB), acknowledging each batch; Steam keeps at most 400
  unwritten lines. A typing log is private typing data: never commit one.
- **Private mode** (setting, off): no learning, no autocorrect, no typing log, no in-memory swipe log, and the
  typed-text field shows "Private mode · hold here to turn off". Hold the typed-text field 550 ms (touch) or use the
  panel switch. Entering and leaving it reset the word context, so a word typed in private mode never forms a pair
  with the next one. `forgetAll()` (Forget everything) also resets that context, clears the in-memory swipe log and
  the typing log and asks the host to delete `user-words.json.bak` and both log files.
- **Safety.** Before changing anything the patch checks the Steam calls and keyboard methods it uses
  (`SteamClient.Input` send calls, the layout module, `VirtualKeyboardManager.HandleVirtualKeyDown`, then on the first
  keyboard the methods in `KB_METHODS`); if one is missing, or a patching step throws, it rolls back to stock Steam and
  `status()` reads `vN unsupported Steam build: <what>`; re-injecting does not retry that build. Module scans back off
  from 30 s to 10 min. `stop()` cancels the output queue (queued work carries a generation number), restores every
  wrapped method and the pads' x/y properties, and releases held keys last. Closing the keyboard drops queued output
  except the letters of swipes already released.
- **API.** `window.__oskTrackpadFix`: `stop()` removes everything (layouts, prototype wraps, listeners, held keys,
  styles, trail, panel); `setSetting(name, value)` changes a setting; `openSettings()` / `closeSettings()` drive the
  panel; `status()` reports `vN layouts=N keyboard=patched|waiting swipe=on|off|no-engine mode=<id>`; `typeText(s)`
  sends text through the output queue; `idle()` is true when nothing is queued or pending; `keyboardOpen()` is true
  while a keyboard is showing; `forget(word)` and `forgetAll()` remove learned data. The host protocol is below.

The back grips cannot be used: while the keyboard is open Steam swaps the controller to its built-in Big Picture
config for app 769 (`controller_base/basicui_neptune.vdf`, log line "On Screen Keyboard Forcing to window type: KB
ActionSet, AppID 769"); the game's controller layout is inactive, the grips reach neither the keyboard nor the game,
and user configs for 769 are ignored.

## Host protocol and the standalone injector

A host (the Decky frontend, see [DECKY-NOTES.md](DECKY-NOTES.md), or `inject.mjs`) loads `swipe/words.js`,
`swipe/lm.js`, `swipe/engine.js` and `modes.js` when Steam lacks their version, hands Steam the saved user words once
per Steam start (`__oskUserWords`), evaluates `patch.js`, and then, each cycle, requests first:

- `takeRequests()` returns `{removeBackup?, clearLog?, rev}` (Clear typing log, Forget everything) and keeps
  offering it until `ackRequests(rev)`. A host announces that it acknowledges by setting `hostAcks = true` every
  cycle; after that a request is never dropped unacknowledged. A host that never announces has it cleared after three
  offers. Hosts acknowledge only when every deletion succeeded (a missing file counts as deleted).
- `takeUserWords()` returns the learned data and settings with `rev` and `forgetGen`, confirmed with
  `ackUserWords(rev)`; the patch keeps offering until confirmed. `forgetGen` goes up with every Forget everything:
  when it changed since the last save in this Steam session, the host writes without a backup and deletes `.bak`, and
  if it changes while a save is in flight the host handles the requests again and saves once more before
  acknowledging, so a forget always wins over a save.
- `takeTypingLog()` lines are appended and confirmed with `ackTypingLog`.

A host may also set `window.__oskHost.updates` before the panel opens: `status()` returns `{text, available}`,
`check()` and `install()` return promises. With it the System tab has one Updates row: its description is `text`, and
A checks for an update, or installs the available one (the plugin installs it once the keyboard is closed). Without it
there is no row; `inject.mjs` sets none.

A forget writes a tombstone first (`forget.json` beside `user-words.json` for `inject.mjs`, `plugin-settings.json` for
the plugin), listing `user-words.json`, `.bak`, `.tmp` and both log files, then deletes them. Paths that could not be
deleted stay pending and are retried every cycle; `user-words.json` and `.tmp` also leave the list when a save made
after the forget replaces them. The request is acknowledged only when nothing is pending, and a pending file is never
loaded, so a failed save after a forget cannot bring forgotten words back at the next Steam start.

`inject.mjs` re-evaluates `patch.js` every 5 s over CEF remote debugging (`CEF_PORT`, default 8080), so it survives
Steam restarts. One injector runs at a time (`inject.lock` holds its pid). HTTP discovery times out after 3 s and the
WebSocket open after 5 s; after failures it backs off up to 60 s. Overrides: `OSK_USER_WORDS`, `OSK_TYPING_LOG`,
`OSK_LOG_MAX`, `OSK_INSTALLED`, `OSK_LOCK`, `OSK_CYCLE_MS`, `OSK_HTTP_TIMEOUT_MS`. To run it without Decky: enable CEF
remote debugging in Steam, assemble a runtime folder with `node keyboard/runtime.mjs <dir>` (`patch.js`, `modes.js`,
`swipe/`, `inject.mjs`) and run `node <dir>/inject.mjs`, for example from a systemd user unit. Stopping the injector
and restarting Steam removes the patch.

## Simulator (`keyboard/sim/`)

Runs the deck's real Steam keyboard in headless Chromium without a deck: the steamui files (`scripts/fetch-steamui.sh`
copies them to `.steamui/`, or set `STEAMUI`) are served as `https://steamloopback.host/`,
`library.js`'s webpack runtime is kept but its app entry is replaced, the app module graph is initialised,
and Steam's `VirtualKeyboardContainer` renders with a real `VirtualKeyboardManager` and a mocked `SteamClient`
that records `ControllerKeyboardSendText` and `ControllerKeyboardSetKeyState`. Pads, triggers and bumpers are
driven with the same `vgp_onbuttondown/up` events Steam dispatches.

`keyboard/sim/test-all.sh` runs every suite in parallel (one Chromium each, `swipe-test` twice, plus
`keyboard/bench/gates.mjs`, and `test/plugin-sim.mjs` with `PLUGIN=1`, as `pnpm run test:sim` sets it), the two longest
(`twopad-test`, `settings-test`) first, then `perf-test` alone, since its millisecond budgets do not hold with eight
throttled Chromiums beside it, and prints pass/fail counts and seconds per suite; logs go to `$OUT` or a temp dir. Suite
names as arguments run only those (`bash keyboard/sim/test-all.sh menu-test perf-test`). The suites wait on conditions,
not fixed sleeps: `run.mjs` exports `inject(page, src)` (waits until the patch reports `keyboard=patched` or
unsupported), `settle(page)` (until `__oskTrackpadFix.idle()`, no new output for 40 ms and a frame; `join: false` skips
the 220 ms swipe-join window), and `waitKeyboard(page)` (after reopening: the keys exist and the space bar stopped
moving, since Steam slides the keyboard in). Only real holds (long-press 550 ms) and swipe pacing keep sleeps. Each
suite picks its own CDP port or none, so they run side by side. `run.mjs` serves Steam's controller glyphs from the
local Steam install (`GLYPHS`, default `$HOME/.local/share/Steam/controller_base/images/api/light`) so they do not show
as broken images.

Several suites take `PATCH=<file>` or `PATCH_SRC=<file>` to test another `patch.js`, and several `SHOTS=<dir>` for
screenshots.

- `node keyboard/sim/test.mjs`: first reproduces the stock bugs (a rolled space comes out before `h`), then checks
  what the Windows side would receive for rolled typing, overshoot, one-shot and locked Ctrl, chords (Alt+Tab,
  Win+Shift+S, Ctrl+Shift+T, Ctrl+Alt+Esc by mouse), Esc, LB/RB holds, bumpers and touched modifiers while `typeText`
  output is queued, symbols, Shift+Tab, release on close, reopen, `stop()` and re-inject. `PRE_PATCH=<old patch.js>`
  tests the upgrade path.
- `node keyboard/sim/swipe-test.mjs`: swipe typing end to end: one-pad and two-pad swipes, Right only, taps that stay
  taps, Backspace after a swipe, keys pressed 0-120 ms after a swipe, picks, completions, Shift, automatic space,
  punctuation, learning a new word, touchscreen, alternating words, tap-then-swipe, swipe off under Ctrl, reach 75 and
  100, and `takeUserWords()`. Every scenario fails on a multi-character SendText or the same physical key re-sent
  within 32 ms. `WITH_MODES=1` also loads `modes.js`.
- `node keyboard/sim/padedge-test.mjs`: pad edges through Steam's raw pad mapping in each mode, reach and full-width
  ratio, with the typed-text field or the suggestion row off: the hover and the press hit the same real key at every
  edge, and a word swiped off the top edge still decodes.
- `node keyboard/sim/open-bounds-test.mjs` (`MODES_SRC=<file>`): pad presses every 30 ms while the keyboard slides in,
  against stock Steam: once the space bar stops moving every press must hit the aimed key.
- `node keyboard/sim/twopad-test.mjs`: both pads at once (`twopad.mjs` drives them on an 8 ms tick; a resting thumb is a
  pad sampled with jitter and no press): simultaneous swipes, commit latency with the other thumb resting, alternating
  and rolled taps in order, joins and non-joins across the 220 ms window, closing 0-60 ms after a swipe, and bumpers or
  keys right after a two-pad swipe at 4x CPU (a held bumper, a 15 ms tap while the words still go out, and on-screen Win
  and Alt turned on and off again meanwhile, which send nothing). A `drive()` ends only after every delayed action it
  scheduled has fired. `twopad-bench.mjs` prints the table in [BAKEOFFS.md](BAKEOFFS.md#two-pads-at-once).
- `node keyboard/sim/leak-test.mjs` (`OPENS`, `SAMPLES`, `CPU`): opens and closes the keyboard 40 times with stock
  Steam and with the patch and counts the handlers registered with `RegisterForControllerAnalogInputMessages`: stock
  leaks one per open of each kind, patched stays at two, still drives both pads and restores everything on `stop()`.
  `mock.js` keeps the callbacks in `window.__steamRegs`.
- `node keyboard/sim/deadzone-test.mjs`: the swipe gate on timed pad samples: resting-thumb walks and rolls stay taps,
  seven accidental swipes logged on a Deck stay taps, fast short words still decode. `DEADZONE_BENCH=1` prints the
  bench in [BAKEOFFS.md](BAKEOFFS.md#swipe-deadzone) (`STOCK=1`, `DEADZONE=80|100|130`).
- `node keyboard/sim/settings-test.mjs`: the settings panel end to end: emoji tap vs hold, pad clicks on the panel not
  typing, every switch's effect, LB / RB choices, Pad reach and Full-width pad up/down, the Words lists, Forget
  everything, settings coming back from the file and from `localStorage` (the newer copy wins), the Look sliders and
  Glass, pad sweeps over every tab (every control reached, nothing outside hit, every page fits), and migration of old
  settings (`opacity`, removed modes, `onePad: true`).
- `node keyboard/sim/menu-test.mjs`: the panel's frame and rows, LB / RB / LT / RT tab and page steps, focus and its
  wrap, held-stick repeat, every row type by D-pad, A and click, no panel node replaced by a step, Words forget /
  undo, Forget everything arming and cancel, touch and hover rules, and which buttons reach Steam with the panel open
  or closed.
- `node keyboard/sim/latency.mjs` (`SETTINGS='{"reach":"right"}'`, `N`, `WITH_MODES=0`): pad tap and swipe latency
  through Steam's real pad mapping. `openSim({ backdrop: true })` / `SIM_BACKDROP=1` puts a fake chat page behind the
  keyboard.
- `node keyboard/sim/perf-test.mjs` (`CPU=4`): loading does not build the engine, the engine warms in short background
  steps, the first open does no engine work, an idle open keyboard requests no frames and changes no DOM, held X
  repeats Backspace at 10 per second without piling up, the settings panel stays within the `panel-perf.mjs` budgets,
  typing works with no animation frames, and stepping Typing mode runs no task over 16 ms. `perf-bench.mjs` (`CPU`,
  `FPS`, `STOCK=1`, `PROFILE=<file>`) prints [BAKEOFFS.md](BAKEOFFS.md#startup-idle-and-backspace).
- `node keyboard/sim/echo-test.mjs`: the typed-text field: geometry and raw pad mapping unchanged with it on, its
  area hits no key, pad taps, a swiped word, Backspace after a swipe and after a tap, suggestion picks, Enter,
  outside touch, arrows, Tab, Ctrl chord, Esc, 60-character tail, the 30 s gap, hidden under the panel, the switch,
  the space-bar fallback, keyboard reopen, `stop()`. `SHOTS=<dir>` saves screenshots.
- `node keyboard/sim/look-test.mjs`: computed styles per look: at the defaults the board is solid and the space bar
  (0.3) far more see-through than the keys (1.0); board, key, space-bar and top-strip alphas follow their own settings,
  0 and 100 give clear and solid; contrast of the space-bar label, "◂ cursor ▸", the typed text in the space bar and in
  the top strip (>= 4.5:1 over black and mid-grey); Glass blur Light / Strong / Off on the board; 60 slider changes
  rewrite the variables sheet 60 times and the look stylesheet never; no DOM changes while idle.
- `node keyboard/sim/autospace-test.mjs`: the exact output stream for the auto space: pick then `.` `,` `?` `!` `:` `;`
  `)` or Enter (one Backspace first), a swiped word after them (spaced once), a typed space / cursor move / Backspace /
  letter in between (space kept), the setting off, Standard, and a tapped letter after a swipe starting a new word. The
  simulator logs the unshifted key for Shift + key.
- `node keyboard/sim/modes-test.mjs`: the typing modes through Steam's raw pad mapping (Big letter keys is the default,
  Standard's number row, Big letter keys taps and swipes, Right pad only reaching the left letters), the panel
  selector, an old mode refused, and `stop()`.
- `node keyboard/sim/input-test.mjs`: with `modes.js` loaded: no overlay pixels while no pad is touched in Big letter
  keys, the Right pad only y/x gain through Steam's raw pad mapping (1:1, 2:1 in Standard and Big letter keys, 3:1) with
  the top and bottom rows reachable, Enter with Steam's dismiss flag set (setting off, then turned on: the flag comes
  back), space by pad and touch, cursor slides by pad (both ways, reversal, Right pad only) and touch, the word tracker
  reset, a fast 8-key slide that must drain within 160 ms of the last move, the setting off, rolled space then letter,
  and the "lpl" suggestion row and picks; Pick words: the RB / LB badges on "lpl", RB typing the middle chip (logged
  with `via: "RB"`, no Ctrl or Alt held), RB and LB after a space typing the middle and left predictions, LB typing the
  right chip, and after Enter no badge and nothing typed. Pad reach 55, 75 and 100 in Standard and Big letter keys:
  which keys each pad reaches at its far edge through the raw pad mapping.
- `node keyboard/sim/privacy-test.mjs` (pages run one after another; `PARALLEL=1` runs them together): private mode
  boundary ("hello" in private, "world" after: no pair, nothing logged or kept), a lone word ended by Enter or left at
  close not learned (known word, repeated password-like word), with the typing log on: lone known word logged with
  `lone`, lone unknown word and a word left at close not logged, the last word of a line logged with `prev` and learned
  with its pair (an unknown one on its second use), `.` logged as `stop` and breaking the pair, a word typed alone after
  a pause still a lone word, Backspace over the space or comma after a typed word taking the word back (one record and
  one learned use for the finished word, also after the log was flushed in between), no empty key geometry for a word
  logged after the keyboard closed, line markers written once and never doubled, and nothing logged or learned in
  private mode; forget requests pending until `ackRequests(rev)` with `forgetGen`, the French layout behaving like stock
  Steam, `hostAcks` keeping a forget through six unacknowledged takes while an unannounced host clears after three, the
  first-use card (only about learning, Don't learn focused and taken by A, Learn my words by D-pad and A, Show typed
  text off, existing users skip it and keep their settings, an unanswered 0.2 install loading Show typed text off, Learn
  new words switched on in Settings answering the card and switched off not), the VaporType version line (and no
  wordmark), and the typing log off by default with nothing typed kept and `keyboardOpen()` following the keyboard.
  `inject-test.mjs` adds a forget whose replacement save fails (`user-words.json.tmp` undeletable): not acknowledged, no
  forgotten word on disk or after a restart, finished once the fault clears; a forget kept pending through five failed
  deliveries (`.bak` made undeletable) and delivered once it can be deleted; and a forget during an in-flight save.
  `run.mjs`'s `inject()` answers the first-use card with Learn my words for every suite unless called with `{ consent:
  false }`, and `openSim()` waits until the keyboard has slid into view.
- `node keyboard/sim/ux-test.mjs`: look and flows: slide arrow by direction, gear badge size and backing, focus on the
  first control after a pad hold, no box-shadow or outline on any key, chip, panel control or the field, "added: word"
  after "+ add", tip closed by the panel and drawn with the gear, version line in System, Clear typing log greyed out,
  opaque suggestion row at 100/90/80 %, top strip following its own alpha, smaller L3 glyph on Caps, focus on the first
  control after an A-hold, the mode badge rule, the first-run tip (shown once, hidden by a key, flag saved), 'teh ' ->
  'the ' on space, autocorrect target filled while typing, the corrected word marked in the field and gone after 1.5 s,
  the ↶ undo chip and Backspace undo, the swiped word filled, hold-to-block notice and its undo, "+ add", the emoji
  badge and hold ring, the panel's five tabs/blue tab underline/single focus ring/label and description sizes/switch
  contrast/danger row, 20 px letters, 14 px modifiers, ⌫ ⏎ ⇧, the LB badge, locked Shift contrast, "◂ cursor ▸" while
  sliding, the mode badge and the Look tab's four sliders and Glass choice with no old opacity setting.
- `node keyboard/sim/robust-test.mjs` (four pages in one browser, in parallel): `ctx.taps` from pad and touch taps
  reaching `suggest`/`correct`; typing-log records (kept, autocorrect undone, picked, swipe deleted with the next word,
  an last word of a multi-word line logged with `how: "enter"` and `prev`), versions, settings, geometry, traces, tap
  positions and erased letters; log acknowledgement; private mode (no autocorrect, learning or log; the field's text)
  and its hold toggle by touch; the version line and new panel controls (no Updates row without a host); Clear typing
  log and forgetAll requests; closing the keyboard drops queued output (hidden right after the first character goes out,
  so exactly 1 of 26 arrives); `stop()` cancels output, restores the pads' properties and releases Ctrl last; preflight
  with a missing keyboard method and a missing `SteamClient.Input` call, and rollback when a patching step throws.
- `node keyboard/sim/chord-test.mjs` (`PATCH=<file>` for another version): Steam+X with X released after the first-use
  card came up (no Backspace repeat once B closes it), a pad and X pressed on the settings panel and released while the
  keyboard was closed, X and B on the open panel staying in the panel, and a pad held on a suggestion chip while the
  keyboard closes (the same pad types after reopening). Pads, touch and typing must work at once.
- `node keyboard/sim/zoom-test.mjs`: `zoom: 1.5` on the keyboard root, once with legacy Chromium zoom (Desktop Mode's
  rects without zoom, standalone keyboard) and once standardized: touch taps and swipes, a pad swipe, trail, overlay,
  tip and settings panel placement, and closing the panel by pad and touch.
- `node keyboard/sim/inject-test.mjs`: the sim with a CDP port, patched by the real `inject.mjs` (250 ms cycle): user
  words loaded, written back and acknowledged, the install date in the version line, typing-log append, ack and
  rotation, Clear typing log and Forget everything deleting files, the lock file, the HTTP discovery timeout, and the
  words coming back after a "Steam restart".
- Benches in `keyboard/bench/` run the engine on simulated traces and taps, not Deck recordings, except the log
  replays. `bench.mjs` (decoder on synthetic traces from the real key geometry, `geometry.json` from
  `keyboard/sim/dump-keys.mjs`), `bench-sentences.mjs` (`corpora/chat-corpus.txt` with context: swipe, phrases,
  autocorrect, next word), `bench-typos.mjs` (one typo per word, tap noise), `bench-onepad.mjs`, `bench-modes.mjs`
  (pad taps with noise in mm), `bench-vocab.mjs`. Log replays (`OSK_TYPING_LOG`, `OSK_LOG_SINCE`, `OSK_USER_WORDS`):
  `bench-log.mjs` (what picking and autocorrect saved or would have saved), `bench-predict.mjs` (next-word and
  completion hit rates with online learning; also `--text`), `bench-chips.mjs` (the row as `patch.js` builds it: the
  measure for any suggestion change), `bench-real.mjs` (a saved swipe log, `OSK_REAL_SWIPES`). `gates.mjs` holds the
  accuracy floors and row cases (`FLOORS`, `ROW_CASES`) that `pnpm test` enforces. Results and decisions:
  [BAKEOFFS.md](BAKEOFFS.md).
