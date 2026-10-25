# Typing modes for the Steam Deck keyboard: research, design, results

Research note written while choosing the typing modes. Fast taps and Columns were removed in keyboard v30;
the sections describing them record what was tried, not the current code.

## 1. What the hardware gives us (read from Steam's `sp.js`, module 52077 and the input layer)

- Pads are absolute: `Gt` maps raw pad `[-1,1]` (times the `TrackPadTypingInputScale` setting) linearly onto a
  container 55 % of the keyboard wide (`TouchpadPointerContainer`, `left:0` / `right:0`, full height), then calls
  `OnLeftTrackpadAnalog` / `OnRightTrackpadAnalog` -> `OnTrackpadAnalogInternal(pad, side, active, x, y, ctrl)`.
  That method is a plain prototype method (the two callers are autobound), so wrapping it remaps both Steam's
  hover highlight and `pad.x/y`. The pointer dot is drawn by `Gt` from its own raw state, so a remap has to hide it
  (`.TouchpadPointer{opacity:0}`) and draw its own.
- Analog input reaching the UI: only `GAMEPAD_ANALOG_LEFT/RIGHT_KEYBOARD_CURSOR` (pads, x/y) and
  `GAMEPAD_ANALOG_SCROLL`. No stick analog, no pad pressure/force. Pad touch without click arrives as buttons
  `LPAD_TOUCH` 19 / `RPAD_TOUCH` 21 plus analog samples.
- Keyboard buttons: A types the focused key, X (`SECONDARY` 3) Backspace with repeat, Y (`OPTIONS` 4) Space,
  LT Shift (or click when "triggers as click"), RT Enter, LB/RB IME paging (ours: Ctrl/Alt), Start moves the window.
  Grips are dead while the keyboard is open (README). So every mode must live on the two pads plus X/Y/LT/RT.
- Geometry at 854x534 CSS px (`keyboard/bench/geometry.json`): a pad's 32.5 mm maps to 470 x 286 px, so a letter key is
  **4.2 x 5.3 mm on the pad**; the three letter rows take only 49 % of the pad height, and on the right pad only
  64 % of its width is letters (the rest is `[ ] \ ; ' Enter Backspace`).

## 2. Prior art (numbers as reported by the sources)

| Method | Speed / errors | Learning | Fit for Deck pads | With prediction |
|---|---|---|---|---|
| Single-stick selection keyboard (consoles) | 6.2 WPM [PizzaText related work] | none | what Steam does with the D-pad | completions help a little |
| Dual-joystick split QWERTY, Wilson & Agrawala CHI 2006 [1] | 7.1 WPM novices | low | same idea as Steam's split pads, but sticks are rate devices; pads are absolute and faster | yes |
| Sandnes & Aubert 2007, bimanual QWERTY on two sticks [2] | 6.75 WPM < 1 h | low | as above | yes |
| Daisywheel (Valve Big Picture 2012, removed ~2015) [3] | an academic touch-free Daisy Wheel: 6.75 WPM [4]; users liked it | moderate | needs stick directions; Deck sticks give only discrete dirs to the OSK; pads could emulate the petals but absolute pads already beat radial menus | weak |
| PizzaText, dual thumbsticks, circular layout (TVCG 2018) [5] | 8.59 WPM novices, 15.85 after 2 h | 2 h | the best stick method; pads with absolute position should beat it | slots for predictions |
| EdgeWrite on joystick (Wobbrock 2004) [6] | 6.4 WPM, 1.5x selection keyboard | unistroke alphabet | pads have edges, but gesture alphabets are slow to learn and slower than tapping | word completion only |
| Quikwriting (Perlin 1998), stylus [7] | 16 WPM after 20 sessions | high | | |
| MessagEase beginners [8] | 7.4 -> 11.0 WPM in 3 sessions (QWERTY 17.8) | high | | |
| T9 (Silfverberg et al. CHI 2000) [9] | predicted expert 41-46 WPM | low | ambiguous keys + dictionary: the idea behind "Columns" | the whole method |
| 1Line keyboard (Li et al. UIST 2011) [10]: QWERTY rows collapsed into 8 keys, row chosen by a decoder | 30.7 WPM after five 20-min sessions (iPad QWERTY 53.9); KLM expert 66-68 | shallow (QWERTY kept) | directly transferable: removes vertical aiming, the hardest axis on a pad | the decoder is the method |
| VelociTap (Vertanen et al. CHI 2015) [11]: decode whole noisy tap sequences | 41 WPM on a 40 mm watch keyboard at 3 % CER | none | the closest analogue: Deck letter keys are 4.2 mm, tiny like a watch | yes, LM-driven |
| BlindType (Lu et al. IMWUT 2017) [12]: eyes-free thumb typing on a handheld touchpad, statistical decoding | 17-23 WPM vs 7.66 cursor-based; tap SD 3.0 mm (x) / 3.7 mm (y); eyes-free "keys" 3.8 x 9.6 mm | none | exactly the Deck situation (thumb on an indirect pad, screen elsewhere); the 3 mm SD sets the bench noise | decoder required |
| Typing on an invisible keyboard (Zhu et al. CHI 2018) [13] | 37.9 WPM after 3 days vs 41.6 visible | 3 days | supports "don't aim, let the decoder fix it" | decoder |
| i'sFree (Zhu et al. CHI 2019) [14]: eyes-free gesture typing on a TV remote's touchpad | 23.3 WPM, 22.4 in the first 10 min | none | gesture typing on an indirect pad: what the existing swipe mode already does | |
| Bimanual gesture keyboard (Bi et al. UIST 2012) [15] | 26 WPM phrases, 39 expert (one-finger 30/46) | | already implemented (two-pad swipe) | |
| FanPad (IEEE VR 2024) [16]: QWERTY curved onto two VR controller touchpads | 19.7 WPM after 6 days, best 24.2 | days | same hardware class; curvature/overlap of pad halves matters | |
| Split two-handed VR controller keyboard (MacKenzie group, AHFE 2023) [17] | 15.2 WPM, 7.5 % faster than one-handed | | | |
| SwipeBoard (Chen et al. UIST 2014) [18]: two swipes per character | 19.6 WPM, experts 32.9 | moderate | two-stroke chords would fit pads, but they slow experts vs one tap per letter | |
| DualKey (CHI 2016), TiltType (UIST 2002) | finger identification / tilt + buttons | | no finger ID on pads; Deck gyro is not passed to the OSK | |
| Meta Quest: direct-touch swipe keyboard since v56 (2023) [19]; Windows Xbox-controller keyboard 2025: X = Backspace, Y = Space [20] | | | same button conventions Steam uses | |
| Steam Deck: dual-trackpad typing added 2022-04-06 [21]; Decky has speech-to-text [22] and a smaller-keyboard CSS theme; users ask for a visible split [23] | | | | |

Take-aways:

1. Stick/selection/radial methods (Daisywheel, PizzaText, EdgeWrite) top out at 6-16 WPM; absolute touchpads with
   QWERTY already beat them. Not worth building on the Deck.
2. The limit on the Deck pads is aiming precision: keys are 4.2 x 5.3 mm while unaided thumb taps scatter about
   3 mm (BlindType). People compensate by watching the pointer, which is slow. Every high-speed result above
   (VelociTap, invisible keyboard, BlindType, 1Line) removes the need to aim by decoding the whole word
   against a dictionary and language model. The engine already has that LM and learner, so the decoder is the
   lever.
3. Vertical precision is the worse axis (BlindType's y spread is larger and our letter band is only 49 % of
   the pad height). Either give the letter rows more of the pad or drop the row entirely (1Line).

## 3. Designs considered

| Idea | Verdict |
|---|---|
| Per-thumb magnified half keyboard (remap pad -> letters get more pad area) | **built as "Big letter keys"**, and used by the other two modes |
| Fuzzy statistical tap decoder (tap without aiming, decode on space) | **built as "Fast taps"** |
| T9/1Line-like grouped keys (only the column counts) | **built as "Columns"** |
| Pad-relative cursor with acceleration | rejected: relative pointing needs a visual loop per key (BlindType's cursor baseline: 7.66 WPM) |
| Daisywheel / radial on pads | rejected: 6-16 WPM in every study, new layout to learn |
| Chords / two-stroke (SwipeBoard) | rejected for now: two actions per letter; worth it only on watch-sized surfaces |
| Pressure / sticks | not available to the OSK (no analog stick or force messages reach it) |

## 4. What was built (`keyboard/src/modes.js`)

`globalThis.__oskModes = { version, order, modes: { standard, bigkeys, sloppy, columns }, sync, debug, geometry, decoder }`.

Hook API a mode may implement (all optional, called by patch.js with `(kb, ..., modeApi)`):

- `mapPad(kb, side, x, y, api) -> [x, y]`: remap a pad sample before Steam sees it (wraps `OnTrackpadAnalogInternal`).
- `onPad(kb, side, active, api)`: after each pad sample (overlay repaint).
- `keyAt(kb, x, y, api) -> element`: letter for a pad press that landed on a non-letter key.
- `onKey(kb, {key, ch, tap}, api) -> handled`: every typed key except toggles; `tap` = pad press point
  `{x, y, side}`, a touch point, or null (gamepad A).
- `pick(kb, i, api) -> handled`, `suggestions(kb, api) -> {items, current} | null`: own the suggestion row.
- `flush(kb, api)`: commit pending input (swipe start, touch outside, mode change). `reset()`: keyboard closed.
- `sync(kb | null, modeId, api)` (module level): mounts/unmounts the overlay canvas and pointer-hiding style.

`modeApi` (built in patch.js): `engine, keys, rect, spans, canCompose, caseFlags, applyCase, releaseShift, prev,
lastOut, sentenceEnd, notBlocked, setSuggestions, refresh, commitWord, sendText, backspace, req, classes, covered,
note`. `commitWord` sends via the one-character queue, applies auto-space, learns through `commitBuffer`
(rare decoded words are not learned unless picked, like swipes) and leaves Backspace-undo information.

### Big letter keys (`bigkeys`)
Piecewise-linear pad map: suggestion + number rows get the top 20 % of the pad, the letter rows 70 %, the space
row the bottom 10 %; left pad letters start at 7 % of its width, the right pad's letters fill 78 % (punctuation,
Enter and Backspace squeezed against the outer edge, where the pad's rim stops the thumb). Keys on the pad grow
from 4.2 x 5.3 mm to 4.5 x 7.6 mm (left) and 5.4 x 7.6 mm (right). Typing, swiping, suggestions unchanged.
Steam's pointer is hidden and redrawn at the mapped point; a dashed outline marks the letter block.
X = Backspace and Y = Space make the squeezed rows cheap to lose.

### Fast taps (`sloppy`)
Big-key map plus a VelociTap/BlindType-style decoder. Letter taps are held back (composition); each tap is stored
as its pad position in millimetres, the dictionary (`words.js` plus learned words) is scored per word with a 2-D
Gaussian per tap (sigma 2.2 mm in pad space, through the inverse map), one extra or one missing tap allowed
(cheaper for double letters), prior from the engine (`complete()` gives the engine's own context-aware prior:
frequency, learned counts, bigrams, LM). The suggestion row shows `[what you literally hit, best word,
next]`; Y/space commits the best word + space, a pick commits that word, X removes the last tap, `.`/`,`/Enter
commit and pass through, a swipe commits first, double space gives `. `, Backspace right after a commit restores the
literal taps. Tap points show as numbered dots; dots under the middle slot count the taps. Taps landing on Tab,
Caps, Shift, `;`, `[`, or the inner 40 % of the number row count as the nearest letter. Touchscreen and A-button
letters join the composition as exact letters.

### Columns (`columns`)
1Line on the pads: the left pad is the five QWERTY columns q-t, the right pad y-p, each a 6.2 mm stripe running
from the suggestion row to the space row (letter rows 79 % of the pad height, 87 % with the number row, which counts
as the top letter row here). Only the x position counts
(decoder uses column centres, sigma 2.0 mm, no y term). Same composition UI as Fast taps; the literal slot only
appears when most letters came from the touchscreen. Digits by touch or the symbols layout. Works with
"Right pad = whole keyboard" (then the right pad spans all ten columns).

## 5. Results

Engine-level benchmark `keyboard/bench/bench-modes.mjs` (chat corpus, 913 in-dictionary words, two seeds, previous word as
context; taps aimed at the key centre in pad millimetres with isotropic Gaussian noise; "off-letters" = a tap
landed on a non-letter key, counted as a failed word). Laptop timings. Simulated, not recorded on a Deck.

| tap noise sigma | standard taps | + autocorrect | big keys + autocorrect | Fast taps top-1 / in row | Columns top-1 / in row |
|---|---|---|---|---|---|
| 0.7 mm (careful) | 99.0 | 96.9 | 97.3 | 98.6 / 100 | 95.1 / 99.9 |
| 1.5 mm (quick) | 42.4 | 58.4 | 78.6 | 96.4 / 99.2 | 92.9 / 99.3 |
| 2.5 mm (sloppy) | 8.1 | 18.0 | 35.3 | 81.4 / 86.0 | 80.4 / 91.0 |
| 3.5 mm (eyes-free) | 2.6 | 6.4 | 14.1 | 53.1 / 61.3 | 59.5 / 72.5 |

Decode 1.1-1.3 ms mean, 2.1-3.2 ms p95. The decoder alone on Steam's standard map gives 91.7 % at 1.5 mm,
so of the 1.5 mm gain (42 -> 96 %) most comes from the decoder and the rest from the bigger keys.
lambda (prior weight) 0.8 was picked on seed 20261023 from {0.5, 0.8, 1.1, 1.4}.
Full output: `bench-modes.txt`.

Sim (`keyboard/sim/modes-test.mjs`, Steam's real keyboard, pads driven through `OnLeft/RightTrackpadAnalog` with raw pad
positions so the remap is exercised): 24/24 pass. Existing suites with the integration applied: `test.mjs` 20/20,
`swipe-test.mjs` 32/32, `settings-test.mjs` same 3 failures as without it (trail-off and two settings-restore
cases, failing on the current patch.js before integration).

Screenshots (`shots/`): `mode-bigkeys.png`, `mode-sloppy-composing.png`, `mode-columns-composing.png`,
`mode-settings-panel.png`.

## 6. Integration

`patch-integration.diff` (against patch.js v12 as of 2026-10-23 02:1x, plus inject.mjs and deploy.sh). It is
generated by `apply-integration.py <patch.js> <out> [<inject.mjs> <out> <deploy.sh> <out>]` from anchors, so
it can be regenerated when patch.js moves on. Changes:

- VERSION + 1; `DEFAULTS.mode = "standard"`; `CHOICES.mode` ("Typing mode": Standard / Big letter keys / Fast taps /
  Columns), which the settings panel renders as a cycling button; the panel hint shows the active mode's
  description.
- `setSetting("mode")` flushes the old mode, turns the suggestion row on for decoding modes, resyncs; `onePad`
  changes resync the map. `state.setMode(id)`, `state.modeApi`; `status()` adds `mode=`.
- Hooks: wrap `OnTrackpadAnalogInternal` (map + repaint; off while the settings panel is open); `TypeKeyInternal`
  calls `mode.onKey` after the settings-key check (pad tap point from `commitTaps`, touch point from touchstart);
  `refreshSuggestions` and `pickSuggestion` defer to the mode; `commitSwipe` and `onOutsidePointer` flush;
  pad presses on non-letters go through `mode.keyAt`; letter strokes are allowed in decoding modes even with
  swiping off; `tick` calls `__oskModes.sync`, `stop()` unmounts.
- inject.mjs loads `modes.js` (when its version differs) before patch.js; deploy.sh copies it.

Proposed README lines (for whoever merges): "**Typing modes** (settings panel, hold the emoji key → Typing mode):
Big letter keys, Fast taps, Columns; `modes.js`, injected before `patch.js`; `keyboard/sim/modes-test.mjs`,
`keyboard/bench/bench-modes.mjs`."

## Sources

1. Wilson, Agrawala. Text entry using a dual joystick game controller. CHI 2006. https://dl.acm.org/doi/10.1145/1124772.1124844 (7.1 WPM as cited in [5])
2. Sandnes, Aubert. Bimanual text entry using game controllers. Interacting with Computers 2007. https://academic.oup.com/iwc/article-abstract/19/2/140/693825
3. Steam Big Picture page, "Daisywheel is for controllers". https://store.steampowered.com/bigpicture/ ; removal: https://steamcommunity.com/groups/bigpicture/discussions/1/530646080853293836/
4. Implementation and evaluation of the Daisy Wheel for text entry on touch-free interfaces. https://www.researchgate.net/publication/331214691
5. Yu et al. PizzaText. IEEE TVCG 2018. https://xuwenge.github.io/pdf/18/PizzaText.pdf
6. Wobbrock et al. Joystick text entry with date stamp, selection keyboard, and EdgeWrite. CHI EA 2004. https://dl.acm.org/doi/pdf/10.1145/985921.986126
7. Isokoski, Raisamo. Quikwriting as a multi-device text entry method. NordiCHI 2004. https://dl.acm.org/doi/pdf/10.1145/1028014.1028031
8. Beginner's performance with MessagEase and QWERTY (Tampere thesis). https://trepo.tuni.fi/bitstream/handle/10024/84910/gradu06977.pdf
9. Silfverberg, MacKenzie, Korhonen. Predicting text entry speed on mobile phones. CHI 2000. https://www.yorku.ca/mack/chi00.html
10. Li, Guy, Yatani, Truong. The 1Line keyboard. UIST 2011. https://iis-lab.org/paper/UIST2011.pdf
11. Vertanen et al. VelociTap. CHI 2015. https://www.keithv.com/pub/velocitap/velocitap.pdf
12. Lu et al. BlindType. IMWUT 2017. https://dl.acm.org/doi/10.1145/3090083
13. Zhu et al. Typing on an invisible keyboard. CHI 2018. https://dl.acm.org/doi/10.1145/3173574.3174013
14. Zhu et al. i'sFree. CHI 2019. https://par.nsf.gov/servlets/purl/10093190
15. Bi, Chelba, Ouyang, Partridge, Zhai. Bimanual gesture keyboard. UIST 2012. https://www3.cs.stonybrook.edu/~xiaojun/pdf/bimanualgesturekeyboard.pdf
16. FanPad: a fan layout touchpad keyboard for text entry in VR. IEEE VR 2024. https://steve-strange.github.io/publications/fanpad/
17. Comparison of one-handed and two-handed text entry in VR using handheld controllers. AHFE 2023. https://www.yorku.ca/mack/ahfe2023.html
18. Chen, Grossman, Fitzmaurice. Swipeboard. UIST 2014. https://dl.acm.org/doi/10.1145/2642918.2647354
19. Meta Quest v56 swipe keyboard. https://mixed-news.com/en/hands-on-with-meta-quest-swipe-keyboard-and-other-v56-upgrades/
20. Windows 11 Xbox-controller keyboard (X backspace, Y space). https://lifehacker.com/tech/new-windows-11-xbox-controller-keyboard
21. Steam Deck client update 2022-04-06, "Added dual trackpad typing support". https://store.steampowered.com/news/app/1675200/view/3215014689176368943
22. decky-stt-keyboard. https://github.com/sebastianuxd/decky-stt-keyboard
23. Steam Deck feature request: split keyboard for trackpads. https://steamcommunity.com/app/1675200/discussions/2/5992658048676244394/
24. DualKey (CHI 2016) https://dl.acm.org/doi/10.1145/2858036.2858052 ; TiltType (UIST 2002) http://www.roywant.com/cv/papers/2002/2002-11%20(UIST02)%20Tilttype%20.pdf
