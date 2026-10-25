# OSK bake-offs

Every number here was measured on 2026-10-23 with the files in this folder, in the simulator or the engine benches; none comes from the Deck, except where a section names a Deck run. Scripts and raw results are listed per section.

## Learned word pairs in next-word prediction

Question: after you type "thank bro" a couple of times, does "bro" show up first after "thank", ahead of the web table's "you"?

Setup: `engine.predict` scores a follower as `logPrior + predictUserBoost * ln(1 + user pair count)`. Two tests:

- Pair check: learn a pair once or twice, then look at its rank in `predict(prev, 3)` (`ub.cjs`).
- Adaptive run: type the whole chat corpus (357 lines) word by word, predicting before learning each word; the second pass shows what a user who repeats themselves gets (`adapt.cjs`).

| predictUserBoost | pair rank, 1 use / 2 uses (hello→quxbaz, thank→bro) | pass 1 top1 / top3 | pass 2 top1 / top3 |
|---|---|---|---|
| 0 | | 11.2 / 25.2 | 22.1 / 37.8 |
| 6 (old default) | absent, absent / absent, 3rd | 13.8 / 27.9 | 33.3 / 56.5 |
| 10 | absent, 3rd / 1st, 1st | 14.2 / 27.7 | 37.6 / 61.5 |
| 15 | absent, 1st / 1st, 1st | 14.6 / 27.7 | 39.6 / 64.7 |
| 20 | 1st, 1st / 1st, 1st | 14.6 / 27.5 | 39.7 / 63.5 |

Winner: 15, now the default. A pair used twice comes first; a new word used once after a word is not pushed into the row yet.

## Swipe decoder weights

Setup: `keyboard/bench/bench-sentences.mjs` on `chat-corpus.txt` (357 lines; tune = 3 of 4 lines, held-out = every 4th), previous word carried as context, four swipe noise models, plus `keyboard/bench/bench.mjs` (dictionary words, no context, includes a rare-word column and a noiseless self-check that must stay ≥ 98%). Grids ran on a 128-thread workstation, 64 configs at a time, with one-off sweep scripts that are not kept; the chat generator is `keyboard/build/gen.py`.

Grid 1 (81 configs, seed 4242): priorWeight {0.1, 0.2, 0.3} × priorWeightHi {0.4, 0.6, 0.9} × lmLambda {0.5, 0.8, 1.0} × ctxWeight {0.5, 1, 1.5}. Grid 2 (29 configs, seeds 7, 99, 4242) widened prior weights to 0.5 and 1.6. Mean sentence top-1 over the four swipe modes:

| config | tune | held-out | phrase swipe tune / held | bench.mjs rare-word top-1 (touch, tune) | self-check |
|---|---|---|---|---|---|
| default (0.2, 0.6, 0.8, ctx 1) | 85.2 | 84.6 | 92.3 / 91.5 | 80.0 | 98.4 OK |
| prior 0.3, hi 0.9, ctx 2 | 86.7 | 86.4 | 91.6 / 91.8 | 73.0 | 97.5 FAIL |
| prior 0.5, hi 1.2, ctx 1.5 | 86.9 | 86.5 | 88.8 / 90.8 | | |

Raising the frequency prior wins on chat sentences, which are mostly common words, but loses 7 to 12 points on rare words and fails the noiseless self-check, so it was rejected. Context weight alone does not touch the no-context bench, so it was swept on its own over six seeds (1, 2, 3, 7, 99, 4242), per-mode top-1 [one pad, two pads, sloppy one pad, sloppy two pads]:

| ctxWeight | tune | held-out |
|---|---|---|
| 1 (old) | 92.1 94.2 78.4 75.7 | 92.6 95.8 78.6 75.6 |
| 1.5 | 92.2 94.6 79.1 76.4 | 92.7 95.9 79.3 76.5 |
| 2 | 92.3 94.8 79.4 76.8 | 93.2 96.0 79.3 77.0 |
| 2.5 | 92.2 94.9 79.6 77.0 | 93.4 96.3 79.7 77.3 |

Winner: ctxWeight 2, now the default (engine VERSION 4). It gains about a point on sloppy swipes on both splits and leaves bench.mjs unchanged (self-check 98.4%). 2.5 measured slightly higher, but the gain keeps coming from a 357-line corpus written for this project and a wrong previous word costs more as the weight grows, so the smaller step was taken.

## Autocorrect thresholds

Setup: same sentence bench, tap part: clean words must never be changed (false-auto), lazy apostrophes ("dont"), noisy taps (auto-fixed vs made-wrong), run-together words ("imdone"), plus 3,000 dictionary words typed correctly and 40 game and app names that must survive. Grid: confMargin {2, 3, 4} × confMaxCost {5, 6, 7.5} × corrCtxWeight {0.5, 1, 1.5} × knownApoMargin {2, 3, 4}.

| confMargin, confMaxCost | noisy fixed tune / held | made wrong tune / held | run-together tune / held | names changed |
|---|---|---|---|---|
| 2, 7.5 | 50.8 / 53.2 | 6.1 / 8.5 | 84 / 92 | 2/40 (overwatch, warzone) |
| 2, 6 | 49.2 / 50.0 | 5.8 / 8.5 | 84 / 92 | 2/40 |
| 3, 7.5 | 45.7 / 46.8 | 6.1 / 6.4 | 82 / 87 | 1/40 |
| **3, 6 (default)** | 44.7 / 44.7 | 5.8 / 6.4 | 82 / 87 | 1/40 (warzone) |
| 4, 6 | 40.8 / 42.6 | 4.2 / 6.4 | 75 / 79 | 0/40 |

Every config kept false-auto at 0 on 913 clean words and 0 of 3,000 dictionary words. knownApoMargin made no difference. Looser settings fix more typos but also change more names and turn more typos into the wrong word; tighter settings lose the run-together fixes ("imdone"), which were asked for. No candidate beat the default without a cost, so it stays.

## Dictionary and word-pair table size

Variants built with `build_words.py` env overrides (`OSK_MIN_ZIPF_LONG`, `OSK_MAX_BIGRAMS`, `OSK_MAX_PHRASES`, `OSK_WORDS_OUT`, `OSK_LM_OUT`); the default build reproduces the shipped words.js and lm.js byte for byte. The chat corpus contains no rare words, so vocabulary size was also measured on 2,500 tokens drawn from wordfreq by frequency (what a typical sentence contains) and 800 words of zipf 2.3 to 3.5 (rarer words), seed 20261023 (`grid/vocab.mjs`).

| variant | entries | sentence swipe tune / held | run-together tune / held | next word top-3 tune / held | frequency-drawn tokens in vocab / top-1 (one pad) | rarer words in vocab / top-1 |
|---|---|---|---|---|---|---|
| **base** | 44,498 | 85.9 / 84.3 | 82 / 87 | 23.1 / 25.0 | 97.0 / 89.1 | 55.5 / 37.4 |
| zipf ≥ 2.0 | 52,881 | 85.8 / 84.3 | 82 / 87 | 23.1 / 25.0 | 97.2 / 88.7 | 55.5 / 37.4 |
| zipf ≥ 2.7 | 33,830 | 85.9 / 84.3 | 82 / 87 | 23.1 / 25.0 | 96.7 / 88.1 | 39.3 / 31.0 |
| zipf ≥ 3.0 | 26,331 | 85.9 / 84.4 | 82 / 88 | 23.1 / 25.0 | 95.8 / 88.8 | 22.5 / 18.3 |
| 50k pairs | 44,498 | 85.6 / 84.1 | 81 / 82 | 21.7 / 22.1 | | |
| 300k pairs (lm.js 2×) | 44,498 | 86.0 / 84.3 | 83 / 89 | 23.1 / 25.0 | | |
| no pair table | 44,498 | 85.0 / 83.4 | 78 / 79 | 22.6 / 26.5 | | |
| no mined phrases | 43,557 | 85.9 / 84.3 | 86 / 88 | 23.1 / 25.0 | | |

Winner: base. Smaller vocabularies lose rarer words without gaining on common ones; the larger one adds words below zipf 2.0 and costs 0.4 on common tokens. 300k pairs gains one or two run-together fixes for twice the file, which the Deck loads at every Steam start. Dropping mined phrases looks better on run-together only because the phrase test set shrinks with it; phrases were asked for ("I'm done"). These rows used the engine before the ctxWeight change.

## Output path: how characters reach Moonlight

Full write-up: [BAKEOFFS-output.md](BAKEOFFS-output.md). A headless gamescope 3.16.31 on the laptop ran an SDL2 X11 key logger, and the Windows-side text was rebuilt from scancodes the way moonlight-qt does; text was injected through gamescope's input-method protocol (the `ControllerKeyboardSendText` path), XTest and libei, 5 runs per string, about 2,100 trials.

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

Winner: one character per SendText, 12 ms between keys, 45 ms before the same physical key again. Adopted in patch.js v13: the repeat check now compares physical keys (`aA`, `Ss`, `1!`, `;:` were losing their second character), and Ctrl/Alt chords go through the same queue with 40 ms on either side so Shift cannot leak. `swipe-test.mjs` fails any SendText of more than one character and any same-key resend under 32 ms.

### On a real Deck (v22)

The harness timings lost text on a Deck streaming to Windows Notepad over Moonlight: picking a suggestion for a tapped
word turned "testing" into "ttesing" (a Backspace and a later `t` lost). Measured there with a script that types five
sentences and ten word replacements (Backspaces), the Notepad text read back through UI Automation and diffed:

| timing | errors / chars |
|---|---|
| v21: 12 ms between keys, 45 ms before an immediate repeat | 35 / 928 |
| 12 ms, 100 ms since the same key's last press, 100 ms after a named key, 60 ms around Shift changes | 3 / 928 |
| same, 18 ms between keys | 7 / 1233 |
| same, 25 ms between keys | 0 / 2161 |
| same, 35 ms between keys | 0 / 1233 |
| 25 ms, but 70 ms since the same key | 1 / 1233 |

Backspaces alone, 4 per run: 45 ms apart lost one in 9 of 30 runs, 90 ms apart 0 of 30. A key pressed again 26 ms
after itself with another key between (`keeper`) lost the second press. gamescope holds each key until the next one
or 30 ms, and SDL's X11 backend treats a release followed by a press of the same keycode as auto-repeat, which
Moonlight drops. Raw key events (`ControllerKeyboardSetKeyState`) were worse (lost Shift, repeated Enter). Adopted in
v22: 30 ms between keys, 100 ms since the same physical key, 100 ms after a named key, 60 ms around Shift changes.

## Swipe deadzone

Complaint: thumbs resting or rolling on a pad while aiming a click started swipe mode by accident, and on 24 Oct 2026 seven strokes from the Deck's log split words while tapping ("m" + "aybe", "st" + "asck", "tha" + "ts"). The old gate started a swipe once a pad press moved 0.55 key from its first point. Steam's own keyboard has no such gate: its analog handler only moves the hover to the key under the pad and the click types it, so in the simulator the stock keyboard started 0 swipes in 80 drifts (it opens its long-press accent popup instead on 57 of them, a held key at about 500 ms). Every accidental swipe is the patch's.

`keyboard/sim/deadzone-test.mjs` (`DEADZONE_BENCH=1`, run through Steam's raw pad mapping with timed samples, 120 drifts per corpus, seeded): "walk" is a linear random walk of 0.6-1.2 keys over 300-800 ms with a touch-down jolt of up to 0.4 key and per-sample noise, "roll" the same with a smoothstep profile (peak speed 1.5x), "Deck 7" is the logged "red" replayed point by point plus "as" x3, "hmm", "tree" and "oh" synthesized from the logged sample count, duration and path length in linear, early and late speed profiles (17 strokes; the log holds points only for "red"). Short words are 12 words (we, hi, at, be, up, on, in, oh at reach 55; to, it, of, is at 75) swiped through the last key and 0.4 key past it at 6, 10 and 16 keys/s, decoded correctly out of 12. "Real Deck strokes" replays the 26 pad strokes of 39 logged Deck swipes (23 Oct 2026) through the gate offline.

| gate | walk | roll | Deck 7 (17 strokes) | short words 6 / 10 / 16 keys/s | real Deck strokes started |
|---|---|---|---|---|---|
| stock Steam (no patch) | 0 / 40 | 0 / 40 | n/a | n/a | n/a |
| old: 0.55 key from the first point | 104 / 120 | 104 / 120 | 17 / 17 | 12 / 12 / 12 | 22 / 26 |
| Small (x0.8: 0.88 key in 120 ms or 1.2 keys) | 3 / 120 | 11 / 120 | 1 / 17 | 12 / 12 / 12 | |
| **Normal (1.1 key in 120 ms or 1.5 keys from the 70 ms point)** | **0 / 120** | **1 / 120** | **0 / 17** | **11 / 12 / 12** | **20 / 26** |
| Large (x1.3: 1.43 key in 120 ms or 1.95 keys) | 0 / 120 | 0 / 120 | 0 / 17 | 9 / 10 / 11 | |

Accidental swipes are counts of drifts that wrote a swipe-log record or more than one character. The first Normal candidate (0.7 key in 120 ms, 1.3 keys) rejected 1 of the 17 Deck strokes and started 2 / 120 walks and 8 / 120 rolls: the logged strokes are 0.8-1.1 keys in 130-175 ms, faster than any resting drift. Offline grid over the real strokes and both corpora ([far, fast] keys): [1.3, 0.7] 4.8 % walk / 9 % roll, 1 of 17 Deck strokes rejected; [1.5, 0.9] 12 of 17; [1.5, 1.1] 17 of 17 and 20 / 26 real strokes started. The four real strokes that never start under either gate are single-key holds of two-pad words. The two real strokes lost by Normal are "as" (0.82 key in 184 ms) and a 0.92-key single-sample drift ("dew", deleted); the first is the same shape as the three accidental "as" strokes, so no gate on the stroke alone separates them. Started strokes begin a median 23 ms later than under the old gate (4-51 ms for 17 of 20, 146-199 ms for three slow ones). The decoder gets the whole stroke from its first point, so the gates in `keyboard/bench/gates.mjs`, which feed traces straight to the engine, are unaffected.

The cost of Normal is slow adjacent-key hops: "we" swiped at 6 keys/s is a tap of "w". Small keeps every short word at the price of 1 accidental stroke ("oh", a synthesized 3.2-key wander) and 11 of 120 rolls; Large loses short words at 10 keys/s. Decision: Normal by default, chooser "Swipe deadzone" (Small / Normal / Large, a multiplier of 80 / 100 / 130 on all three distances) on the Input tab. The touchscreen keeps its 0.55-key gate: there is no resting thumb on glass.

2026-10-25 (keyboard v30): the chooser is labelled "Swipe threshold"; the setting key stays `deadzone`.

## One thumb on the right pad

`keyboard/bench/bench-onepad.mjs`: the thumb misses by the same distance in mm as with two pads, so with one 32.5 mm pad spread over the whole keyboard the sideways error is 1.82× larger in key units.

| mode | top-1 tune / held-out |
|---|---|
| two pads, overlapping | 92.5 / 91.6 |
| one pad over half the keyboard (current) | 86.8 / 87.2 |
| one thumb over the whole keyboard | 67.9 / 69.5 |
| one thumb, sloppy | 35.1 / 40.0 |

It stays a setting, off by default.

2026-10-25 (keyboard v30): the One-thumb right pad toggle became the Pad reach choice "Right pad only" (left pad 55 %, right pad 100 %).

### One-thumb vertical mapping (v16)

Complaint: with one thumb the pad's 32.5 mm width covers the 854 px keyboard (26.3 px/mm) but its height still covers only the 286 px keyboard height (8.8 px/mm), so the same thumb movement goes 3x farther sideways than up or down. Fully even mapping leaves a vertical band of 286 / 26.3 = 10.9 mm of the pad for six rows, 1.8 mm per row.

A one-off bench on engine VERSION 4/5 (2026-10-23), reusing the trace generator of `keyboard/bench/bench.mjs`: words are swiped in pad millimetres with the same noise as `bench-onepad.mjs`, then mapped to the screen with each y gain (centred on the middle letter row, clamped at the keyboard edges). Two thumb models: "absolute" aims at each key's real pad position; "half-adapted" plans vertical moves halfway between the true gain and the sideways gain (alpha 0.5), standing in for a user who expects the same movement both ways. Top-1, tune / held-out seed:

| y/x gain ratio | y px/mm | row height on pad | absolute, normal | absolute, sloppy | half-adapted, normal | half-adapted, sloppy |
|---|---|---|---|---|---|---|
| 3:1 (v15, Steam) | 8.8 | 5.3 mm | 67.9 / 69.5 | 35.1 / 40.0 | 48.8 / 44.2 | 23.2 / 23.5 |
| **2:1** | 13.1 | 3.6 mm | 57.0 / 57.7 | 29.3 / 27.2 | 46.5 / 45.3 | 22.3 / 20.7 |
| 1.5:1 | 17.5 | 2.7 mm | 50.2 / 47.5 | 21.4 / 22.3 | 44.6 / 40.5 | 18.8 / 20.7 |
| 1.25:1 | 21.0 | 2.2 mm | 44.0 / 38.9 | 16.8 / 19.6 | 38.4 / 40.4 | 16.1 / 16.1 |
| 1:1 (even) | 26.3 | 1.8 mm | 34.4 / 36.3 | 13.9 / 12.6 | 34.4 / 36.3 | 13.9 / 12.6 |

Every step towards an even mapping costs accuracy, because the pad's height is the scarce direction. A thumb that expects equal movement loses a third of v15's lead, and 2:1 is then within 2 points of v15 while 1:1 stays 10 to 35 points behind. The decision: 2:1 is the default ("One-thumb shape"), 1:1 is offered for whoever wants the same movement both ways, 3:1 restores v15. The model of what users expect is a guess; neither model measures how it feels in the hand.

## Typing modes

`keyboard/bench/bench-modes.mjs`: 913 chat-corpus words tapped on the pads with Gaussian noise in pad millimetres, two seeds. "word ok" = the word that ends up typed is right.

| tap noise | standard + autocorrect | Big letter keys + autocorrect | Fast taps | Columns |
|---|---|---|---|---|
| 1.5 mm | 58.4 | 78.6 | 96.4 | 92.9 |
| 2.5 mm | 18.0 | 35.3 | 81.4 | 80.4 |
| 3.5 mm | 6.4 | 14.1 | 53.1 | 59.5 |

Fast taps is the most accurate but holds letters back until the word is committed, and Columns typed dictionary words only; both were settings until keyboard v30. Big letter keys keeps every letter appearing as it is tapped, works for names and passwords, and gains 20 points at 1.5 mm, so it is the default.

2026-10-25 (keyboard v30, modes.js v7): Fast taps and Columns were removed; `bench-modes.mjs` measures the Standard and Big letter keys columns only.

## Responsiveness

`keyboard/sim/latency.mjs`, 20 runs in the simulator, p50 / p95:

| | before | after |
|---|---|---|
| swipe release → first character queued (two pads) | 224.7 / 226.6 ms | 109.5 / 112.2 ms |
| swipe release → suggestion row updated | 164.8 / 202.0 ms | 108.0 / 112.4 ms |
| pad tap release → character | 0.2 ms | 0.2 ms |

Cursor slide (v16, `keyboard/sim/input-test.mjs`): a slide of 8 key widths in 160 ms left the output queue empty 114 ms after the last pad sample; at most 3 arrows wait (45 ms apart), later steps are dropped.

### Startup, idle and Backspace

Complaint: the keyboard lags when first opened, and Backspace is slow. `keyboard/sim/perf-bench.mjs` in Chromium with
CPU throttling (the Deck's Steam UI runs on one slow core), median of 5 runs; "long tasks" is main-thread time in
tasks over 50 ms. Stock is Steam's keyboard without the patch, before is v24 as of 0.2.1, after is this change.

| 6x CPU (4x CPU, rAF at 15 fps) | stock | before | after |
|---|---|---|---|
| `patch.js` evaluation (plugin load) | | 374 (226) ms | 67 (45) ms |
| background tasks in the 3 s after load, longest | | 0 | 467 / 287 (173 / 173) ms |
| first open: long tasks / longest task | 120 / 120 (74 / 74) ms | 1168 / 913 (567 / 484) ms | 377 / 143 (223 / 90) ms |
| second open: long tasks | 87 (70) ms | 107 (67) ms | 108 (67) ms |
| open and untouched, 3 s: animation frames / DOM changes | 0 / 0 | 12 / 24 | 0 / 0 |
| X pressed: Backspace sent after | 2.5 (1.5) ms | 2.7 (1.6) ms | 2.4 (2.2) ms |
| X held 1.5 s: Backspaces sent | 7 | 7 | 12 |
| 100 pad samples, hovering / clicked: handler time | 92 / 90 (85 / 78) ms | 116 / 105 (78 / 68) ms | 125 / 125 (80 / 78) ms |

Where the first open's time went before (CPU profile, 6x): warming the engine 728 ms (parsing the 2.3 MB word-pair
table 359 ms, the first decode 127 ms, completions 108 ms, correction 60 ms), all in the first tick after the
keyboard appeared; a second render of the whole keyboard forced by the patch on every open (about 250 ms the first
time); Steam's own render about 110 ms. Building the engine (about 300 ms) ran inside the evaluation of `patch.js`.
Now the engine is built in an idle callback after load and warmed in about 40 steps of at most one index, 200 000
characters of the pair table or one letter's completions (`warmStep`, at most 45 ms each at 4x); the warm-up that needs
the keyboard's geometry runs 300 ms after the open, one call per idle callback, and waits while anything is being
typed; a keyboard that already rendered VaporType's layout is not rendered again. Building the engine is still one
task (287 ms at 6x), at load, while the keyboard is closed.

While open and untouched, the patch's 250 ms tick rewrote the typed-text field's class and the mode badge's `hidden`
(2 DOM changes) and repainted the mode overlay through `requestAnimationFrame`, 4 times a second; both now write only
on change. Nothing in gesture, hold or output timing counts frames: the trail, the overlay and the typed-text field
paint in animation frames, everything else uses `performance.now()` and timers (`perf-test.mjs` types with no frames
at all).

Backspace: Steam repeats a held X (and a pad or touch held on Backspace) after 450 ms and then every 200 ms, 5 per
second, stock and patched alike, so the output pacing (100 ms) never bound a held Backspace. The repeat is now 100 ms,
equal to the same-key gap kept from the Moonlight measurement above, so held Backspace runs at 10 per second with
the same spacing on the wire. A repeat that finds a Backspace still queued is dropped (before, holding X behind ten
queued letters went on deleting 5 times after release), and the suggestion row refreshes 200 ms after the last
repeat instead of on every one (the refresh is what makes the patched X handler 13 ms against stock's 3 ms at 6x; it
runs after the Backspace is sent). The first Backspace still goes out inside the press event when nothing is queued.
Picking a suggestion or deleting a swiped word still sends one Backspace per character, 100 ms apart ("testing " is
0.8 s). Ctrl+Backspace as one chord would take 40 ms, but chords go out as raw key events, which lost Shift and
repeated Enter over Moonlight, and not every target deletes a word on it; not done.

### Two pads at once

Complaint (0.2.3, keyboard v26): typing is much slower with both trackpads in use. Measured 2026-10-25.

On a Deck (Steam 1792618285, 90 Hz, 0.2.3 as shipped; harness and raw data outside this repo), a pad sample cost
p50 0.5-0.6 / p95 1.6 ms alone or interleaved with the other pad, 3 s of 120 Hz samples took 240 ms of JS on one pad and
462 ms on two, and frames stayed at 11.1 ms with no long task. Commit latency was the problem: release to first letter
111 ms with one pad, 222 ms whenever the other pad was being sampled, and two pressed swipes at once typed nothing in
8 of 8 runs.

Cause, read in Steam's code and confirmed by the numbers: `scheduleFinish` waited 60 ms and then finished only once
neither `m_leftTrackpad.active` nor `m_rightTrackpad.active` was set, else at 220 ms. Steam's pointer component sets
`active` on every sample and clears it 100 ms after the last one, so a resting thumb on either pad (the normal grip)
always cost the full 220 ms, and a lifted thumb still cost about 100 ms of decay. Second, a press that landed while the
other pad was held was never a split point for the decoder, so two different words swiped together were decoded as
one word, found nothing, and were dropped. Third, `endStroke` returned while the other pad was held, so overlapping
rolled taps all waited until both pads were up at once.

Fix: the swipe finishes as soon as the last pad is released; a press within 220 ms of that release is merged back
(decoded again with the new stroke; Backspaces only if the joined word wins, with a 4-point bonus, `REWRITE_COST`, for
keeping the word already sent); a press while the other pad is held is a split point too; released taps go out once
every earlier press is released; the decodes after a release run in slices of at most 8 ms (`SLICE_MS`), and the live
preview pauses while both pads are held (its decode of two strokes in flight was a 25 ms task, 123 ms at 4x). Output
pacing and the deadzone are unchanged.

Is the joint reading still kept when the strokes overlap on purpose? Of the four multi-stroke swipes in the Deck's
swipe log (v15: `hello`, two `how`, one deleted), the three with a two-word reading decode jointly with a margin of
12.6 to 14.8 over the split now considered at their overlapping press, and the fourth has none, so all keep their word.

`keyboard/sim/twopad-bench.mjs` (`N=10`, 3 s cases 5 runs; taps 4 runs of 16), v26 `patch.js` against this change,
p50 / p95. "Pad task" is the longest of our handler calls (each pad sample, button events, timer and frame callbacks);
the trace's longest task of any kind, including GC and Steam's React work, was 7.6-15.3 ms after and 8.5-32.4 ms
before. Case 1b (3 s, one pad) is the CPU reference for case 3.

| case (1x CPU) | sample p95 (2 pads) | pad task | release → first SendText | last lift → first SendText | CPU per gesture | words |
|---|---|---|---|---|---|---|
| 1 one pad swipe | 1.1 → 1.2 ms | 4.7 → 5.9 ms | 126 / 141 → 7.5 / 13.3 ms | 117 / 124 → -4.7 / -2.9 ms | 94 → 91 ms | 10/10 → 10/10 |
| 2 one pad, other thumb resting | 0.8 → 0.8 ms | 1.8 → 1.6 ms | 221 / 224 → 5.7 / 7.5 ms | 209 / 213 → -4.9 / -0.6 ms | 149 → 122 ms | 10/10 → 10/10 |
| 1b one pad, 3 s | 0.5 → 0.4 ms | 1.7 → 2.1 ms | 127 / 141 → 6.2 / 7.2 ms | 117 / 125 → -2.1 / -0.1 ms | 429 → 400 ms | 5/5 → 5/5 |
| 3 both pads swiping 3 s, two words | 0.4 → 0.4 ms | 24.9 → 7.0 ms | nothing typed → 12.5 / 14.0 ms | nothing → -5.2 / -0.2 ms | 569 → 530 ms | 0/5 → 5/5 |
| 4a alternating taps 8/s | 0.5 → 0.4 ms | 9.4 → 8.3 ms | 0.1 / 0.2 → 0.1 / 0.2 ms | same | 677 → 593 ms | 4/4 → 4/4 |
| 4b alternating taps 12/s | 0.4 → 0.4 ms | 2.6 → 2.3 ms | 0.1 / 0.2 → 0.1 / 0.2 ms | same | 523 → 491 ms | 4/4 → 4/4 |
| 5 both thumbs resting, swipe on one | 0.4 → 0.4 ms | 2.9 → 1.7 ms | 221 / 222 → 6.3 / 7.7 ms | same (thumb stays) | 152 → 117 ms | 10/10 → 10/10 |

A negative "last lift" means the word was out before the thumb left the pad. Case 3 costs 1.33x the CPU of case 1b.
Frames: p95 16.7-16.8 ms in every case before and after at 1x. Rolled taps with overlapping holds (12/s, 110 ms
each, `twopad-test.mjs`): the latest letter came 1584 ms after its release before, 0 ms after.

At 4x CPU (`CPU=4 N=6`; the second of two after-runs; the first differed in case 3's pad task, 33 ms, and one lost
word in case 1):

| case (4x CPU) | sample p95 (2 pads) | pad task | frame p95 | release → first SendText | words |
|---|---|---|---|---|---|
| 1 one pad swipe | 5.8 → 6.4 ms | 18.1 → 17.3 ms | 33.3 → 33.4 ms | 147 / 151 → 36 / 50 ms | 6/6 → 6/6 |
| 2 one pad, other thumb resting | 3.6 → 3.6 ms | 7.2 → 9.0 ms | 16.8 → 16.8 ms | 224 / 230 → 32 / 35 ms | 6/6 → 6/6 |
| 3 both pads swiping 3 s | 1.3 → 1.6 ms | 123.3 → 24.3 ms | 16.8 → 16.8 ms | nothing → 63 / 66 ms | 0/3 → 3/3 |
| 4a taps 8/s | 1.5 → 1.3 ms | 42.2 → 35.8 ms | 33.4 → 16.8 ms | 0.6 / 1.1 → 0.5 / 1.0 ms | 2/2 → 2/2 |
| 4b taps 12/s | 1.5 → 1.4 ms | 12.7 → 11.7 ms | 33.4 → 33.3 ms | 0.2 / 0.9 → 0.3 / 0.7 ms | 2/2 → 2/2 |
| 5 both thumbs resting | 1.3 → 1.3 ms | 9.6 → 11.0 ms | 16.8 → 16.7 ms | 225 / 231 → 33 / 40 ms | 6/6 → 6/6 |

At 4x the longest pad tasks left are a tap's commit (Steam's `TypeKey` and the suggestion refresh, 36 ms, the same
before) and the first preview of a one-pad swipe (17 ms); neither is specific to two pads.

Render cost: with both pads hovering for 3 s, Steam's pointer element gets 748 style writes per pad and the page lays
out 375 times (one forced layout per sample in Steam's own pointer callback), identical with and without the patch;
the patch adds no DOM writes per sample (the trail draws on a canvas). Caching the mode overlay's chip rectangle and
skipping unchanged trail `style.left/top` writes moved the forced layout from `paint` to Steam's callback in the CPU
profile but changed neither the layout count nor CPU time in three alternated runs, so neither was kept.

### Slower the longer Steam runs (v29)

Complaint (0.2.5, keyboard v28, 2026-10-25): typing with both pads still slows to a crawl, after the commit-latency
fix above. Steam on the Deck had been running for 41 hours.

Cause, read in `steamui/sp.js` (build 1792618285, the same file as on the Deck): each keyboard open constructs a new
input source whose constructor registers with `RegisterForControllerInputMessages`,
`RegisterForControllerAnalogInputMessages` and `RegisterForSystemKeyEvents` and drops the handles, so the handlers
pile up for the life of the Steam process and every pad sample runs all of them. This matches the public report
"Virtual keyboard performance degrades dramatically at some point" (Steam Controller bug forum, 2026-10-22, no Valve
reply): degradation scales with the number of keyboard opens since Steam started, dual-pad typing degrades first, and
a Steam restart fixes it. In the simulator nothing else grows per open (window and document listeners stay at 3 and 1
after 20 opens).

`keyboard/sim/leak-test.mjs`, `CPU=4`, 2000 alternating left/right samples sent to every registered analog handler,
µs per sample on a fresh keyboard / after the opens. Two runs varied by about 50 µs at 40 opens; the counts are exact.

| opens | stock: handlers | stock: µs per sample | patched: handlers | patched: µs per sample |
|---|---|---|---|---|
| 40 | 41 | 55-59 → 69-121 | 2 | 60-80 → 60 |
| 200 | 201 | 55-63 → 131-137 | 2 | 67-71 → 57-59 |

The simulator measures only the JavaScript side. In Steam each registration is also a separate call from the client
into the page for every sample, which the simulator cannot measure; it has not been measured on the Deck.

Fix: `patch.js` keeps the handles from those three calls and unregisters them when the keyboard unmounts (see
KEYBOARD.md). Handlers that leaked before the patch loaded stay until Steam restarts.

## Chat-style word pairs

The web word-pair table predicts web text ("good for", "see all"). A chat table was generated locally: Qwen3.5-9B-Base (Apache-2.0) in bf16 on one GPU of a GPU workstation wrote 252k chat lines (1.73M words, 72 minutes) from few-shot chat logs written for the purpose, without reading `chat-corpus.txt`. Counts are in `keyboard/data/inputs/chat-bigrams.txt`; `build_words.py` scales them to `OSK_CHAT_WEIGHT` times the web total and adds them (`only` drops the web counts).

| weight | next word top-1 / top-3, tune | held-out |
|---|---|---|
| web only (old) | 8.3 / 23.1 | 13.2 / 25.0 |
| 0.3 | 11.9 / 28.1 | 14.7 / 30.1 |
| 1 | 15.5 / 29.5 | 14.0 / 29.4 |
| **10** | 17.4 / 32.4 | 14.7 / 28.7 |
| chat only | 18.8 / 34.0 | 17.6 / 32.4 |

With chat only, swipe tune top-1 went from 90.8 / 94.2 / 80.6 / 79.2 to 92.3 / 95.6 / 82.7 / 80.8, noisy taps auto-fixed 44.7 → 50.2 and run-together 82.5 → 90.5, with one more name changed (2/40). Weight 10 was taken over chat only: both corpora were written by language models, so the held-out lead of chat only may be partly shared style, and weight 10 keeps the web pairs for search-box text ("download the", "how to"); its top three followers for common words match chat only. lm.js is now version 2, 2.31 MB (was 2.42). With the new table the learned-pair boost was re-checked: 15 still gives the best second-pass prediction (41.0 / 63.5).

## Design

Looks (Modern, Steam, OLED) and the typed-text field were compared on screenshots in the simulator at 854×534, DPR 1.5, with a fake chat page behind the keyboard (`openSim({ backdrop: true })`), plus a one-off bench that rendered each look and opacity with the backdrop shown and hidden and measured the mean luminance change (0-255) inside the letter-key faces (`faceInterference`: labels getting dirty), across whole letter cells including the ring between keys (`keyInterference`), and on the rest of the keyboard (`gapSeeThrough`: how much shows through).

See-through formula. v13 applied one alpha to everything; v14 keeps letter faces at `a + (1 - a) * 0.9`, other keys at `a + (1 - a) * 0.6` and the board at `a - 0.5` (five other formulas were tried and dropped). Modern, v13 → v14 (final run):

| opacity | face interference | cell interference | see-through elsewhere |
|---|---|---|---|
| 90 % | 0.81 → 0.49 | 2.56 → 4.28 | 4.39 → 7.13 |
| 80 % | 2.95 → 0.67 | 5.09 → 5.25 | 6.88 → 8.81 |
| 70 % | 4.37 → 1.55 | 7.05 → 6.53 | 8.95 → 10.43 |

Final run, 90 %: Steam face 0.56, see-through 6.22; OLED 0.54, 7.20. Labels get cleaner and more shows through around them at every opacity. Default: Modern at 90 %.

Look. Modern (rounded keys with gaps, pill suggestion chips, the picked word filled blue) separates letters from modifiers best on the screenshots and keeps Steam's blue; OLED's near-black keys lose their edges when see-through; Steam is the original. Modern is the default, the others are a setting.

Seeing what you type. Opacity alone shows text behind the keyboard only faintly (see-through 7 of 255 at 90 %), and whether gamescope composites the alpha over the game is unverified, so the keyboard also echoes what it sent. Three placements were screenshotted in every look: a field at the left of the suggestion row (34 % of the row), a thin bar above the chips (13 px text, chips shrink to 27 px), and inside the space bar (hides its label, far from the chips). The field won: it reads as a text box where the eyes already are and does not change the key geometry (`echo-test.mjs` checks 12 keys through Steam's pad mapping with it on and off). The space bar is the fallback when the suggestion row is off.

Default typing mode: Big letter keys (see Typing modes). One-thumb pad: off, shape 2:1 (see One thumb). v16 removed the dashed outline Big letter keys drew around the letter rows: the pointer dot already shows where a pad lands, and the outline sat on the keyboard all the time. Cursor slide: on (opt-out). Enter closes keyboard: off, so a chat line can follow another; Steam only closes on Enter when opened by Steam+X or a game's dismiss-on-Enter request, and B or Close still close it. All sim suites pass with these defaults; `swipe-test.mjs` also passes with `WITH_MODES=1`, where Big letter keys is active.

## Near misses: fuzzy suggestions, autocorrect costs, sloppy swipes (engine v5)

Reported in testing: "if I don't swipe exactly over the letter it doesn't suggest more likely corrections, how a phone keyboard would" ("lpl" should offer "lol").

Setup. `keyboard/bench/bench-typos.mjs`: every chat-corpus word of 3+ letters gets one typo (neighbour key 55 %, transposition 15 %, dropped letter 15 %, inserted neighbour or double 15 %, a second typo in 12 % of words over 5 letters; typos that make a dictionary word are skipped), seed 31337. It reports `suggest()` top-1/top-3 after the whole word, mid-word top-3 (the word minus its last two letters), the autocorrect fix and made-wrong rates, clean words, 20 named cases (lpl, teh, hwllo, gpod, im, ...) and timing. `--baseline` reproduces what patch.js v15 shows today (completions with `correct()`'s pick in front). `keyboard/bench/bench-real.mjs` replays the Deck's `window.__oskSwipeLog` (39 swipes, read over CDP on 2026-10-23, saved with words and coordinates only; private, not in the repository: point `OSK_REAL_SWIPES` at such a file). Labels: replaced (the user picked another chip, 3), kept (not undone, a weak label, 17), retyped (deleted and swiped again within 15 s, starting and ending within 1.6 keys of the first swipe: hire→how, delay→today, "things you"→today), deleted (16, intent unknown). Final runs on a 128-thread workstation; timing on a 16-thread laptop.

`suggest()` ranking (tune / held-out, typos n=478 / 161):

| setting | top-1 | top-3 | mid-word top-3 |
|---|---|---|---|
| patch.js v15 today (baseline) | 89.3 / 89.4 | 90.4 / 90.1 | 36.3 / 35.8 |
| completion cost 1, fuzzy 1, per letter 0.3 | 81.8 / 83.2 | 93.5 / 91.9 | 74.9 / 65.7 |
| **2, 3, 0.3** | 89.5 / 90.1 | 97.1 / 95.7 | 73.7 / 64.2 |
| 2, 4, 0.6 | 89.5 / 90.7 | 97.1 / 96.9 | 71.5 / 61.2 |
| 3, 5, 0.5 | 90.0 / 90.7 | 97.3 / 96.9 | 64.8 / 52.2 |
| 4, 4, 0.5 | 89.3 / 90.7 | 97.5 / 96.9 | 65.4 / 50.7 |

Cheap completions of corrected prefixes ("sgart" → "started") push the exact-length correction out of first place; a fuzzy cost of 3 keeps top-1 at the baseline and nearly all of the mid-word gain.

Autocorrect substitution cost (`subBase + d²/(2·corrSigma²)`, one key over: 3.97 at 0.45, 3.15 at 0.55), with ranking 2/3/0.3. Clean false-auto was 0 and dictionary words 0/3000 in every row:

| setting | typos fixed / made wrong, tune / held | sentence bench noisy fixed / made wrong, tune / held | no-apostrophe fixed tune / held | names changed |
|---|---|---|---|---|
| corrSigma 0.45 (old) | 77.4 / 80.1, 3.3 / 1.2 | 50.2 / 50.0, 4.8 / 7.4 | 75.0 / 70.4 | 1/40 |
| 0.5 | 80.3 / 82.0, 2.5 / 0.6 | 52.4 / 52.1, 4.2 / 6.4 | 73.3 / 70.4 | 1/40 |
| **0.55** | 81.2 / 81.4, 2.5 / 0.6 | 55.9 / 53.2, 3.9 / 4.3 | 73.3 / 70.4 | 1/40 |
| 0.65 | 82.2 / 82.0, 2.7 / 0.6 | 65.0 / 60.6, 4.2 / 4.3 | 36.7 / 40.7 | 1/40 |
| 0.45, subBase 1 | 79.9 / 81.4, 2.5 / 0.6 | 52.1 / 51.1, 4.5 / 7.4 | 73.3 / 70.4 | 1/40 |
| 0.55, subBase 1 | 82.2 / 81.4, 2.7 / 0.6 | 63.7 / 60.6, 4.2 / 4.3 | 36.7 / 40.7 | 1/40 |
| 0.55, confMargin 2.5 | 81.6 / 82.6, 2.7 / 1.2 | 56.3 / 53.2, 3.9 / 6.4 | 73.3 / 70.4 | 1/40 |

Winner: 0.55. At 0.65 or with subBase 1 a neighbour key gets cheaper than restoring an apostrophe and "dont" stops becoming "don't"; 0.55 loses one of 60 apostrophe cases. `noVowelCost` 1 (an unknown 3+ letter word without a vowel scores 1 lower) makes "lpl" → "lol" automatic and changed no other number at 1 or 2 ("xqc" is untouched). "gpod" is first in the row but not applied, because "god" is too close.

Swipe candidate keys (nearest start / end keys whose words are scored), top-1 per mode:

| startKeys, endKeys | sentence sloppy one / two pads, tune; held | bench.mjs sloppy one / two pads, tune; held | real replaced / kept | self-check | decode mean / p95 (laptop) |
|---|---|---|---|---|---|
| 3, 5 (old) | 82.7 / 80.8; 80.3 / 77.5 | 68.9 / 79.6; 68.2 / 74.6 | 2/3, 17/17 | 98.4 | 6.0 / 15 ms |
| **4, 7** | 84.1 / 81.2; 80.7 / 77.5 | 69.6 / 81.1; 68.8 / 75.8 | 2/3, 17/17 | 98.4 | 8.4 / 20 ms |
| 5, 7 | 83.9 / 81.5; 81.2 / 78.0 | 69.5 / 81.2; 68.8 / 76.0 | 2/3, 17/17 | 98.4 | |
| 4, 9 | 84.1 / 81.2; 80.7 / 77.5 | 69.5 / 80.9; 68.8 / 75.8 | 2/3, 17/17 | 98.4 | |
| endSigma 0.8 | 82.7 / 80.6; 81.2 / 76.6 | 69.6 / 79.8; 67.0 / 74.0 | 3/3, 16/17 | 98.4 | |
| sigma 0.16 | 83.8 / 81.5; 79.8 / 78.4 | 69.1 / 80.0; 67.5 / 74.4 | 2/3, 17/17 | 98.1 | |
| visitSigma 2.5 | 82.9 / 80.9; 80.3 / 77.5 | 68.9 / 79.8; 69.5 / 74.6 | 2/3, 17/17 | 98.4 | |

Winner: 4, 7. Every sloppy column gains or holds on both splits, and sloppy two-pad phrases rise from 92.6 / 88.2 to 94.6 / 90.2; the decoder spends 40 % more time. Larger sets stop gaining. None of the settings recovers the three retyped Deck swipes: they barely reach the intended letters (the "how" swipe stops at "i"; the "today" swipes start on "d" and "r").

Speed of `suggest()` on the laptop, p95 per buffer length while a 12-letter word with one typo is typed (target < 3 ms): 1 letter 5.9 ms with `complete()` (measured while the decoder grid was running), 0.33 ms with the cached frequency list now used for 1-2 letters; 12 letters 3.5 ms with a fuzzy cap of 4.5, 2.5-2.8 ms with the final settings (4.5 below 10 letters, 4 from 10 on; workstation 3.27 ms). Capping at 4 for every length cost 4.4 / 1.5 points of mid-word top-3, at 3.5 11.7 / 11.9 points. `correct()` and `suggest()` on the same buffer share one search.

Final (tune / held-out): suggest top-1 90.8 / 91.3 (baseline 89.3 / 89.4), top-3 98.1 / 98.1 (90.4 / 90.1), mid-word top-3 83.2 / 76.1 (36.3 / 35.8), autocorrect fixed 81.4 / 81.4 (77.4 / 80.1), made wrong 2.5 / 0.6 (3.3 / 1.2); named cases 20/20 first, 19/20 automatic (17/20). Regression gates: self-check 98.4 %, clean false-auto 0, 0/3000 dictionary words, 1/40 names.

Not done, from `research/fuzzy-typing.md`: scoring the typed word with a character model (only the vowel rule above) and using tap coordinates, which needs patch.js to pass them. Always showing the best corrections for unknown and rare words is what `suggest()` does; cheaper neighbour keys are the corrSigma change.

## Tap positions, wordlikeness, license-clean data (engine v6, words.js v3, lm.js v3)

All runs on a 128-thread workstation, 2026-10-23.

### Tap positions in correction

`correct()` and `suggest()` take `ctx.taps`. A substitution at a tapped letter costs `max(tapMin, tapBase + Δ)`, where Δ is the difference in squared distance from the tap to the candidate key and to the typed key, divided by 2σ² (σx, σy in key widths and heights). A tap on the o/p border makes "lpl" → "lol" cheap; a tap in the middle of p keeps the full cost. Letters without a tap keep the letter-distance costs, and without `ctx.taps` the results are unchanged (bench-typos without taps reproduced v5 to the digit). Bench: `bench-typos.mjs` now also types every chat-corpus word with taps drawn from a Gaussian in pad millimetres (1.5 and 2.5 mm), mapped through `modes.js`'s standard and big-key pad maps, plus 3 % transpositions, 4 % dropped and 3 % extra letters. The hit key gives the typed word, and it is scored with and without taps.

Grid: σ {0.35, 0.45, 0.55, 0.5×0.4, 0.6×0.45} × base = min {0.5, 1, 1.5, 2}, summed over the four conditions (typos n = 1,214 tune / 429 held-out; v2 data). Selected rows:

| σx × σy, base | clean words changed tune / held | top-1 | auto-fixed | made wrong |
|---|---|---|---|---|
| no taps | 0 / 0 | 64.3 / 64.8 | 45.2 / 41.7 | 6.2 / 4.7 |
| 0.45, 0.5 | 7 / 1 | 68.1 / 68.5 | 62.2 / 60.8 | 6.0 / 4.4 |
| 0.5 × 0.4, 1 | 5 / 1 | 67.9 / 68.1 | 61.1 / 59.2 | 5.5 / 4.9 |
| 0.45, 1.5 | 0 / 0 | 65.9 / 66.2 | 57.6 / 56.9 | 5.7 / 3.7 |
| **0.5 × 0.4, 1.5** | 0 / 0 | 66.6 / 66.2 | 57.7 / 57.8 | 5.3 / 3.5 |
| 0.6 × 0.45, 1.5 | 1 / 0 | 68.0 / 67.8 | 60.0 / 58.7 | 5.4 / 4.7 |
| 0.5 × 0.4, 2 | 0 / 0 | 64.5 / 65.0 | 54.7 / 53.6 | 5.8 / 4.2 |

Every changed clean word was the same case: "im" typed for "I'm" with the m tap near n became "in". Winner: σx 0.5, σy 0.4 (wider sideways), base and floor 1.5, the best row with no clean word changed. Final, per condition (tune; held-out), auto-fixed without → with taps: big keys 1.5 mm 70.5 → 82.2; 60.2 → 77.1, big 2.5 mm 36.0 → 49.2; 29.9 → 48.8, standard 1.5 mm 55.2 → 71.7; 61.3 → 75.5, standard 2.5 mm 27.6 → 33.0; 23.0 → 35.4. Made wrong goes down or stays level in all eight (largest drops: standard 1.5 mm 5.1 → 3.0 tune, standard 2.5 mm 8.0 → 5.3 held-out); on the eval set big keys 1.5 mm it rises 0.9 → 1.5. `suggest()` + `correct()` p95 at 12 letters: 3.42 ms without taps, 2.70 ms with taps (workstation).

### Wordlikeness of the typed word (research rec 5)

A letter-trigram model over the dictionary's word types (built on first use, 27³ table) adds `wlWeight × (sum of log-probabilities − dictionary mean)`, capped at ±6, to an unknown word's literal score (v3 data):

| wlWeight | sentence noisy fixed / wrong, tune; held | typo bench fixed tune / held | taps big 2.5 mm wrong, tune | names changed |
|---|---|---|---|---|
| **0** | 55.0 / 3.9; 53.2 / 4.3 | 81.0 / 82.0 | 3.8 | 1/40 |
| 0.25 | 55.9 / 4.2; 56.4 / 6.4 | 83.1 / 84.5 | 7.1 | 1/40 |
| 0.5 | 56.6 / 4.2; 56.4 / 6.4 | 83.5 / 85.7 | 9.1 | 1/40 |
| 1 | 57.2 / 5.1; 56.4 / 7.4 | | | 5/40 |

Rejected (`wlWeight` 0): it fixes more typos but makes more wrong corrections, and a wrong correction costs the user an undo. At 1 it changes five game names.

2026-10-25: the unused term and its `wlWeight`, `wlCap` and `wlK` options were removed from the engine.

### Data without Google Web 1T

`count_2w.txt` (Norvig, Google Web 1T) fed both lm.js and the mined phrases. `build_words.py` now uses only wordfreq, the SCOWL lists and `chat-bigrams.txt`: a pair a b is stored as f(a) × P(b | a), with f from wordfreq and P = count / (row total + smoothing) from the chat counts, times a mass factor, so the values stay on the old per-billion scale. Phrases are mined from the same values (mass 1) plus the curated list. Licenses: `keyboard/data/DATA-LICENSES.md`. The default build is reproducible byte for byte (rebuilt and compared on a workstation, wordfreq 3.1.1).

| variant | phrases | next word top-1 / top-3, tune; held | run-together fixed tune / held | sentence sloppy one / two pads, tune; held | phrase swipe top-1 tune / held | names |
|---|---|---|---|---|---|---|
| v2 (web + chat ×10) | 1,093 | 17.4 / 32.4; 14.7 / 28.7 | 90.5 / 94.4 | 84.1 / 81.2; 80.7 / 77.5 | 96.0 / 96.1 | 1/40 |
| mass 1, smooth 5 | 2,268 | 18.1 / 31.9; 14.0 / 30.1 | 96.7 / 96.2 | 83.8 / 80.3; 81.2 / 77.5 | 96.7 / 96.7 | 2/40 |
| mass 0.5, smooth 5 | 2,268 | 18.8 / 32.6; 14.7 / 32.4 | 96.7 / 96.2 | 83.8 / 80.3; 82.1 / 77.5 | 96.7 / 96.7 | 2/40 |
| mass 0.22, smooth 5 | 2,268 | 20.5 / 34.3; 18.4 / 33.8 | 96.7 / 96.2 | 84.1 / 80.2; 82.1 / 77.1 | 96.7 / 96.7 | 2/40 |
| **mass 0.22, smooth 20** | 2,268 | 21.0 / 34.0; 18.4 / 33.8 | 96.7 / 96.2 | 83.9 / 80.2; 82.1 / 77.1 | 96.7 / 96.7 | 1/40 |
| mass 0.22, smooth 50 | 2,266 | 20.7 / 34.0; 19.9 / 33.8 | 96.7 / 96.2 | 83.9 / 80.2; 82.1 / 77.1 | 97.3 / 96.7 | 1/40 |
| mass 0.1, smooth 20 | 2,268 | 21.4 / 33.8; 19.9 / 34.6 | 96.7 / 96.2 | 83.3 / 80.2; 82.1 / 77.1 | 96.7 / 96.7 | 1/40 |
| mass 0.22, smooth 20, 1,100 phrases | 1,189 | 21.0 / 34.0; 18.4 / 33.1 | 96.5 / 95.9 | 83.8 / 80.2; 82.1 / 77.5 | 94.6 / 94.4 | 1/40 |
| mass 0.22, smooth 20, 1,600 phrases | 1,678 | 21.0 / 34.0; 18.4 / 33.1 | 96.6 / 96.1 | 83.8 / 80.2; 82.1 / 77.1 | 95.5 / 94.8 | 1/40 |

The phrase test set grows with the phrase list (n 149 → 183 tune), so phrase top-1 is not comparable across the v2 row. Winner: mass 0.22, smoothing 20 (best tune swipe with near-best tune prediction; the 0.1 and smoothing-50 rows were better on held-out prediction, which was not used to choose). Costs against v2: sloppy two-pad sentence top-1 −1.0 on tune, bench.mjs sloppy one-pad −0.5 and rare words −2 (57 → 55); 3,000 dictionary words 0 changed, clean words 0, typo bench top-1 91.0 / 91.9 (was 90.8 / 91.3). The one real kept swipe that changed ("asserted" → "are") was swiped in "how … you doing today", so the new reading is probably what was meant.

### Gates

`node keyboard/bench/gates.mjs` (about 45 s on the workstation; `--fast` 27 s: sloppy swipe modes only, no tap bench; `--verbose` lists the passing checks) exits 1 if any of these fails: bench.mjs noiseless self-check ≥ 98 %, clean words auto-changed 0 (sentence bench, typo bench, tap bench), dictionary words 0/3000, game names ≤ 1/40, clean words shown first in `suggest()`, sentence swipe top-1 per mode and split and typo-bench top-1 / top-3 / fixed / mid-word top-3 at the v6 values minus 1 point (`FLOORS` in `gates.mjs`). Checked against a copy with `confMargin` and `knownLowMargin` 0: it failed with 143/3000 dictionary words and 3/40 names. Sentence-bench swipe seeds now depend on the mode, not its position in the list, so `--fast` reproduces the full numbers (default output unchanged).

### Evaluation set (eval-only)

`keyboard/bench/corpora/eval-corpus.txt`: 176 lines written for this on 2026-10-23 (texting, game chat, search-box queries, commands, 12 lines with contractions; sha256 `4d80c683…fd27b`), not drawn from `chat-corpus.txt` or the generated chat. Use it only to report, never to choose settings: `OSK_CORPUS=eval-corpus.txt node bench-sentences.mjs` (or `bench-typos.mjs`). Reported once, v5 + v2 data → v6 + v3 data:

| | v5, v2 data | v6, v3 data |
|---|---|---|
| sentence swipe top-1 one pad / two pads / sloppy one / sloppy two | 94.0 / 96.1 / 84.8 / 81.2 | 94.2 / 95.9 / 84.2 / 80.8 |
| phrase swipe top-1 one pad / sloppy two | 95.3 / 92.2 (n 64) | 95.6 / 93.4 (n 91) |
| next word top-1 / top-3 | 16.8 / 28.7 | 14.3 / 27.2 |
| run-together fixed | 85.6 (n 229) | 90.3 (n 247) |
| noisy taps fixed / made wrong | 50.0 / 2.8 | 48.7 / 2.8 |
| typos: row top-1 / top-3 / mid-word top-3 (v5: patch.js v15 row) | 90.6 / 91.1 / 29.1 | 90.5 / 97.7 / 78.4 |
| typos auto-fixed / made wrong | 77.1 / 1.8 | 77.1 / 1.8 |
| clean words changed; dictionary; names | 0; 0/3000; 1/40 | 0; 0/3000; 1/40 |
| clean words shown first | 100 | 99.9 ("potions" after "two": "options" first) |
| taps, big keys 1.5 / 2.5 mm, auto-fixed (made wrong) | | 60.1 (0.9) → 76.2 (1.5); 35.2 (4.5) → 48.6 (4.5) without → with taps |

The chat-only pair table predicts the next word worse on this mixed set (−2.5 top-1): its search and command lines are web text, which the dropped Web 1T pairs covered. Run-together and typo suggestions gain; swipes are within a point.

## Generated web, search and note text in the pair table (words.js v4, lm.js v4)

Why: the chat-only pair table (v3) predicted the next word worse on the eval set (16.8 → 14.3 top-1), whose search and command lines are web-like text.

Setup. `keyboard/build/gen-web.py` generated list-style text with Qwen3.5-9B-Base on a GPU workstation. The prompts are few-shot lists written for this: web searches, Steam store searches, app and settings search boxes, video searches, short emails, forum posts, Discord bot commands, store reviews, everyday notes and game-guide searches. They share no 4-word sequence with `chat-corpus.txt` or `eval-corpus.txt`. The run was stopped early: 11.5 minutes, 1,152 prompts, 22,922 lines kept (157,893 words; `keyboard/data/inputs/web-lines.txt.xz`), counted into `keyboard/data/inputs/web-bigrams.txt`. `build_words.py` mixes the two count tables as (1 − w) × chat + w × web scaled to the chat total (`OSK_WEB_WEIGHT`, default 0.3; 0 reproduces v3 byte for byte). New tune-only text set `keyboard/bench/corpora/tune-web-corpus.txt` (152 lines of searches, notes, emails, posts, reviews and commands, written for this, no 4-word overlap with the eval set). Weights were chosen on the chat tune split and this set only; all five variants ran in parallel (49 s), each with `gates.mjs --fast`.

| web weight | next word top-1 / top-3, chat tune | tune-web | run-together fixed, chat tune / tune-web | noisy taps fixed, tune-web | gates --fast |
|---|---|---|---|---|---|
| 0 (v3) | 21.0 / 34.0 | 9.8 / 21.0 | 96.7 / 79.2 | 49.5 | pass |
| 0.1 | 20.5 / 33.6 | 16.7 / 30.8 | 97.1 / 88.7 | 53.9 | fail: held-out typo fixed 80.7 < 81.0 |
| 0.2 | 20.0 / 33.8 | 19.0 / 33.5 | 97.1 / 89.5 | 54.3 | fail: same |
| **0.3** | 19.5 / 34.0 | 19.7 / 34.6 | 97.1 / 89.5 | 54.5 | pass |
| 0.5 | 19.3 / 34.0 | 22.5 / 35.8 | 97.1 / 90.2 | 54.9 | fail: held-out typo top-1 90.7 < 90.9 |

Winner: 0.3. It doubles next-word top-1 on the search/notes tune set for −1.5 on chat, passes every gate, and 0.5 also drops chat phrase swipe top-1 (96.7 → 93.4). The gate failures at 0.1, 0.2 and 0.5 are one held-out word each. Full gates with 0.3: 27 ok. Final chat-corpus numbers (tune; held-out): next word 19.5 / 34.0; 17.6 / 34.6, sentence swipe 92.9 / 95.6 / 83.8 / 80.8; 93.6 / 97.2 / 82.1 / 77.5, run-together 97.1; 96.3, 0/3000 dictionary words, 1/40 names.

Eval set, measured once for the chosen setting (v2 Web 1T data → v3 chat only → v4):

| | v2 | v3 | v4 |
|---|---|---|---|
| next word top-1 / top-3 | 16.8 / 28.7 | 14.3 / 27.2 | 16.9 / 29.2 |
| sentence swipe one pad / two pads / sloppy one / sloppy two | 94.0 / 96.1 / 84.8 / 81.2 | 94.2 / 95.9 / 84.2 / 80.8 | 94.1 / 95.9 / 83.9 / 80.7 |
| run-together fixed | 85.6 | 90.3 | 91.1 |
| noisy taps fixed / made wrong | 50.0 / 2.8 | 48.7 / 2.8 | 50.6 / 2.6 |
| typos: top-1 / top-3 / auto-fixed / made wrong | 90.6 / 91.1 / 77.1 / 1.8 (v5 row) | 90.5 / 97.7 / 77.1 / 1.8 | 90.3 / 98.0 / 79.0 / 1.7 |
| clean words shown first in `suggest()` | 100 | 99.9 | 99.8 |
| clean words changed; dictionary; names | 0; 0/3000; 1/40 | 0; 0/3000; 1/40 | 0; 0/3000; 1/40 |

Next-word prediction is back to the Web 1T level on the eval set, and the rest is level or better except sloppy swipes (−0.3 to −0.9 against v2) and two clean eval words now shown second in the suggestion row (autocorrect leaves them alone). Wall time: generation 12 min (stopped early), extraction 20 s, sweep 49 s, final build + reproducibility check + full gates + eval 1.5 min.

## Simulator suite speed (v17)

`keyboard/sim/test-all.sh` on the laptop (16 threads), all suites in parallel, seconds per suite. Before: v17 code with the old fixed sleeps (450 ms settle per scenario, 800-1000 ms after boot and injection, 300-800 ms after setting changes and keyboard reopen). After: condition waits (`inject`, `settle`, `waitKeyboard` in `keyboard/sim/run.mjs`), the panel opened directly where the hold itself is not under test, `robust-test`'s four pages run side by side, `inject-test` on a 250 ms injector cycle. Same scenarios and checks; `inject-test` grew from 5 to 12 checks and `robust-test` is new. After = three consecutive runs, all green.

| suite | before | after |
|---|---|---|
| test | 27.0 | 12.4-12.8 |
| echo-test | 25.3 | 16.0-16.5 |
| inject-test | 28.5 (5 checks) | 11.5-11.6 (12 checks) |
| input-test | 25.3 | 13.8-13.9 |
| modes-test | 21.7 | 13.4-13.6 |
| robust-test | 29.0 | 14.1-14.9 |
| settings-test | 49.2 | 18.9-19.1 |
| swipe-test | 32.4 | 19.2-19.6 |
| swipe-test WITH_MODES=1 | 32.6 | 19.3-19.7 |
| keyboard/bench/gates.mjs (engine, not changed here) | 42.5 | 40.6-41.8 |
| test-all.sh wall | 49 | 41-42 |

The wall time is now set by `keyboard/bench/gates.mjs`; the simulator suites all finish by about 20 s. Run alone, `test` takes 9 s, `swipe-test` 15 s and `settings-test` 14 s. Two waits stay fixed on purpose: long presses (600-620 ms against the 550 ms hold) and swipe pacing (8 ms between pad samples). Waiting on conditions exposed two real timings the old sleeps hid: Steam slides the keyboard in after reopening (so `waitKeyboard` waits for the space bar to stop moving), and a swipe within 220 ms of a tap joins it (so `settle` waits out that window unless told not to). `swipe-test` reads all key centres once per scenario, so a two-pad word keeps its strokes within the join window under load.

## Mid-word lookalikes and faster gates (engine v7)

Bug from UX inspection: typing "wor" made "or" the middle (autocorrect) chip instead of "work"/"world". Audit with and without a previous word (v6): "tod" → "to" confident, "ga" → "a" confident, "wo" → "so" confident, "the frie" → "fire" confident, "the hel" → "hell" confident, "the gam" → "game" confident, "wor" → "or" first. Each buffer is still the live start of a common word.

Fix. A buffer is a live prefix when its best completion (prefix list rescored with context, the same completion cost as `suggest()`) scores within `prefixMargin` of the best correction. Then corrections that neither extend the buffer nor only restore an apostrophe lose `prefixCorrPenalty` in both `correct()` and `suggest()`, the completion itself becomes a `correct()` candidate, and nothing is confident. A correction that only completes the buffer is not confident either. New `ctx.final`: autocorrect on space or punctuation passes `final: true` and keeps the old confidence rules (the reordering is off there, `prefixFinal: false`: with it, made-wrong rose 2.3 → 2.9 on the typo bench). The benches' autocorrect checks now pass `final: true`. New prefix cases in `bench-typos.mjs` (`PREFIX_CASES`, gated): wor (twice), wo, tod, ga, the frie, the hel, the gam, thin, goo, pla, th must show a completion or the typed word first, never the lookalike, and not be confident; realy, teh, agian must stay confident.

Grid (typo bench, tune; held-out did not move):

| prefixMargin, penalty | prefix cases | row top-1 | top-3 | mid-word top-3 | autocorrect fixed / wrong |
|---|---|---|---|---|---|
| v6 | (wor, tod, ga, wo fail) | 91.0 | 98.3 | 82.7 | 81.0 / 2.3 |
| 0.5, 2 | 12/15 | 91.0 | 98.3 | 83.2 | 81.0 / 2.3 |
| 1, 1 / 1, 2 / 1, 3 | 13/15 (tod, ga) | 90.6 | 98.3 / 98.3 / 98.1 | 82.7 / 83.2 / 83.2 | 81.0 / 2.3 |
| 2, 1 | 13/15 | 90.6 | 98.3 | 82.7 | 81.0 / 2.3 |
| 2, 2 | 15/15 | 90.0 | 98.1 | 83.2 | 81.0 / 2.3 |
| 2, 3 | 15/15 | 90.0 | 97.5 | 83.2 | 81.0 / 2.3 |
| **3, 2** | 15/15 | 90.2 | 98.1 | 83.2 | 81.0 / 2.3 |
| 3, 3 | 15/15 | 89.7 | 97.5 | 83.2 | 81.0 / 2.3 |

Winner: 3, 2. Costs: row top-1 on finished-word typos −0.8 (four words now show a completion first, the correction second). Sentence bench, dictionary, names and swipes are unchanged (they use `final: true` or do not call `correct()`). Without `final`, autocorrect is stricter: at the typo bench 78.2 % fixed instead of 81.0 % (endings like "invit", "gues", "bac" are not applied mid-word), so space and punctuation must pass `final: true`.

Gates speed. `gates.mjs` now splits its work into 24 independent tasks (per split and swipe mode, tap map and noise, plus self-check, dictionary and prefix cases), each with its own fixed seed as before, and runs them on worker threads (default: CPU threads − 1, at most 15; `--jobs N`); each worker builds the engine once and skips the timing loops gates never checked. Laptop (16 threads): full 33.5 s → 9.9 s (CPU 43 s → 81 s), `--fast` 7.3 s. The 28 check lines are identical to the sequential version (`diff` of sorted `--verbose` output), and a copy with autocorrect margins at 0 still fails (143/3000 dictionary words, 3/40 names).

## Permissive data without wordfreq (not adopted; `OSK_WORDFREQ=0`)

Goal: words.js and lm.js under permissive terms. Today they are CC BY-SA 4.0 only because their unigram frequencies (and lm.js's anchoring) come from wordfreq. The permissive build (`build_words.py`, `OSK_WORDFREQ=0`):
- Vocabulary: SCOWL 2020.12.07 sizes ≤ `OSK_SCOWL_MAX`, vendored as `keyboard/data/inputs/scowl-levels.txt.xz` with `SCOWL-COPYRIGHT.txt`; sizes 80–95 are excluded because of UKACD's notice terms. Plus the curated slang, brand and phrase lists.
- Frequency of a word: per-billion count in our generated chat and web lines (1.88M tokens, 16k types) × `OSK_CORPUS_SCALE`, plus a SCOWL-size prior 10^(A − B × rank), where rank is 0 for size 10 up to 7 for size 70.

The corpora see 78 % of size-10 words but only 10 % of size-35 and 3 % of size-50, so the prior decides most words. No new generation was run: tune-text coverage was already 98–99.5 %, and the failures below come from frequency calibration, not coverage. Every setting was chosen on gates (`--fast`), bench.mjs, and `bench-vocab.mjs`. That new bench takes all tokens of the tune texts (chat-corpus tune split + `tune-web-corpus.txt`) as the frequency-drawn sample and reports in-vocabulary rate and swipe top-1 without context. bench.mjs drew its common/rare test words from the dictionary it is testing, so for this comparison every run used the same set drawn from the current words.js (`OSK_TESTSET_WORDS`). That favours the current data by construction: words missing from the permissive list count as misses. Runs: 19 + 12 + 6 variants in parallel on the workstation, 4.3 + 3.0 + 2.9 min wall.

| setting (size ≤, A, B, corpus scale) | words | tune in vocab / top-1 one pad / sloppy two pads | bench.mjs fixed set top-1 touch / rare, tune; held | gates (`--fast`) failing |
|---|---|---|---|---|
| current (wordfreq) | 45,672 | 99.6 / 86.4 / 70.5 | 91.9 / 80; 88.9 / 80 | none |
| 35, 3.4, 0.2, 1 | 51,316 | 98.3 / 86.6 / 72.6 | 84.0 / 54; 81.6 / 53 | names 3/40 (overwatch, hollowknight, decky) |
| 50, 3.8, 0.2, 1 | 84,399 | 99.5 / 87.7 / 71.2 | 87.5 / 70; 84.7 / 71 | names 3/40, sloppy two pads tune 78.8 < 79.2, typo mid-word 80.7 < 81.7 |
| 50, 3.4, 0.35, 1 | 57,826 | 99.5 / 87.2 / 73.1 | 86.5 / 61; 83.2 / 58 | names 3/40 |
| 50, 3.4, 0.35, 0.5 | 57,669 | 99.5 / 87.2 / 72.9 | 85.3 / 60; 83.0 / 57 | names 2/40 |
| **50, 3.4, 0.35, 0.25** | 57,557 | 99.4 / 87.5 / 73.2 | 85.4 / 60; 82.5 / 57 | names 2/40 (hollowknight, decky → deck) |
| 50, 3.4, 0.35, 0.2 | 57,428 | 99.3 / 87.7 / 73.6 | 85.4 / 60; 81.6 / 55 | typo bench fixed tune 79.4 < 80.0 |
| 50, 3.4, 0.35, 0.15 | 57,184 | 99.3 / 87.6 / 73.3 | 85.4 / 60; 81.4 / 56 | typo fixed tune 78.9 < 80.0, held-out 80.4 < 81.0 |
| 50, 3.0, 0.35, 0.1 | 48,053 | 99.0 / 88.1 / 73.8 | 81.6 / 45; 80.0 / 49 | typo fixed both splits, clean shown first, prefix case "thin" |

The generated corpora over-count this project's topics: "watch" and "deck" get zipf 6.0 and 5.8 at corpus scale 1. That makes "decky" → "deck" and "overwatch" → "over watch" confident. Scaling the corpus down fixes the names but weakens typo correction, and no setting passes every gate. Best candidate (now the `OSK_WORDFREQ=0` defaults): size ≤ 50, A 3.4, B 0.35, corpus scale 0.25. Full gates: 27 ok, 1 failed (names 2/40, limit 1: "decky" → "deck" with margin 3.06 against the 3.0 threshold). bench.mjs's own self-check on the fixed wordfreq-drawn set is 93.3 % (gates' self-check on its own words passes) because some of those words are not in SCOWL ≤ 50.

Frozen eval set, measured once (current → candidate): sentence swipe 94.1 / 95.9 / 83.9 / 80.7 → 94.4 / 97.3 / 85.2 / 80.8 (4 eval tokens out of vocabulary); next word 16.9 / 29.2 → 16.3 / 28.4; run-together fixed 91.1 → 87.3; noisy taps fixed / wrong 50.6 / 2.6 → 50.9 / 1.7; clean words auto-changed 0 → 1 of 967; typo row top-1 / top-3 90.2 / 97.9 → 90.0 / 97.8, auto-fixed 79.0 → 79.2, mid-word top-3 79.5 → 85.1; eval tokens in vocab 100 → 99.6 %, no-context top-1 one pad / sloppy 85.3 / 69.3 → 84.4 / 72.2. Decoding is about 30 % slower (13.5 → 18.0 ms mean on the workstation) with 59,820 entries.

Decision: wordfreq stays the default (`OSK_WORDFREQ` defaults to 1; the default build still reproduces the shipped words.js v4 and lm.js v4 byte for byte), so words/lm versions are unchanged. The cost of switching to permissive data: one more game name auto-changed ("decky"), one clean eval word changed, −3.8 run-together fixes and −0.6 next-word top-1 on the eval set, and 30 % slower decoding; swipes and mid-word suggestions are level or better.
