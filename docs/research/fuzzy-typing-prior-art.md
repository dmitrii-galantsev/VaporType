# Fuzzy typing: prior-art notes (source extracts)

Companion to `fuzzy-typing.md`. Everything here was read on 2026-10-23 from the sources linked; numbers are as
the sources state them, not measured by us.

## 1. AOSP LatinIME typing decoder (read in HeliBoard, which carries the AOSP native code unchanged)

The `aosp-mirror/platform_packages_inputmethods_LatinIME` GitHub mirror is gone (404). The same native code lives
in HeliBoard (`app/src/main/jni/src/suggest/...`, https://github.com/Helium314/HeliBoard) and in the LineageOS
fork (https://github.com/LineageOS/android_packages_inputmethods_LatinIME). The gesture decoder was never open
source (AOSP shipped a stub; HeliBoard loads Google's closed `libjni_latinime.so` for swipe).

### 1.1 How a tap becomes key likelihoods

- `ProximityInfo` gets every key's centre, size and an optional per-key "sweet spot" (centre offset + radius)
  from the layout's `touchPositionCorrectionData` (per-row offsets measured by Google).
- For each tap, `ProximityInfoState` keeps the squared distance from the tap to every key, normalised by the
  most common key width squared (`getPointToKeyLength`). Keys within one key width are "proximity chars" of the
  tap (`proximity_info_utils.h`: `distance < mostCommonKeyWidthSquare`).
- `TouchPositionCorrectionUtils::getSweetSpotFactor(x = normalised squared distance)`: piecewise linear,
  `0` at the sweet-spot centre, `0.24` at `x = 0.25` (half a key width), `1.2` at `x >= 1` (one key width), capped.
  A tap anywhere inside the central half-key therefore costs almost nothing for that key.
- `additional_proximity_chars.cpp`: for English, every vowel is an "additional proximity" of every other vowel
  (cost `ADDITIONAL_PROXIMITY_COST = 0.38`), regardless of geometry. Our `vowelCost` is the same idea.

### 1.2 Edit costs (`policyimpl/typing/scoring_params.cpp`, used in `typing_weighting.h`)

| event | LatinIME constant | value |
|---|---|---|
| spatial distance weight per matched tap | `DISTANCE_WEIGHT_LENGTH` × sweet-spot factor | 0.1524 × (0 … 1.2) |
| tap matched to a neighbouring key (not the primary) | `PROXIMITY_COST` (+ `FIRST_PROXIMITY_COST` once per word) | 0.0694 (+0.0779) |
| same, on the first letter | `FIRST_CHAR_PROXIMITY_COST` | 0.072 |
| vowel-for-vowel | `ADDITIONAL_PROXIMITY_COST` | 0.380 |
| substitution by a non-neighbour key | `SUBSTITUTION_COST` | 0.381 |
| omitted letter (word has a letter with no tap) | `OMISSION_COST` | 0.467 |
| omitted doubled letter ("leter") | `OMISSION_COST_SAME_CHAR` | 0.345 |
| omitted first letter | `OMISSION_COST_FIRST_CHAR` | 0.526 |
| apostrophe omission ("dont") | `INTENTIONAL_OMISSION_COST` | 0.1 |
| extra tap | `INSERTION_COST` | 0.725 |
| extra tap repeating previous letter | `INSERTION_COST_SAME_CHAR` | 0.551 |
| extra tap next to a proximity char | `INSERTION_COST_PROXIMITY_CHAR` | 0.674 |
| extra taps at the end | `TERMINAL_INSERTION_COST` per tap | 0.813 |
| transposition | `TRANSPOSITION_COST` + distance terms | 0.561 + … |
| missing space between two words | `SPACE_OMISSION_COST` | 0.1 |
| a tap near the space bar read as a space | `SPACE_SUBSTITUTION_COST` × distance to space | 0.33 × d |
| two-word result | `HAS_MULTI_WORD_TERMINAL_COST` | 0.348 |
| any proximity correction / any edit in the word | `HAS_PROXIMITY_TERMINAL_COST` / `HAS_EDIT_CORRECTION_TERMINAL_COST` | 0.068 / 0.036 |
| first completed letter beyond the input | `COST_FIRST_COMPLETION` | 0.484 |
| each further completed letter | `COST_COMPLETION` | 0.006 |
| language cost weight | `DISTANCE_WEIGHT_LANGUAGE` × improbability | 1.121 |

Shape of the model: a neighbour-key hit costs about a third of an omission and a fifth of an insertion; plain
substitutions/omissions/insertions are only explored while the accumulated normalised spatial distance is below
`NORMALIZED_SPATIAL_DISTANCE_THRESHOLD_FOR_EDIT = 0.095` (`TypingTraversal::allowsErrorCorrections`), so
precise taps also limit how many edits are tried. Completion is part of the same search: every prefix
hypothesis (with its proximity/edit costs) can be completed, which is how "lp" already shows "lol", "look".

### 1.3 Final score and the literal

`TypingScoring::calculateFinalScore`: `score = 1 - compoundDistance / (1.121 + 0.1 × inputSize)`;
`+1.1` (`EXACT_MATCH_PROMOTION`) when the candidate is exactly what was typed (−0.01 case, −0.02 accent, −0.03
digraph); for zero-probability "distracter" words only a perfect match is promoted (so "mt" gives "my", not
"Mt", unless typed "Mt").

### 1.4 When it auto-corrects (`Suggest.kt` / `Suggest.java`, `AutoCorrectionUtils.java`)

- `allowsToBeAutoCorrected`: the typed word has more than 1 letter and is **not in any dictionary**
  (or the top suggestion is whitelisted). A valid typed word is not auto-corrected (HeliBoard adds an n-gram
  exception: allowed only if the suggestion beats the typed word by 20 score points in the current context).
- Never auto-correct: correction off, word has digits, mostly-caps but not all caps, resumed/edited word, no main
  dictionary.
- Threshold: `calcNormalizedScore = (score / 1e6) × (1 − DamerauLevenshtein(typed, sugg) / len(sugg))`; auto-correct
  if `>= mAutoCorrectionThreshold`. AOSP values (`config-auto-correction-thresholds.xml`): modest `0.185`,
  aggressive `0.067`, very aggressive `-inf`. HeliBoard maps a 0–1 confidence slider to
  `0.5 − 0.5·c^0.33`.
- Undo: backspace right after a committed auto-correction restores the typed word (`revertCommit`; HeliBoard
  setting "Backspace reverts autocorrect").

### 1.5 Suggestion strip (`SuggestionStripLayoutHelper.getPositionInSuggestionStrip`)

Three slots. If the keyboard will auto-correct: middle = the auto-correction (what space commits), left of
centre = the typed word, then others. If not: middle = typed word, left = best correction. With the
Lollipop+ UI (`shouldOmitTypedWord`) the typed word is not shown at all while typing, the middle is the best
candidate and the rest alternate left/right.

## 2. FUTO Keyboard (LatinIME fork with a small transformer LM)

https://github.com/futo-org/android-keyboard, `native/jni/org_futo_inputmethod_latin_xlm_LanguageModel.cpp`.

- Each tap is decomposed into the 4 nearest keys with weights from `ProximityInfo::decomposeTapPosition`
  (weights < 0.05 dropped, renormalised); the LM is fed a weighted mix of the letter-token embeddings plus an
  (x, y) encoder, so the network sees "mostly p, some o" instead of "p".
- Decision rule (ratio test): auto-correct if `p(top1) > threshold × p(top2)`; "uncertain" if above
  `0.1 × threshold`; else "clueless" (no auto-correct). If the literal is among the results, every other result
  is demoted by 1.0 (exact-match rule). No auto-correct to a word less than half the typed length (tap mode).

## 3. Gboard (published)

- Beaufays & Riley, "The Machine Intelligence Behind Gboard", Google Research blog, 2017-05-24,
  https://research.google/blog/the-machine-intelligence-behind-gboard/ : earlier Gboard used a Gaussian spatial
  model for neighbouring keys plus a rule-based model for cognitive/motor errors (insertions, deletions, swaps);
  replaced by an LSTM-CTC "neural spatial model" trained on reverted auto-corrections (negative) and suggestion
  picks (positive): ~15% fewer bad autocorrects, 10% fewer wrongly decoded gestures offline. Decoding by FST
  (lexicon with optional apostrophes and optional spaces, n-gram LM), beam search.
- Ouyang, Rybach, Beaufays, Riley, "Mobile Keyboard Input Decoding with Finite-State Transducers", 2017,
  https://arxiv.org/abs/1704.03987 : per-letter tap error rate without decoding ~8–9%. Literal decoding: the
  typed letters are scored by a character-level model so an OOV literal can compete with corrections; an extra
  cost is applied for correcting away from an already valid word ("you're far" → "fat" is the example of an
  auto-corruption). Post-correction of the previous word using the next one: tap WER 6.31% (baseline) → 5.78%
  (FST) → 5.07% (FST + post-correction); gesture 11.90 → 11.51 → 9.20%. Recommended only within a short window
  and at high confidence.
- Sivek & Riley, "Spatial model personalization in Gboard", MobileHCI 2022, https://arxiv.org/abs/2209.11311 :
  Gaussian spatial model, σ in key units 0.55 before; per-user key-centre offsets learned from taps of committed
  words that were tap-typed and not edited afterwards; history of 800 taps in 4 buckets, 7 rectangular key
  clusters (greedy tree split); new σ 0.40–0.50 per language. Words-modified ratio −0.5 to −1.9%, WPM +0.2 to
  +0.6% in most locales. Personalised covariance gave nothing measurable. It also mentions a "key correction
  model" that decides when a press near a key boundary is forcibly read as the other key.
- Gboard decoder overview in "Neural Search Space in Gboard Decoder", 2024, https://arxiv.org/abs/2410.15575 :
  decoder = bikey-to-key transducer ∘ lexicon ∘ LM; key-correction and word auto-correction are separate
  functions.

## 4. Apple / iOS

- US 8,232,973 (Apple, 2012), "Method, device, and graphical user interface providing word recommendations for
  text input", https://patentimages.storage.googleapis.com/pdfs/US8232973.pdf : key icons with adjustable-size hit
  regions updated from the sequence typed so far; alternate character sequences scored, and a recommended word
  displayed when its probability meets criteria relative to the displayed one. Related: US 9,405,465 "Resizing
  predictive keyboard".
- Behaviour (Apple Support, https://support.apple.com/en-us/104995 and the iPhone User Guide): the QuickType bar
  shows the literal in quotes as one option; since iOS 17 a corrected word is temporarily underlined and tapping it
  offers the original; Delete right after a correction shows the original in the bar.

## 5. Academic work

| work | key idea | number reported |
|---|---|---|
| Goodman, Venolia, Steury, Wang, "Language modeling for soft keyboards", AAAI/IUI 2002, https://cdn.aaai.org/AAAI/2002/AAAI02-064.pdf | P(key \| pen position) × letter LM; per-key touch distributions are offset from key centres | error rate reduced by a factor of 1.67–1.87 |
| Gunawardana, Paek, Meek, "Usability guided key-target resizing", IUI 2010, https://www.microsoft.com/en-us/research/publication/usability-guided-key-target-resizing-for-soft-keyboards/ | aggressive resizing can make a word untypeable; "anchored" targets keep a core area of every key that always yields that key | significant keystroke-error reduction over unanchored resizing |
| Yin, Ouyang, Partridge, Zhai, hierarchical spatial backoff model, CHI 2013, https://groups.csail.mit.edu/mug/pubs/Yin2013Making.pdf | per-key → per-posture → per-user Gaussian models with backoff | ~11.5% (posture/key) and 13.2% (online posture classifier) error reduction |
| Azenkot & Zhai, touch behaviour by posture, MobileHCI 2012, https://research.google/pubs/touch-behavior-with-different-postures-on-soft-smartphone-keyboards/ | systematic per-key offsets that depend on thumb/finger | two thumbs 38.0 WPM vs one finger 25–31 |
| Henze, Rukzio, Boll, "100,000,000 taps", MobileHCI 2011 | global offset-compensation function | +2.6% speed, −7.7% errors (as summarised by Sivek & Riley) |
| Bi & Zhai, "Bayesian Touch", UIST 2013, https://dl.acm.org/doi/10.1145/2501988.2502058 | choose the target minimising a distance normalised by each target's touch variance plus its prior | — |
| Weir, Pohl, Rogers, Vertanen, Kristensson, "Uncertain text entry on mobile devices", CHI 2014, https://www.pokristensson.com/pubs/WeirEtAlCHI2014.pdf | GP touch-offset model + char LM decoder; pressure lets the user say "take this literally" | CER −7% vs baseline, −1.3% vs a commercial keyboard |
| Vertanen et al., VelociTap, CHI 2015, https://www.keithv.com/pub/velocitap/ | per-key 2D Gaussian (σ = key size × x/y scale), 12-gram char LM + 4-gram word LM, insertion/deletion hypotheses per tap, separate (cheaper) space-insertion penalty, OOV penalty, all tuned on dev data | lower error rate than Google's keyboard at the same entry rate; novices 41 WPM at 3% CER on a 40 mm wide keyboard |
| Kristensson & Zhai, SHARK2, UIST 2004, https://www.researchgate.net/publication/228875756 | gesture: shape + location channels against word templates, start/end pruning | (what our DTW engine already does) |
| Alsharif, Ouyang, Beaufays, Zhai, LSTM gesture decoding, ICASSP 2015, https://ieeexplore.ieee.org/document/7178336 | LSTM per-sample key posteriors + FST | — |
| Gordon, Ouyang, Zhai, WatchWriter, CHI 2016, https://dl.acm.org/doi/10.1145/2858036.2858242 | tap + gesture with statistical decoding on a tiny watch keyboard (closest analogue to 4×5 mm pad keys) | — |
| Dudley, Vertanen, Kristensson, VISAR (AR touch typing with decoder), TOCHI 2018, https://keithv.com/pub/visar/ ; Dudley et al., VR performance envelopes, ISMAR 2019, http://pokristensson.com/pubs/DudleyEtAlISMAR2019.pdf | decoder makes imprecise mid-air/surface taps usable | — |

## 6. Controllers and trackpads

No published statistical decoder for the Steam Controller or Steam Deck keyboard was found; Valve's keyboard maps
a pad position to the key under it. Community material is about practice and chorded layouts
(https://steamcommunity.com/app/353370/discussions/0/1489992713700283652/,
https://gist.github.com/Squidgical/d1d294d1ab7235d2cdcd5fac1800ac8b). Closest prior art: touchpad decoders in VR
and wearables (PalmBoard and BlindType, cited in TapGazer, CHI 2022,
https://dl.acm.org/doi/fullHtml/10.1145/3491102.3501838), WatchWriter, VISAR. Our own controller/pad prior art
is in `typing-modes.md`.
