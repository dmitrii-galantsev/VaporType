# Fuzzy typing: how phone keyboards forgive near misses, and what to copy

Research note from 2026-10-23, written after a report from testing: "if I don't swipe/tap exactly over the letter it
doesn't suggest more likely corrections, how a phone keyboard would. Typing lol as lpl should suggest lol." Source
extracts, constants and the full citation list are in `fuzzy-typing-prior-art.md`. At the time the engine corrected
only the typed letters, a neighbour key cost about as much as an omission, and tap positions never reached it.

## 1. How the others do it

### 1.1 AOSP LatinIME (base of HeliBoard, OpenBoard, FUTO; Gboard's ancestor)

- The search runs on **tap coordinates**: every tap has a normalised squared distance to every key; keys within
  one key width are its proximity chars. A "sweet spot" function makes the cost ~0 inside the central half of a key
  and grows linearly to a cap at one key width; per-row sweet-spot offsets come from measured touch data.
- Costs (`scoring_params.cpp`): neighbour key 0.07 (+0.08 once per word) + 0.15 × spatial factor; vowel swap
  0.38; omission 0.47 (doubled letter 0.35, apostrophe 0.1); insertion 0.72 (repeat 0.55); transposition 0.56;
  missing space 0.1; tap read as space 0.33 × distance to the space key; first completed letter 0.48, each further
  letter 0.006; language weight 1.12. Edits other than proximity are only explored while the word's accumulated
  spatial distance is small (0.095), so precise taps are trusted.
- Completion is the same search: corrected prefixes are completed, so mid-word suggestions are fuzzy too.
- Literal: exact match gets +1.1 on a ~0–1 score scale. A word that is in the dictionary is never auto-corrected
  (HeliBoard: unless the context score gap is large); any non-dictionary word of 2+ letters may be.
- Auto-correct threshold on `score × (1 − DamerauLevenshtein/len)`: modest 0.185, aggressive 0.067.
  Never on words with digits, mostly-caps, or a resumed word. Backspace right after commit reverts.
- Strip: middle = what space commits (the auto-correction if any, else the literal); typed word left of centre
  when auto-correcting; newer UI hides the literal and shows the best three candidates.

### 1.2 Gboard

- Spatial model was a Gaussian over key distance plus rule-based insert/delete/swap; later an LSTM-CTC "neural
  spatial model" trained on reverted auto-corrections and suggestion picks (~15% fewer bad autocorrects).
  FST decoder: lexicon with optional apostrophes and optional spaces, n-gram LM, beam search, completions from
  the same hypotheses (Beaufays & Riley 2017; Ouyang et al. 2017).
- The literal is scored by a character-level model so OOV words compete fairly; correcting away from a valid word
  costs extra ("far" → "fat" is the named auto-corruption).
- Post-correction (revise the previous word once the next is typed) cut tap WER 5.78% → 5.07%, gesture
  11.51% → 9.20%; recommended only within a short window and at high confidence.
- Per-user key-centre offsets (800 taps, 4 buckets, 7 key clusters, from words committed by tap and not edited),
  σ 0.40–0.50 key widths instead of 0.55: words-modified −0.5…−1.9%, WPM +0.2…+0.6%; learned covariance did not
  help (Sivek & Riley 2022). A separate "key correction model" forces boundary presses onto the other key.

### 1.3 iOS

- Hit regions of keys are resized from the predicted next letters (Apple US 8,232,973); the visible keys do not
  change. The QuickType bar always offers the literal in quotes; since iOS 17 corrected words are briefly
  underlined and tapping one offers the original; Delete right after a correction shows it too.

### 1.4 FUTO Keyboard

- Each tap is turned into a weighted mix of its 4 nearest keys (weights from tap position) and fed to a small
  transformer LM, so the model sees "mostly p, some o". Auto-correct on a ratio test `p1 > t·p2`; if the literal is
  among the results every other candidate is demoted; no auto-correct to a word under half the typed length.

### 1.5 Research

- Goodman et al. 2002: P(key | touch) × letter LM cut soft-keyboard errors 1.67–1.87×; real touch distributions
  are offset from key centres.
- Gunawardana et al. 2010: resizing targets must stay "anchored" (a core of each key always yields that key),
  otherwise some words become untypeable.
- Yin et al. 2013 / Azenkot & Zhai 2012 / Henze 2011 / Weir et al. 2014: per-key, per-posture, per-user offsets
  help (≈7–14% error reduction); Weir adds a "take it literally" control (pressure).
- Bi & Zhai 2013, Bayesian Touch: pick the target with the smallest variance-normalised distance plus prior.
- VelociTap (Vertanen et al. 2015): per-key 2D Gaussian scaled by key size, insertion and deletion hypotheses per
  tap, a cheaper space-insertion penalty, an explicit OOV penalty, all tuned on recorded data; 41 WPM at 3% CER on
  a 40 mm keyboard, which is the closest analogue to our 4.2 × 5.3 mm pad keys (WatchWriter, Gordon et al. 2016,
  does the same on a watch).
- No controller or Steam keyboard with a statistical decoder was found; nearest are touchpad decoders in VR/AR
  (PalmBoard, BlindType, VISAR).

## 2. What was taken

| recommendation | evidence | status |
|---|---|---|
| Score corrections with tap coordinates (Gaussian per tap, wider in x than y) | Goodman 2002, VelociTap, Gboard σ 0.4–0.55 key, LatinIME sweet spot | done, engine v6 ([BAKEOFFS.md](../BAKEOFFS.md#tap-positions-in-correction)) |
| Always show the best corrections; use the margin only for auto-apply | LatinIME, Gboard, iOS | done, `suggest()` (engine v5) |
| Make a neighbour-key hit cheap relative to edits | LatinIME 0.15 vs 0.47 / 0.72 | done, `corrSigma` 0.55 (engine v5) |
| Fuzzy completion of a corrected prefix | LatinIME same search; Gboard | done, engine v5, with the live-prefix rules of v7 |
| Score the literal with a letter n-gram model | Gboard; VelociTap OOV penalty | rejected: more wrong corrections ([BAKEOFFS.md](../BAKEOFFS.md#wordlikeness-of-the-typed-word)); only `noVowelCost` kept |
| Strip: middle = what space commits, the literal on the left | LatinIME, iOS | done (suggestion row in [KEYBOARD.md](../KEYBOARD.md)) |
| Learn from reverts and picks | Gboard trains on both | partly: undoing an autocorrect or deleting a swiped word counts against that word |
| Per-user pad offsets | Gboard 2022, Yin 2013, Henze 2011 | not done: the Deck's taps are centred ([BAKEOFFS.md](../BAKEOFFS.md#typing-log-review-2026-10-30)) |
| Post-correct the previous word when the next makes it much likelier | Gboard (tap WER −12 % relative) | not done |
| Add near-shape twins ("pit/pot/put") to swipe alternates | | not done |

Kept as they were: vowel substitution, transposition, doubles and apostrophes, run-together split, protection of
frequent known words, the conservative auto-apply margins, Backspace undo.
