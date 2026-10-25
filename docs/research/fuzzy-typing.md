# Fuzzy typing: how phone keyboards forgive near misses, and what to copy

Research note from 2026-10-23. Parts of its assessment are superseded: tap coordinates now reach the engine.

Reported in testing: "if I don't swipe/tap exactly over the letter it doesn't suggest more likely corrections,
how a phone keyboard would. Typing lol as lpl should suggest lol."

Source extracts, constants and the full citation list are in `fuzzy-typing-prior-art.md`. Research date
2026-10-23. Numbers marked "measured" were run in this session against the engine as it was at 12:40 that day;
`engine.js`, `patch.js` and `bench-typos.mjs` were being changed by other sessions at the same time.

## 1. What our keyboard does today

| piece | what it does | where |
|---|---|---|
| swipe | DTW against key-centre templates, unigram prior + bigram LM, alternates from the same ranked list | `engine.decode` |
| tap correction | edit neighbourhood of the **typed letters** (keyboard-distance substitution `subBase + d²/(2·corrSigma²)`, vowels, transposition, omission, insertion, doubles, apostrophes, run-together split), scored against an "unknown literal" prior; margins gate suggestion, confident margins gate auto-apply | `engine.correct`, `edits` |
| strip while tapping | exact-prefix completions plus one correction from `correct()` (its `alts` are not shown) | `patch.js` `refreshSuggestions` |
| tap positions | used only by the composing modes (Fast taps, Columns: `modes.js tapTable`, Gaussian per tap). In Standard and Big letter keys (the default) `SW.tapPt` / `touchTap` reach only `mode.onKey`, which those modes do not have, so the decoder sees letters, never where the thumb landed | `patch.js` ~2090, `modes.js` |

Measured with the engine as of 12:40: `correct("lpl", {prev: "i"})` returned `null` (no suggestion), with no
previous word it returned "lol" (not confident), after "that" "lol" (confident). `correct("kol", {prev: "i"})` and
`correct("gelo", {prev: "i"})` returned nothing; `"lp"` had no completions at all. The cause is visible in the
costs: a one-key-over substitution costs `1.5 + 1/(2·0.45²) ≈ 4.0` nats, almost the same as an omission (4.5),
and the unknown literal "lpl" is given a zipf-2.3 prior, so a modest bigram penalty for "i lol" makes the literal
win and the strip shows nothing. LatinIME prices a neighbour-key hit at about a third of an omission (§2.1).

## 2. How the others do it

### 2.1 AOSP LatinIME (base of HeliBoard, OpenBoard, FUTO; Gboard's ancestor)

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

### 2.2 Gboard

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

### 2.3 iOS

- Hit regions of keys are resized from the predicted next letters (Apple US 8,232,973); the visible keys do not
  change. The QuickType bar always offers the literal in quotes; since iOS 17 corrected words are briefly
  underlined and tapping one offers the original; Delete right after a correction shows it too.

### 2.4 FUTO Keyboard

- Each tap is turned into a weighted mix of its 4 nearest keys (weights from tap position) and fed to a small
  transformer LM, so the model sees "mostly p, some o". Auto-correct on a ratio test `p1 > t·p2`; if the literal is
  among the results every other candidate is demoted; no auto-correct to a word under half the typed length.

### 2.5 Research

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

## 3. Techniques, evidence, and our status

| technique | evidence | ours |
|---|---|---|
| Gaussian spatial likelihood from the tap position | Goodman 2002 (1.67–1.87×), VelociTap, Gboard σ 0.4–0.55 key | Fast taps / Columns only; Standard and Big keys use letters |
| near-zero cost inside the key centre (sweet spot / anchoring) | LatinIME sweet spot; Gunawardana 2010 | no (no coordinates) |
| neighbour hit much cheaper than omission/insertion | LatinIME 0.15 vs 0.47 / 0.72 | 4.0 vs 4.5 / 5.0 nats |
| vowel-for-vowel substitution | LatinIME additional proximity | yes (`vowelCost`) |
| transposition, omission, insertion, doubled letters, apostrophe drop | LatinIME, Gboard rules, VelociTap | yes |
| missing space / run-together; tap near space read as space | LatinIME, Gboard optional-space FST, VelociTap | run-together yes; space substitution n/a on pads (Y is space) |
| fuzzy completion of a corrected prefix | LatinIME same search; Gboard | being added (bench-typos mid-word top-3 36% → 83% in the work in progress) |
| literal scored by a character model | Gboard; VelociTap OOV penalty | flat prior by length (`unknownZipf`, `unknownPerLetter`) |
| always show the best correction; threshold only for auto-apply | LatinIME, Gboard, iOS | correction hidden when margin < `corrMargin` |
| valid typed words protected; extra cost to correct away from them | LatinIME exact-match +1.1; Gboard | yes (`protectZipf`, known-word margins) |
| auto-apply threshold with ratio / normalised score | LatinIME 0.185, FUTO ratio test | yes (`confMargin`, `confMaxCost`, `ambMargin`), tuned in BAKEOFFS |
| backspace reverts, reverted word not corrected again | LatinIME, Gboard, iOS | yes (`undoAutocorrect`, `T.noCorrect`) |
| learn user words, train on reverts and picks | Gboard NSM training signal; all keyboards | user words and bigrams yes; reverts not used as training |
| per-user key offsets | Gboard 2022, Yin 2013, Henze 2011 | no |
| post-correction of the previous word | Gboard FST (tap WER −12% relative) | no |
| literal shown in the strip | iOS quotes, LatinIME left of centre | only as "+ word" for unknown words |
| swipe alternates from the decoder's n-best | Gboard, LatinIME | yes |

## 4. Recommendations, ranked

1. **Keep tap coordinates in Standard and Big letter keys and score corrections with them.** Record
   `{ch, x, y, side}` for every letter typed into `T.buf` (the data `SW.tapPt` / `touchTap` already have) and pass it
   to `correct()`. Replace the letter-centre substitution cost by the log-likelihood ratio of the tap under the
   intended key vs the literal key, using `modes.js tapTable` (σ ≈ 0.45–0.55 key, wider in x than y for the pads,
   as LatinIME's 1.1 / 0.95 and wider on the first and last tap). A tap on the o/p border then costs ~0 for "o",
   a tap in the middle of "p" stays expensive (built-in anchoring). Expected: "lpl" → "lol" whenever the thumb was
   near "o", fewer wrong corrections of precise taps. Measure: give bench-typos and bench-sentences a coordinate
   noise model (sample each tap from a Gaussian around the intended key, as the swipe benches do) and report
   fixed / made-wrong / top-3 for letters-only vs coordinates; clean words must stay at 0 false auto.
2. **Always fill the strip with corrections; use the margin only for auto-apply.** For an unknown literal show
   the top two or three candidates of `correct()` (including `alts`) even when the margin is below `corrMargin`,
   as LatinIME does for every non-dictionary word. Expected: "lpl" after "i" shows "lol". Measure: bench-typos
   "suggest top-3" on typos and "suggest top-1 = typed" on clean words (must stay 100%).
3. **Make neighbour-key hits cheap relative to edits.** Without coordinates, lower `subBase` and/or raise
   `corrSigma` so an adjacent key costs about a third of an omission (LatinIME ratio). Measured at 12:40 with
   bench-typos (tune split): `subBase` 1.5 → 0.75 moved auto-fixed 81.2 → 82.8%, made-wrong 2.5 → 2.7%, top-3
   98.3 → 98.7%; `corrSigma` 0.6: 82.0 / 2.5 / 98.5. Small, so this matters mostly together with 1. Re-tune with
   the BAKEOFFS autocorrect grid (false-auto 0 on 913 clean + 3,000 dictionary words, names).
4. **Fuzzy completion mid-word** (in progress elsewhere): complete corrected prefixes with LatinIME's shape
   (big cost for the first completed letter, tiny for the rest). Measure: bench-typos mid-word top-3, and
   keystrokes saved on bench-sentences.
5. **Score the literal with a letter n-gram model** instead of a flat zipf-by-length prior. "lpl", "gelo" are
   implausible letter strings and should lose to any nearby word; "warzone", "overwatch" are plausible and
   should keep their protection. A letter trigram model built from `words.js` (counts weighted by zipf) is small.
   Measure: bench-sentences noisy fixed vs made-wrong and the 40 game/app names.
6. **Strip layout like LatinIME/iOS:** middle = what space will commit; when that is a correction, the literal
   sits on the left (shown as typed, e.g. in quotes) so one pick restores it; right = next alternative. Same
   for swipes (already: middle = decoded word). Measure: sim `settings-test`/`echo-test` screenshots; picks
   per word in a scripted session.
7. **Learn from reverts and picks.** After a backspace-revert, add the literal to user words after a second use
   and down-weight that pair; after a strip pick of a correction, raise that word for the literal (Gboard trains
   on exactly these signals). Measure: replay a recorded session twice; second-pass auto-fixed and false-auto.
8. **Per-user pad offsets.** Keep the last 800 taps of words committed without edits, in 4 buckets, and learn
   per-cluster (≈7 clusters, per pad) mean offsets; σ may then shrink to 0.40–0.50. Thumbs on 32 mm pads likely
   have strong, consistent offsets (Azenkot & Zhai's posture effects). Measure: needs real deck taps; offline
   replay of logged taps, top-1 letter accuracy and bench-sentences with the learned offsets applied.
9. **Post-correct the previous word** only when the next word makes it much more likely and only one word back
   ("food luck" → "good luck"); Gboard reports a 12% relative WER cut. Must show it and allow undo. Measure:
   bench-sentences on two-word windows, false post-corrections on clean sentences must be 0.
10. **Swipes:** already n-best. Add near-shape twins (same template up to a straight segment: "pit/pot/put")
    explicitly to the alternates when the margin is small. Measure: bench.mjs top-3 on those pairs.

Already in place and worth keeping as is: vowel substitution, transposition/doubles/apostrophes, run-together
split, protection of frequent known words, conservative auto-apply grid, backspace undo.
