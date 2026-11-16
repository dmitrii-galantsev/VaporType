# OSK bake-offs

Each decision, what was measured for it and why the alternatives lost. Numbers come from the simulator or the engine
benches in `keyboard/bench/` unless a section names a Deck run or a typing log. Engine, data and keyboard versions in
headings say which code a section measured; later sections supersede earlier ones where they say so.

## Swipe decoder weights

`keyboard/bench/bench-sentences.mjs` on `chat-corpus.txt` (357 lines; tune = 3 of 4 lines, held-out = every 4th),
previous word as context, four swipe noise models, plus `keyboard/bench/bench.mjs` (dictionary words, no context, a
rare-word column and a noiseless self-check that must stay ≥ 98 %). Mean sentence top-1:

| config (priorWeight, priorWeightHi, lmLambda, ctxWeight) | tune | held-out | bench.mjs rare-word top-1 | self-check |
|---|---|---|---|---|
| **0.2, 0.6, 0.8, 1** | 85.2 | 84.6 | 80.0 | 98.4 OK |
| 0.3, 0.9, 0.8, 2 | 86.7 | 86.4 | 73.0 | 97.5 FAIL |
| 0.5, 1.2, 0.8, 1.5 | 86.9 | 86.5 | | |

A stronger frequency prior wins on chat sentences, which are mostly common words, but loses 7 to 12 points on rare
words and fails the self-check, so the priors stayed. Context weight alone, over six seeds, per-mode top-1 [one pad,
two pads, sloppy one pad, sloppy two pads]:

| ctxWeight | tune | held-out |
|---|---|---|
| 1 | 92.1 94.2 78.4 75.7 | 92.6 95.8 78.6 75.6 |
| **2** | 92.3 94.8 79.4 76.8 | 93.2 96.0 79.3 77.0 |
| 2.5 | 92.2 94.9 79.6 77.0 | 93.4 96.3 79.7 77.3 |

ctxWeight 2 (engine v4) gains about a point on sloppy swipes and leaves bench.mjs unchanged. 2.5 measured slightly
higher, but the gain comes from a small corpus written for this project and a wrong previous word costs more as the
weight grows.

## Autocorrect thresholds

Sentence bench, tap part: clean words must never change (false-auto), lazy apostrophes ("dont"), noisy taps
(auto-fixed vs made wrong), run-together words ("imdone"), plus 3,000 dictionary words typed correctly and 40 game
and app names that must survive. Grid: confMargin {2, 3, 4} × confMaxCost {5, 6, 7.5} × corrCtxWeight {0.5, 1, 1.5} ×
knownApoMargin {2, 3, 4}.

| confMargin, confMaxCost | noisy fixed tune / held | made wrong tune / held | run-together tune / held | names changed |
|---|---|---|---|---|
| 2, 7.5 | 50.8 / 53.2 | 6.1 / 8.5 | 84 / 92 | 2/40 (overwatch, warzone) |
| 3, 7.5 | 45.7 / 46.8 | 6.1 / 6.4 | 82 / 87 | 1/40 |
| **3, 6** | 44.7 / 44.7 | 5.8 / 6.4 | 82 / 87 | 1/40 (warzone) |
| 4, 6 | 40.8 / 42.6 | 4.2 / 6.4 | 75 / 79 | 0/40 |

Every config kept false-auto at 0 on 913 clean words and 3,000 dictionary words; knownApoMargin made no difference.
Looser settings fix more typos but change more names and make more wrong corrections; tighter ones lose the
run-together fixes, which were asked for. 3, 6 stays.

## Dictionary and word-pair table size

Variants built with `build_words.py` overrides (`OSK_MIN_ZIPF_LONG`, `OSK_MAX_BIGRAMS`, `OSK_MAX_PHRASES`). The chat
corpus has no rare words, so vocabulary was also measured on 2,500 tokens drawn from wordfreq by frequency and 800
words of zipf 2.3 to 3.5 (engine before the ctxWeight change):

| variant | entries | sentence swipe tune / held | run-together tune / held | frequency-drawn in vocab / top-1 | rarer words in vocab / top-1 |
|---|---|---|---|---|---|
| **base** | 44,498 | 85.9 / 84.3 | 82 / 87 | 97.0 / 89.1 | 55.5 / 37.4 |
| zipf ≥ 2.0 | 52,881 | 85.8 / 84.3 | 82 / 87 | 97.2 / 88.7 | 55.5 / 37.4 |
| zipf ≥ 2.7 | 33,830 | 85.9 / 84.3 | 82 / 87 | 96.7 / 88.1 | 39.3 / 31.0 |
| zipf ≥ 3.0 | 26,331 | 85.9 / 84.4 | 82 / 88 | 95.8 / 88.8 | 22.5 / 18.3 |
| 300k pairs (lm.js 2×) | 44,498 | 86.0 / 84.3 | 83 / 89 | | |
| no pair table | 44,498 | 85.0 / 83.4 | 78 / 79 | | |

Smaller vocabularies lose rarer words without gaining on common ones; the larger one adds words below zipf 2.0 and
costs 0.4 on common tokens. 300k pairs gains one or two run-together fixes for twice the file, which the Deck loads
at every Steam start.

## Output path: how characters reach Moonlight

Full write-up: [BAKEOFFS-output.md](BAKEOFFS-output.md). A headless gamescope 3.16.31 ran an SDL2 X11 key logger and
the Windows-side text was rebuilt from scancodes the way moonlight-qt does; text went in through gamescope's
input-method protocol (the `ControllerKeyboardSendText` path), XTest and libei, about 2,100 trials.

| strategy | exact strings |
|---|---|
| whole word per SendText | 0/105 (digits) |
| one char per call, 0 ms gap | 3–7/35 |
| one char per call, repeat gap < 30 ms | 10/35 (doubled letters lost) |
| one char per call, gap ≥ 1 ms, repeat gap ≥ 32 ms | 35/35 |
| repeat gap keyed by character, case flips (`aAAa`) | 0/10 |
| repeat gap keyed by physical key | 10/10 |
| key events with Shift (XTest/libei) | 35/35 |
| key-event letters mixed with SendText punctuation at 12–20 ms | 10/35 (Shift leaks) |

Taken: one character per SendText, the repeat gap keyed by physical key (`aA`, `Ss`, `1!`, `;:` lost their second
character before), and Ctrl/Alt chords through the same queue with 40 ms on either side so Shift cannot leak. The
harness's 12 / 45 ms gaps were too short on a Deck (below). `swipe-test.mjs` fails any SendText of more than one
character and any same-key resend under 32 ms.

### On a real Deck (v22)

The harness timings lost text on a Deck streaming to Windows Notepad over Moonlight: picking a suggestion for a tapped
word turned "testing" into "ttesing". Measured there with a script that types five sentences and ten word
replacements, the Notepad text read back through UI Automation and diffed:

| timing | errors / chars |
|---|---|
| 12 ms between keys, 45 ms before an immediate repeat (v21) | 35 / 928 |
| 12 ms, 100 ms since the same key's last press, 100 ms after a named key, 60 ms around Shift changes | 3 / 928 |
| same, 18 ms between keys | 7 / 1233 |
| same, 25 ms between keys | 0 / 2161 |
| same, 35 ms between keys | 0 / 1233 |
| 25 ms, but 70 ms since the same key | 1 / 1233 |

Backspaces alone, 4 per run: 45 ms apart lost one in 9 of 30 runs, 90 ms apart 0 of 30. A key pressed again 26 ms
after itself with another key between (`keeper`) lost the second press: gamescope holds each key until the next one or
30 ms, and SDL's X11 backend treats a release followed by a press of the same keycode as auto-repeat, which Moonlight
drops. Raw key events (`ControllerKeyboardSetKeyState`) were worse (lost Shift, repeated Enter). Taken: 30 ms between
keys, 100 ms since the same physical key, 100 ms after a named key, 60 ms around Shift changes.

## Swipe deadzone

Complaint: thumbs resting or rolling on a pad while aiming a click started swipes by accident, and seven strokes in
the Deck's log split words while tapping ("m" + "aybe", "st" + "asck", "tha" + "ts"). The old gate started a swipe once
a press moved 0.55 key from its first point. Steam's own keyboard has no such gate (0 swipes in 80 drifts in the
simulator), so every accidental swipe was the patch's.

`keyboard/sim/deadzone-test.mjs` (`DEADZONE_BENCH=1`, through Steam's raw pad mapping, 120 drifts per corpus,
seeded): "walk" is a random walk of 0.6-1.2 keys over 300-800 ms with a touch-down jolt, "roll" the same with a
smoothstep profile, "Deck 7" the seven logged accidental strokes replayed or synthesized in three speed profiles (17
strokes). Short words are 12 words swiped through the last key at 6, 10 and 16 keys/s. "Real Deck strokes" replays
the 26 pad strokes of 39 logged Deck swipes through the gate offline.

| gate | walk | roll | Deck 7 (17 strokes) | short words 6 / 10 / 16 keys/s | real Deck strokes started |
|---|---|---|---|---|---|
| old: 0.55 key from the first point | 104 / 120 | 104 / 120 | 17 / 17 | 12 / 12 / 12 | 22 / 26 |
| Small (x0.8) | 3 / 120 | 11 / 120 | 1 / 17 | 12 / 12 / 12 | |
| **Normal (1.1 key in 120 ms or 1.5 keys from the 70 ms point)** | **0 / 120** | **1 / 120** | **0 / 17** | **11 / 12 / 12** | **20 / 26** |
| Large (x1.3) | 0 / 120 | 0 / 120 | 0 / 17 | 9 / 10 / 11 | |

Smaller gates were tried first: 0.7 key in 120 ms or 1.3 keys still started 2 / 120 walks and 8 / 120 rolls, because
the logged accidental strokes are 0.8-1.1 keys in 130-175 ms, faster than any resting drift. Of the real strokes,
four never start under any gate (single-key holds of two-pad words) and Normal loses two more: "as" (0.82 key, the
same shape as the accidental "as" strokes, so no gate on the stroke alone separates them) and a deleted drift.
Started strokes begin a median 23 ms later than under the old gate. The decoder still gets the whole stroke, so the
engine gates are unaffected. The cost of Normal is slow adjacent-key hops ("we" at 6 keys/s is a tap of "w").
Decision: Normal by default, with the "Swipe threshold" setting (Small / Normal / Large, key `deadzone`) multiplying
the distances. The touchscreen keeps its 0.55-key gate: there is no resting thumb on glass.

## One thumb on the right pad

`keyboard/bench/bench-onepad.mjs`: the thumb misses by the same distance in mm as with two pads, so with one 32.5 mm
pad spread over the whole keyboard the sideways error is 1.82× larger in key units.

| mode | top-1 tune / held-out |
|---|---|
| two pads, overlapping | 92.5 / 91.6 |
| one pad over half the keyboard | 86.8 / 87.2 |
| one thumb over the whole keyboard | 67.9 / 69.5 |
| one thumb, sloppy | 35.1 / 40.0 |

It stays a setting, off by default: Pad reach "Right only".

### One-thumb vertical mapping (v16)

With one thumb the pad's 32.5 mm width covers the 854 px keyboard (26.3 px/mm) but its height still covers only the
286 px keyboard height (8.8 px/mm), so the same thumb movement goes 3x farther sideways than up or down. A fully even
mapping leaves 1.8 mm of pad per row. Words swiped in pad millimetres with `bench-onepad.mjs` noise, mapped with each
y gain (engine v4/v5). "Absolute" aims at each key's real pad position; "half-adapted" plans vertical moves halfway
between the true gain and the sideways gain, standing in for a user who expects the same movement both ways. Top-1,
tune / held-out:

| y/x gain ratio | row height on pad | absolute, normal | absolute, sloppy | half-adapted, normal | half-adapted, sloppy |
|---|---|---|---|---|---|
| 3:1 (Steam) | 5.3 mm | 67.9 / 69.5 | 35.1 / 40.0 | 48.8 / 44.2 | 23.2 / 23.5 |
| **2:1** | 3.6 mm | 57.0 / 57.7 | 29.3 / 27.2 | 46.5 / 45.3 | 22.3 / 20.7 |
| 1.5:1 | 2.7 mm | 50.2 / 47.5 | 21.4 / 22.3 | 44.6 / 40.5 | 18.8 / 20.7 |
| 1:1 (even) | 1.8 mm | 34.4 / 36.3 | 13.9 / 12.6 | 34.4 / 36.3 | 13.9 / 12.6 |

Every step towards an even mapping costs accuracy, because the pad's height is the scarce direction. For a thumb that
expects equal movement 2:1 is within 2 points of 3:1, while 1:1 stays 10 to 35 points behind. Decision: 2:1 by
default ("Balanced"), 1:1 for whoever wants the same movement both ways, 3:1 is Steam's. The model of what users
expect is a guess; neither model measures how it feels in the hand.

## Typing modes

`keyboard/bench/bench-modes.mjs`: 913 chat-corpus words tapped on the pads with Gaussian noise in pad millimetres, two
seeds, previous word as context. Percent of words that end up typed right (Fast taps and Columns: decoder top-1):

| tap noise | Standard, plain taps | Standard + autocorrect | Big letter keys + autocorrect | Fast taps | Columns |
|---|---|---|---|---|---|
| 0.7 mm | 99.0 | 96.9 | 97.3 | 98.6 | 95.1 |
| 1.5 mm | 42.4 | 58.4 | 78.6 | 96.4 | 92.9 |
| 2.5 mm | 8.1 | 18.0 | 35.3 | 81.4 | 80.4 |
| 3.5 mm | 2.6 | 6.4 | 14.1 | 53.1 | 59.5 |

Fast taps (a VelociTap-style decoder over held-back taps) was the most accurate but held letters back until the word
was committed, and Columns typed dictionary words only; both were removed in keyboard v30 (modes.js v7), and
`bench-modes.mjs` now measures Standard and Big letter keys only. Big letter keys keeps every letter appearing as it
is tapped, works for names and passwords, and gains 20 points at 1.5 mm, so it is the default. Big letter keys' dashed
outline around the letter rows was dropped in v16: the pointer dot already shows where a pad lands.

## Responsiveness

Cursor slide (`keyboard/sim/input-test.mjs`): a slide of 8 key widths in 160 ms left the output queue empty 114 ms
after the last pad sample; at most 3 arrows wait (45 ms apart), later steps are dropped.

### Startup, idle and Backspace

Complaint: the keyboard lags when first opened, and Backspace is slow. `keyboard/sim/perf-bench.mjs` with CPU
throttling (the Deck's Steam UI runs on one slow core), median of 5 runs; "long tasks" is main-thread time in tasks
over 50 ms. Stock is Steam's keyboard without the patch, before is v24 (0.2.1).

| 6x CPU (4x CPU, rAF at 15 fps) | stock | before | after |
|---|---|---|---|
| `patch.js` evaluation (plugin load) | | 374 (226) ms | 67 (45) ms |
| background tasks in the 3 s after load, longest | | 0 | 467 / 287 (173 / 173) ms |
| first open: long tasks / longest task | 120 / 120 (74 / 74) ms | 1168 / 913 (567 / 484) ms | 377 / 143 (223 / 90) ms |
| open and untouched, 3 s: animation frames / DOM changes | 0 / 0 | 12 / 24 | 0 / 0 |
| X held 1.5 s: Backspaces sent | 7 | 7 | 12 |

The first open used to spend 728 ms warming the engine in one tick (parsing the pair table 359 ms, the first decode,
completions, correction) plus a second render of the whole keyboard forced by the patch. Now the engine is built in
an idle callback after load and warmed in short steps (`warmStep`), the warm-up that needs the keyboard's geometry
waits while anything is typed, and a keyboard that already rendered VaporType's layout is not rendered again. While
open and untouched the patch used to rewrite two classes and repaint the mode overlay 4 times a second; both now write
only on change. Nothing in gesture, hold or output timing counts frames.

Backspace: Steam repeats a held X after 450 ms and then every 200 ms. The repeat is now 100 ms, equal to the same-key
gap from the Moonlight measurement, so held Backspace runs at 10 per second with the same spacing on the wire. A
repeat that finds a Backspace still queued is dropped (before, holding X behind ten queued letters went on deleting 5
times after release), and the suggestion row refreshes 200 ms after the last repeat. Picking a suggestion or deleting
a swiped word still sends one Backspace per character, 100 ms apart ("testing " is 0.8 s). Ctrl+Backspace as one
chord would take 40 ms, but chords go out as raw key events, which lost Shift and repeated Enter over Moonlight, and
not every target deletes a word on it; not done.

### Two pads at once

Complaint (0.2.3, keyboard v26): typing is much slower with both trackpads in use. On a Deck (90 Hz), a pad sample cost
p50 0.5-0.6 / p95 1.6 ms and frames stayed at 11.1 ms; commit latency was the problem: release to first letter 111 ms
with one pad, 222 ms whenever the other pad was being sampled, and two swipes pressed at once typed nothing in 8 of 8
runs.

Cause, read in Steam's code: the swipe finished 60 ms after release only once neither pad's `active` flag was set,
else at 220 ms. Steam sets `active` on every sample and clears it 100 ms after the last one, so a resting thumb on
either pad (the normal grip) always cost the full 220 ms. A press while the other pad was held was never a split point,
so two different words swiped together decoded as one word, found nothing and were dropped. Overlapping rolled taps
all waited until both pads were up.

Fix: the swipe finishes as soon as the last pad is released, and a press within 220 ms of that release is merged back
(Backspaces only if the joined word wins, `REWRITE_COST` 4); a press while the other pad is held is a split point too;
released taps go out once every earlier press is released; the decodes after a release run in slices of at most 8 ms,
and the live preview pauses while both pads are held (its decode of two strokes in flight was a 25 ms task, 123 ms at
4x). Of the four multi-stroke swipes in the Deck's swipe log, the three with a two-word reading still decode jointly
with a margin of 12.6 to 14.8.

`keyboard/sim/twopad-bench.mjs` (`N=10`, 3 s cases 5 runs; taps 4 runs of 16), v26 against the fix, p50 / p95. "Pad
task" is the longest of the patch's handler calls. Case 1b (3 s, one pad) is the CPU reference for case 3.

| case (1x CPU) | pad task | release → first SendText | CPU per gesture | words |
|---|---|---|---|---|
| 1 one pad swipe | 4.7 → 5.9 ms | 126 / 141 → 7.5 / 13.3 ms | 94 → 91 ms | 10/10 → 10/10 |
| 2 one pad, other thumb resting | 1.8 → 1.6 ms | 221 / 224 → 5.7 / 7.5 ms | 149 → 122 ms | 10/10 → 10/10 |
| 1b one pad, 3 s | 1.7 → 2.1 ms | 127 / 141 → 6.2 / 7.2 ms | 429 → 400 ms | 5/5 → 5/5 |
| 3 both pads swiping 3 s, two words | 24.9 → 7.0 ms | nothing typed → 12.5 / 14.0 ms | 569 → 530 ms | 0/5 → 5/5 |
| 4a alternating taps 8/s | 9.4 → 8.3 ms | 0.1 / 0.2 → 0.1 / 0.2 ms | 677 → 593 ms | 4/4 → 4/4 |
| 5 both thumbs resting, swipe on one | 2.9 → 1.7 ms | 221 / 222 → 6.3 / 7.7 ms | 152 → 117 ms | 10/10 → 10/10 |

Rolled taps with overlapping holds (12/s, 110 ms each): the latest letter came 1584 ms after its release before, 0 ms
after. At 4x CPU release → first SendText dropped from 147-231 ms to 32-66 ms in every case, and case 3 went from
nothing typed to 3/3. With both pads hovering Steam's own pointer callback forces one layout per sample, with and
without the patch; caching the mode overlay's chip rectangle and skipping unchanged trail writes changed neither the
layout count nor CPU time, so neither was kept.

### Slower the longer Steam runs (v29)

Complaint (0.2.5): typing with both pads still slowed to a crawl after the fix above; Steam had been running for 41
hours. Cause, read in `steamui/sp.js`: each keyboard open constructs a new input source that registers with
`RegisterForControllerInputMessages`, `RegisterForControllerAnalogInputMessages` and `RegisterForSystemKeyEvents` and
drops the handles, so the handlers pile up for the life of the Steam process and every pad sample runs all of them.
This matches the public report "Virtual keyboard performance degrades dramatically at some point" (Steam Controller
bug forum, 2026-10-22): it scales with keyboard opens since Steam started, dual-pad typing degrades first, and a Steam
restart fixes it. Nothing else grows per open in the simulator.

`keyboard/sim/leak-test.mjs`, `CPU=4`, 2000 alternating samples sent to every registered analog handler, µs per sample
on a fresh keyboard → after the opens:

| opens | stock: handlers | stock: µs per sample | patched: handlers | patched: µs per sample |
|---|---|---|---|---|
| 40 | 41 | 55-59 → 69-121 | 2 | 60-80 → 60 |
| 200 | 201 | 55-63 → 131-137 | 2 | 67-71 → 57-59 |

The simulator measures only the JavaScript side; in Steam each registration is also a separate call from the client
into the page per sample, not measured on the Deck. Fix in [KEYBOARD.md](KEYBOARD.md): the patch keeps the handles
and unregisters them when the keyboard unmounts.

## Design

Looks (Modern, Steam, OLED) and the typed-text field were compared on screenshots in the simulator with a fake chat
page behind the keyboard (`openSim({ backdrop: true })`), plus a one-off bench that measured the mean luminance change
inside the letter-key faces (labels getting dirty) and on the rest of the keyboard (how much shows through) with the
backdrop shown and hidden. One alpha applied to everything dirtied the labels; letter faces, other keys and the board
now each have their own alpha (the Look sliders in [KEYBOARD.md](KEYBOARD.md)).

Look. Modern (rounded keys with gaps, pill chips, the picked word filled blue) separates letters from modifiers best
on the screenshots and keeps Steam's blue; OLED's near-black keys lose their edges when see-through; Steam is the
original. Modern is the default.

Seeing what you type. See-through alone shows text behind the keyboard only faintly, and whether gamescope composites
the alpha over the game is unverified, so the keyboard also echoes what it sent. Three placements were screenshotted
in every look: a field at the left of the suggestion row, a thin bar above the chips, and inside the space bar. The
field won: it reads as a text box where the eyes already are and does not change the key geometry (`echo-test.mjs`
checks keys through Steam's pad mapping with it on and off). The space bar is the fallback when the suggestion row is
off.

Enter closes keyboard is off by default, so a chat line can follow another; Steam only closes on Enter when opened by
Steam+X or a game's dismiss-on-Enter request, and B or Close still close it.

## Near misses: fuzzy suggestions, autocorrect costs, sloppy swipes (engine v5)

Reported: "if I don't swipe exactly over the letter it doesn't suggest more likely corrections, how a phone keyboard
would" ("lpl" should offer "lol"). Prior art: [research/fuzzy-typing.md](research/fuzzy-typing.md).

`keyboard/bench/bench-typos.mjs`: every chat-corpus word of 3+ letters gets one typo (neighbour key 55 %,
transposition 15 %, dropped letter 15 %, inserted letter 15 %, a second typo in 12 % of longer words), seed 31337. It
reports `suggest()` top-1/top-3, mid-word top-3 (the word minus its last two letters), autocorrect fixed and made
wrong, clean words, 20 named cases (lpl, teh, hwllo, gpod, im, ...) and timing. `bench-real.mjs` replays a saved Deck
swipe log (39 swipes, private; `OSK_REAL_SWIPES`).

Suggestion ranking (`sugComplCost`, `sugFuzzyCost`, `sugComplPerLetter`; tune / held-out):

| setting | top-1 | top-3 | mid-word top-3 |
|---|---|---|---|
| exact-prefix completions with `correct()`'s pick in front (before) | 89.3 / 89.4 | 90.4 / 90.1 | 36.3 / 35.8 |
| 1, 1, 0.3 | 81.8 / 83.2 | 93.5 / 91.9 | 74.9 / 65.7 |
| **2, 3, 0.3** | 89.5 / 90.1 | 97.1 / 95.7 | 73.7 / 64.2 |
| 3, 5, 0.5 | 90.0 / 90.7 | 97.3 / 96.9 | 64.8 / 52.2 |

Cheap completions of corrected prefixes ("sgart" → "started") push the exact-length correction out of first place; a
fuzzy cost of 3 keeps top-1 and nearly all of the mid-word gain.

Autocorrect substitution cost `subBase + d²/(2·corrSigma²)` (one key over: 3.97 at 0.45, 3.15 at 0.55). Clean
false-auto 0 and dictionary words 0/3000 in every row:

| setting | typo bench fixed / made wrong, tune / held | sentence bench noisy fixed / made wrong, tune / held | no-apostrophe fixed tune / held |
|---|---|---|---|
| corrSigma 0.45 (before) | 77.4 / 80.1, 3.3 / 1.2 | 50.2 / 50.0, 4.8 / 7.4 | 75.0 / 70.4 |
| **0.55** | 81.2 / 81.4, 2.5 / 0.6 | 55.9 / 53.2, 3.9 / 4.3 | 73.3 / 70.4 |
| 0.65 | 82.2 / 82.0, 2.7 / 0.6 | 65.0 / 60.6, 4.2 / 4.3 | 36.7 / 40.7 |
| 0.55, subBase 1 | 82.2 / 81.4, 2.7 / 0.6 | 63.7 / 60.6, 4.2 / 4.3 | 36.7 / 40.7 |

At 0.65 or with subBase 1 a neighbour key gets cheaper than restoring an apostrophe and "dont" stops becoming "don't".
`noVowelCost` 1 (an unknown 3+ letter word without a vowel scores 1 lower) makes "lpl" → "lol" automatic and changed
no other number.

Swipe candidate keys (nearest start / end keys whose words are scored): 4, 7 instead of 3, 5 gains or holds on every
sloppy column (sentence sloppy one / two pads tune 82.7 / 80.8 → 84.1 / 81.2) for 40 % more decode time (6.0 → 8.4
ms mean on the laptop); 5, 7 and 4, 9 gain nothing more, and endSigma 0.8, sigma 0.16 and visitSigma 2.5 lose on some
column. No setting recovers the three retyped Deck swipes: they barely reach the intended letters.

`suggest()` must stay under 3 ms p95 while typing: 1-2 letters use a cached frequency list (0.33 ms instead of 5.9
ms), and the fuzzy cap is 4.5 below 10 letters and 4 from 10 on (2.5-2.8 ms at 12 letters). Capping at 4 for every
length cost 4.4 / 1.5 points of mid-word top-3.

## Tap positions, wordlikeness, license-clean data (engine v6, words.js v3, lm.js v3)

### Tap positions in correction

`correct()` and `suggest()` take `ctx.taps`. A substitution at a tapped letter costs `max(tapMin, tapBase + Δ)`, where
Δ is the difference in squared distance from the tap to the candidate key and to the typed key, divided by 2σ² (σx,
σy in key widths and heights). A tap on the o/p border makes "lpl" → "lol" cheap; a tap in the middle of p keeps the
full cost. Without `ctx.taps` results are unchanged. `bench-typos.mjs` also types every chat-corpus word with taps
drawn from a Gaussian in pad millimetres (1.5 and 2.5 mm) through the Standard and Big letter keys pad maps.

| σx × σy, base | clean words changed tune / held | top-1 | auto-fixed | made wrong |
|---|---|---|---|---|
| no taps | 0 / 0 | 64.3 / 64.8 | 45.2 / 41.7 | 6.2 / 4.7 |
| 0.45, 0.5 | 7 / 1 | 68.1 / 68.5 | 62.2 / 60.8 | 6.0 / 4.4 |
| 0.45, 1.5 | 0 / 0 | 65.9 / 66.2 | 57.6 / 56.9 | 5.7 / 3.7 |
| **0.5 × 0.4, 1.5** | 0 / 0 | 66.6 / 66.2 | 57.7 / 57.8 | 5.3 / 3.5 |
| 0.6 × 0.45, 1.5 | 1 / 0 | 68.0 / 67.8 | 60.0 / 58.7 | 5.4 / 4.7 |

Every changed clean word was "im" typed for "I'm" with the m tap near n, which became "in". Taken: σx 0.5, σy 0.4,
base and floor 1.5, the best row with no clean word changed. Auto-fixed with taps rises 12 to 19 points at 1.5 mm and
5 to 19 at 2.5 mm, and made wrong goes down or stays level.

### Wordlikeness of the typed word

A letter-trigram model over the dictionary added `wlWeight × (log-probability − dictionary mean)` to an unknown
word's literal score:

| wlWeight | sentence noisy fixed / wrong, tune; held | typo bench fixed tune / held | taps big 2.5 mm wrong, tune | names changed |
|---|---|---|---|---|
| **0** | 55.0 / 3.9; 53.2 / 4.3 | 81.0 / 82.0 | 3.8 | 1/40 |
| 0.25 | 55.9 / 4.2; 56.4 / 6.4 | 83.1 / 84.5 | 7.1 | 1/40 |
| 0.5 | 56.6 / 4.2; 56.4 / 6.4 | 83.5 / 85.7 | 9.1 | 1/40 |
| 1 | 57.2 / 5.1; 56.4 / 7.4 | | | 5/40 |

Rejected: it fixes more typos but makes more wrong corrections, and a wrong correction costs the user an undo. At 1
it changes five game names. The term was removed from the engine.

### Data without Google Web 1T

`count_2w.txt` (Norvig, Google Web 1T) used to feed lm.js and the mined phrases. `build_words.py` now uses only
wordfreq, the SCOWL lists and the generated pair counts: a pair a b is stored as f(a) × P(b | a), with f from
wordfreq and P = count / (row total + smoothing), times a mass factor. Licenses: `keyboard/data/DATA-LICENSES.md`.

| variant | next word top-1 / top-3, tune; held | run-together fixed tune / held | sentence sloppy one / two pads, tune; held | names |
|---|---|---|---|---|
| v2 (Web 1T + chat ×10) | 17.4 / 32.4; 14.7 / 28.7 | 90.5 / 94.4 | 84.1 / 81.2; 80.7 / 77.5 | 1/40 |
| mass 1, smooth 5 | 18.1 / 31.9; 14.0 / 30.1 | 96.7 / 96.2 | 83.8 / 80.3; 81.2 / 77.5 | 2/40 |
| mass 0.22, smooth 5 | 20.5 / 34.3; 18.4 / 33.8 | 96.7 / 96.2 | 84.1 / 80.2; 82.1 / 77.1 | 2/40 |
| **mass 0.22, smooth 20** | 21.0 / 34.0; 18.4 / 33.8 | 96.7 / 96.2 | 83.9 / 80.2; 82.1 / 77.1 | 1/40 |
| mass 0.1, smooth 20 | 21.4 / 33.8; 19.9 / 34.6 | 96.7 / 96.2 | 83.3 / 80.2; 82.1 / 77.1 | 1/40 |

Taken: mass 0.22, smoothing 20 (best tune swipe with near-best tune prediction; held-out was not used to choose).
Costs against v2: sloppy two-pad sentence top-1 −1.0 on tune, rare words −2. An earlier step chose chat counts at 10×
the web counts over chat only, since both corpora were written by language models and the web pairs cover
search-box text; the chat table was generated with Qwen3.5-9B-Base (252k lines, 1.73M words) from few-shot chat logs
written for the purpose.

### Gates

`node keyboard/bench/gates.mjs` (`--fast`: sloppy swipe modes only, no tap bench; `--verbose` lists the passing
checks; `--jobs N`) exits 1 if any check fails: bench.mjs noiseless self-check ≥ 98 %, clean words auto-changed 0
(sentence, typo and tap benches), dictionary words 0/3000, game names ≤ 1/40, clean words shown first in `suggest()`,
the prefix and row cases, and per-mode, per-split accuracy floors (`FLOORS`). Checked against a copy with
`confMargin` and `knownLowMargin` 0: it failed with 143/3000 dictionary words and 3/40 names. The work runs as
independent tasks with fixed seeds on worker threads, so `--fast` reproduces the full numbers.

### Evaluation set (eval-only)

`keyboard/bench/corpora/eval-corpus.txt`: 176 lines written on 2026-10-23 (texting, game chat, search-box queries,
commands, contractions), not drawn from `chat-corpus.txt` or the generated text. Use it only to report, never to
choose settings: `OSK_CORPUS=eval-corpus.txt node bench-sentences.mjs` (or `bench-typos.mjs`). Its results are in the
next section.

## Generated web, search and note text in the pair table (words.js v4, lm.js v4)

Why: the chat-only pair table (v3) predicted the next word worse on the eval set (16.8 → 14.3 top-1), whose search and
command lines are web-like text.

`keyboard/build/gen-web.py` generated list-style text with Qwen3.5-9B-Base from few-shot lists written for this (web,
Steam store, app and video searches, short emails, forum posts, bot commands, reviews, notes, game-guide searches;
no 4-word overlap with the corpora): 22,922 lines (`keyboard/data/inputs/web-lines.txt.xz`), counted into
`web-bigrams.txt`. `build_words.py` mixes (1 − w) × chat + w × web (`OSK_WEB_WEIGHT`). Weights were chosen on the chat
tune split and the tune-only `keyboard/bench/corpora/tune-web-corpus.txt` (152 lines).

| web weight | next word top-1 / top-3, chat tune | tune-web | run-together fixed, chat tune / tune-web | gates --fast |
|---|---|---|---|---|
| 0 (v3) | 21.0 / 34.0 | 9.8 / 21.0 | 96.7 / 79.2 | pass |
| 0.1 | 20.5 / 33.6 | 16.7 / 30.8 | 97.1 / 88.7 | fail: one held-out typo |
| **0.3** | 19.5 / 34.0 | 19.7 / 34.6 | 97.1 / 89.5 | pass |
| 0.5 | 19.3 / 34.0 | 22.5 / 35.8 | 97.1 / 90.2 | fail: one held-out typo; chat phrase swipe 96.7 → 93.4 |

Taken: 0.3. It doubles next-word top-1 on the search/notes set for −1.5 on chat and passes every gate. Eval set, v2
(Web 1T) → v3 (chat only) → v4:

| | v2 | v3 | v4 |
|---|---|---|---|
| next word top-1 / top-3 | 16.8 / 28.7 | 14.3 / 27.2 | 16.9 / 29.2 |
| sentence swipe one pad / two pads / sloppy one / sloppy two | 94.0 / 96.1 / 84.8 / 81.2 | 94.2 / 95.9 / 84.2 / 80.8 | 94.1 / 95.9 / 83.9 / 80.7 |
| run-together fixed | 85.6 | 90.3 | 91.1 |
| noisy taps fixed / made wrong | 50.0 / 2.8 | 48.7 / 2.8 | 50.6 / 2.6 |
| typos: top-1 / top-3 / auto-fixed / made wrong | 90.6 / 91.1 / 77.1 / 1.8 | 90.5 / 97.7 / 77.1 / 1.8 | 90.3 / 98.0 / 79.0 / 1.7 |
| clean words changed; dictionary; names | 0; 0/3000; 1/40 | 0; 0/3000; 1/40 | 0; 0/3000; 1/40 |

## Simulator suite speed (v17)

The suites used to sleep fixed times (450 ms per scenario, up to 1 s after boot, injection, setting changes and
reopen). They now wait on conditions (`inject`, `settle`, `waitKeyboard` in `keyboard/sim/run.mjs`), which roughly
halved every suite. Waiting on conditions exposed two real timings the sleeps hid: Steam slides the keyboard in after
reopening (so `waitKeyboard` waits for the space bar to stop moving), and a swipe within 220 ms of a tap joins it (so
`settle` waits out that window unless told not to). Two waits stay fixed on purpose: long presses (600-620 ms against
the 550 ms hold) and swipe pacing (8 ms between pad samples).

## Mid-word lookalikes (engine v7)

Bug: typing "wor" made "or" the middle (autocorrect) chip instead of "work"/"world"; likewise "tod" → "to", "ga" →
"a", "wo" → "so", "the frie" → "fire", all confident. Each buffer is still the live start of a common word.

Fix: a buffer is a live prefix when its best completion scores within `prefixMargin` of the best correction. Then
corrections that neither extend the buffer nor only restore an apostrophe pay `prefixCorrPenalty`, the completion
becomes a `correct()` candidate, and nothing is confident. Autocorrect on space or punctuation passes `final: true`
and keeps the old rules (with the reordering there too, made-wrong rose 2.3 → 2.9). Prefix cases in `bench-typos.mjs`
(`PREFIX_CASES`, gated): wor, wo, tod, ga, the frie, the hel, the gam, thin, goo, pla, th must show a completion or the
typed word first and not be confident; realy, teh, agian must stay confident.

| prefixMargin, penalty | prefix cases | row top-1 | top-3 | mid-word top-3 |
|---|---|---|---|---|
| none (v6) | wor, tod, ga, wo fail | 91.0 | 98.3 | 82.7 |
| 1, 2 | 13/15 (tod, ga) | 90.6 | 98.3 | 83.2 |
| 2, 2 | 15/15 | 90.0 | 98.1 | 83.2 |
| **3, 2** | 15/15 | 90.2 | 98.1 | 83.2 |
| 3, 3 | 15/15 | 89.7 | 97.5 | 83.2 |

Autocorrect fixed / wrong stayed 81.0 / 2.3 in every row. Without `final`, autocorrect is stricter (78.2 % fixed
instead of 81.0 %), so space and punctuation must pass it.

## Permissive data without wordfreq (not adopted; `OSK_WORDFREQ=0`)

Goal: words.js and lm.js under permissive terms; they are CC BY-SA 4.0 only because their frequencies come from
wordfreq. The permissive build (`OSK_WORDFREQ=0`) takes its vocabulary from SCOWL sizes ≤ `OSK_SCOWL_MAX` (vendored as
`keyboard/data/inputs/scowl-levels.txt.xz`; sizes 80–95 excluded for UKACD's terms) plus the curated lists, and a
word's frequency from its count in the generated chat and web lines × `OSK_CORPUS_SCALE` plus a SCOWL-size prior
10^(A − B × rank). The corpora see 78 % of size-10 words but only 3 % of size-50, so the prior decides most words.
`bench-vocab.mjs` reports in-vocabulary rate and no-context swipe top-1 on all tokens of the tune texts.

| setting (size ≤, A, B, corpus scale) | words | tune in vocab / top-1 one pad / sloppy two pads | gates (`--fast`) failing |
|---|---|---|---|
| current (wordfreq) | 45,672 | 99.6 / 86.4 / 70.5 | none |
| 35, 3.4, 0.2, 1 | 51,316 | 98.3 / 86.6 / 72.6 | names 3/40 |
| 50, 3.4, 0.35, 1 | 57,826 | 99.5 / 87.2 / 73.1 | names 3/40 |
| **50, 3.4, 0.35, 0.25** | 57,557 | 99.4 / 87.5 / 73.2 | names 2/40 (hollowknight, decky → deck) |
| 50, 3.4, 0.35, 0.2 | 57,428 | 99.3 / 87.7 / 73.6 | typo bench fixed 79.4 < 80.0 |
| 50, 3.0, 0.35, 0.1 | 48,053 | 99.0 / 88.1 / 73.8 | typo fixed, clean shown first, prefix "thin" |

The generated corpora over-count this project's topics ("watch" and "deck" at zipf 6.0 and 5.8), which makes "decky"
→ "deck" and "overwatch" → "over watch" confident. Scaling the corpus down fixes the names but weakens typo correction,
and no setting passes every gate. The best candidate (now the `OSK_WORDFREQ=0` defaults) fails one gate (names 2/40),
and on the eval set it changes one clean word, fixes 3.8 fewer run-together words, loses 0.6 next-word top-1 and
decodes 30 % slower; swipes and mid-word suggestions are level or better. Decision: wordfreq stays the default.

## Typing log review (2026-10-30)

Source: the author's own Deck typing log, keyboard v21 to v31: 1,976 words of ordinary chat while playing, in 248
bursts (scripted drills left out). The log is private. `node keyboard/bench/bench-log.mjs` replays any typing log
through the current engine (`OSK_TYPING_LOG=<file> OSK_LOG_SINCE=2026-10-24T00:00`, `OSK_USER_WORDS=<user-words.json>`).

- **Taps carry the typing.** 1,945 of the 1,976 words were tapped and 24 swiped.
- **Tap positions are centred.** Over 6,072 tapped letters of kept dictionary words the mean offset from the key
  centre is at most 0.055 key in x and y on either pad and in any row, with σ 0.15 to 0.19 key. A per-pad offset
  correction would not help.
- **Suggestions are seldom picked.** Picks saved 1.0 % of presses. In the replay the middle chip showed the finished
  word early enough to save 21.0 % (26.9 % counting the right chip). In Big letter keys the chips are at the top edge
  of each pad, a thumb's trip away from the letters.
- **Autocorrect is off for a reason.** Replayed on 1,722 tapped words it would change 87 that were kept as typed, 47
  of them only by adding an apostrophe (39 and 9 with the Deck's learned words).

Decision (keyboard v32): LB / RB gets a **Pick words** option, so a pick costs one index-finger press; Ctrl / Alt stays
the default. Tapped words now carry `erased` and bumper picks `via`, so the next review can measure tap misses and
whether Pick words gets used.

2026-11-12 (keyboard v36): the log lacked the last word of every message and every word before `.`, `!` or `?`,
because those ended a word without logging or learning it. The privacy rule now covers only the lone word of a line;
the current rule and record format are in [KEYBOARD.md](KEYBOARD.md). Logs written before v36 replay to the same
numbers as before.

2026-11-16 (keyboard v39, engine v11): keyboard v37 logged 1,555 finished words in its first three days on the Deck
(1,725 records). With `prev` in every record, 75 tapped words had none although a word ended by a space or comma came
less than 10 s before; at least 17 of them were the end of that word, typed after Backspace took out the space and a
letter or two ("comr", Backspace twice, "e"). Backspace on an empty buffer only cleared the previous word, so the
first ending was logged and learned (an unknown typo counted towards a new word, a known word and its pair counted
once more) and the letters typed next were logged, learned and completed as a word of their own. Backspace right
after the space or punctuation that ended a typed word now takes the word back: it undoes what that ending learned
(`unlearn` also takes back a line start), drops its log record, and the letters typed next continue the word. The
same log had 48 `geo` records with no keys, written when a word ended by Enter was logged after Enter closed the
keyboard; the benches then replayed the words after it with no key geometry. No `geo` record is written without keys
now, and the benches skip the old ones. `bench-chips.mjs` on the v37 days, before → after the bench fix: three chips
after 1 / 2 / 3 / 4 letters 42.3 / 59.9 / 75.8 / 77.8 → 42.3 / 60.0 / 75.8 / 78.5, presses saved as shown 39.7 → 39.8,
chips that do not extend a clean prefix 4.7 → 4.5 %. The row the Deck showed was not affected, only its replay.

## Space bar width with the Win key (keyboard v34)

The Win key took one more of Steam's 8.2 %-wide keys from the bottom row, and the space bar is the row's only flexible
key, so it shrank to 196 px of the 854 px keyboard (stock Steam: 414 px; with Ctrl and Alt only: 269 px). The space bar
is also where a cursor slide starts.

| Ctrl / Win / Alt width | each key | space bar |
|---|---|---|
| 8.2 % (Steam's) | 73 px | 196 px |
| 6.75 % | 60 px | 233 px |
| **6.45 % (about a letter key)** | 58 px | 240 px |
| 5.5 % | 50 px | 265 px |

Taken: 6.45 %. The three keys stay as large as the letters a pad already aims at, the LB / RB badges still fit, and
the space bar gets back 44 px. Narrower keys would trade a key the size of a letter for a few more pixels of a bar
that is already three letters wide.

## Learned pairs in next-word prediction and completions (superseded by engine v10)

Before engine v10, next-word prediction added `predictUserBoost × ln(1 + user pair count)` (15 was chosen: a pair used
twice comes first, a word used once is not pushed into the row yet) and completions had their own pair boost and
candidate rules. The one word model below replaced all of it. What was tried there and not taken still holds on the
same typing log replay (`bench-predict.mjs`):

- A next-word score as a smoothed share, ln(pair count + α × table probability): no gain that holds on both the log
  and the chat corpus.
- Recency (session only, or a boost halving every 50 to 1,000 learned words): worse or level.
- Learned word triples: only 60 of 2,776 two-word contexts in the log had been seen before, so a user's own triples
  have little to gain.

## One word model for the suggestion row (engine v10, pairs v6, keyboard v37)

Reported: "there are definitely issues with some completions". Replaying the author's Deck typing log (2026-10-24 to
2026-11-12, 4,261 tapped words scored, the scripted drills left out of scoring and learning) through the row as
keyboard v35 built it showed what they were. One chip in ten did not extend a correctly typed prefix: a short common
word one edit away ("wa" → a, "sp" → so, "ther" → the, "inve" → nice), or a split nobody typed ("thei" → the I,
"assis" → ass is, "playin" → play in ahead of playing). The cause was structural. The row put `correct()`'s best
lookalike first whether or not autocorrect would apply it, a completion paid 2 + 0.3 per missing letter while a
correction paid only its edit cost, a missing space cost 0.5, and a word the user typed 40 times gained less than a
rare dictionary word did. The log has 14 real typos fixed by a pick in those 4,261 words, so the row was tuned for
the rare case.

`keyboard/bench/bench-chips.mjs` is the new bench: it replays a typing log (with its own key geometry and tap
positions) or a text through a fresh engine that learns as the keyboard does, builds the row as `patch.js` does, and
reports, per number of typed letters, how often the word is in the row, the presses saved if every shown word were
picked at once (letters plus the space; a pick is one press; a next-word, line-start or phrase chip that holds the
whole word counts), the share of chips that do not extend a correctly typed prefix, and how many of the real typos
the row offers. `--legacy` builds the v35 row; the "before" rows use it with the v9 engine and the v4 pair table.

Changes, cumulative:

1. One word model (`rowP`). Every candidate is scored as ln P(word | previous word, this user): dictionary frequency
   mixed half and half with the word's share of the pair table, then the pair table, then the user's own counts as
   observations (a learned use against 1,000 words of prior; a learned pair against 5 plus the number of different
   followers typed after that word). A completion pays nothing, a correction its edit cost plus 2, a made-up split
   3, one-letter words are not corrections, and the row follows `suggest()`'s order; a correction goes first only
   when autocorrect is on and will apply it.
2. Third chip. The left slot showed the typed letters or "+ add" on every keystroke. While the letters are a word in
   progress (two of the first three candidates extend them) it now shows the third candidate.
3. Line starts. After Enter and when the keyboard opens, the row offers the words this user starts lines with, and
   the first word is completed with that context. In the old logs a gap of 30 s stands in for the line start.
4. Word triples. 25,000 triples from the generated lines (`build_trigrams.py`) and two previous words from
   `patch.js`.

| row | word in the row after 1 / 2 / 3 / 4 letters | presses saved | second half of the log: after 1 / 2 / 3 / 4 letters | presses saved |
|---|---|---|---|---|
| before (v9, v35 row) | 34.8 / 46.2 / 60.1 / 67.2 | 31.8 | 34.9 / 48.3 / 60.7 / 70.3 | 33.2 |
| + one word model, two chips | 35.6 / 54.9 / 70.0 / 74.3 | 34.4 | 35.7 / 57.7 / 71.1 / 76.2 | 36.0 |
| + third chip | 41.6 / 61.2 / 75.1 / 78.5 | 37.9 | 42.0 / 63.2 / 76.0 / 79.5 | 39.2 |
| + line starts | 43.0 / 61.4 / 75.3 / 78.4 | 38.7 | 43.1 / 63.3 / 76.2 / 79.5 | 39.9 |
| **+ word triples** | 43.4 / 61.7 / 75.3 / 78.4 | 39.0 | 43.6 / 63.6 / 76.2 / 79.5 | 40.3 |

Whole log, before → after: the first chip holds the word after two letters 33.8 → 42.8 %; chips that do not extend
a correctly typed prefix 9.9 → 4.6 %, made-up splits 0.9 → 0.3 %; next word top-1 / top-3 8.1 / 15.1 → 8.6 / 16.1;
the first word of a burst is in the line-start row 11.6 % of the time (807 bursts); real typos in the row 13 of 14
both times, in the first chip 11 → 12. Every constant was chosen on the first half of the log, the chat tune split
and `tune-web-corpus.txt`; the second half and the eval set were only reported. The optimum is flat: `rowAlpha` 200
to 3,000, `rowBeta` 0.5 to 50, the table weight 0.6 to 0.95 and the typo cost 1 to 3 all stay within a point on
every column.

Texts (one pass, learning on), before → after: row after two letters / presses saved / next word top-3.

| text | before | after |
|---|---|---|
| `chat-corpus.txt` | 70.1 / 47.3 / 33.6 | 81.5 / 56.3 / 40.3 |
| `tune-web-corpus.txt` | 66.5 / 50.7 / 32.6 | 76.5 / 58.2 / 39.8 |
| `eval-corpus.txt` (report only) | 62.0 / 46.8 / 26.0 | 74.8 / 55.2 / 31.9 |

Cost. `bench-typos.mjs` types every word with a typo and asks for the intended word first, as if the word were
finished. Short typed strings that are also the start of common words now show completions first ("hou" for "you":
hours / house / hour; "mot" for "not": mother / motion), so its row ranks drop: top-1 90.2 / 91.3 → 87.7 / 90.7
(tune / held-out), top-3 98.1 / 98.1 → 95.0 / 94.4. Mid-word top-3 rises 83.2 → 84.9 on tune and stays 76.1 held-out;
autocorrect on space is untouched (fixed 81.0 / 81.4, made wrong 2.3 / 0.6, clean and dictionary words 0), because
`correct()` and `decode()` keep their prior. The 20 named cases and the 15 prefix cases still pass. The gate floors
for those two ranks moved to the new values minus a point, and `gates.mjs` gained three checks per split on the chat
corpus (row after two letters, presses saved, chips that do not extend a clean prefix) and 14 row cases (13 buffers and one next word that needs both previous words); the v9
engine fails all seven new checks. 35 gates.

Speed and size on the laptop: `suggest()` p95 while typing 9 to 12 letter words 1.77 → 1.74 ms; with a learn before every
call, so that nothing is cached, one letter 1.2 ms p95, two to five letters under 0.7 ms. lm.js 2,333,024 →
2,817,660 bytes; creating and warming the engine 99 → 116 ms over 44 idle steps, longest step 8.1 → 11.9 ms.

Tried and not taken (same replay):

- A cost of 1 on completions: typo-bench top-1 87.4 / 88.8 from 84.7 / 85.1 at that point, the log 0.2 to 0.3 points
  worse on every column. The log decides.
- A recency term (the last 30 to 1,000 learned words, weight 0.05 to 0.3): within 0.3 point everywhere.
- No phrases among completions: +0.6 to +1.0 after three letters, but 52 phrase chips held the next word, and
  presses saved comes out 37.8 against 38.0.
- More next-word candidates (100 to 400 table followers, 40 to 100 most-typed and most frequent words): no change.
- 50,000 and 100,000 triples: presses saved on the second half 39.8 for 25,000, 50,000 and 100,000; eval set 54.1 /
  54.3 / 54.5 (measured before line-start chips were counted); 0.93 and 1.85 MB against 0.46 MB.
- A rebuilt pair table (interpolated Kneser-Ney, all 211k pairs): on a static model without learning it adds 1.1
  to 1.3 points of presses saved on the second half, half of it from a chat-weighted unigram. The pair-table share
  in the base (`rowChat` 0.5) takes that part; the table itself stays, because the swipe and autocorrect gates are
  tuned on it. A 4-gram level and a skip-bigram term added nothing measurable there.

What limits it now is the distance between the generated chat lines and real chat, not table size. Measured on the
log with the dictionary and the generated lines: 11.8 % of its words are not in the dictionary (a fifth of those are
contractions typed without the apostrophe), 57 % of its adjacent word pairs occur in the generated lines at all
(chat-corpus: 96 %), and a pair model gives 9.5 bits per word on the log against 6.3 on chat-corpus. Halving the
generated text four times moves presses saved on a static trigram model from 37.3 to 35.3, so doubling it would add
about half a point. `chat-corpus.txt` is not independent of the pair table: its lines average 2.6 words and 229 of
the 357 occur verbatim among the 252k generated lines, so its numbers flatter every model; the log is the measure.
What the keyboard learns from the user is worth more per word than any of it, which is why the last word before
Enter is now logged and learned (above).
