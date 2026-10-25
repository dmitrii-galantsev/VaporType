# Data in swipe/ and where it comes from

Facts about the sources and their stated terms, collected on 2026-10-23. This is not legal advice.

## Summary

| file | built from | terms that apply |
|---|---|---|
| `words.js` (v4) | wordfreq 3.1.1 frequencies, filtered by SCOWL word lists; curated slang, brands and phrases written for this project; phrases mined from `chat-bigrams.txt` and `web-bigrams.txt` | CC BY-SA 4.0 (wordfreq data), with the SCOWL notices below |
| `lm.js` (v4) | conditional probabilities from `chat-bigrams.txt` and `web-bigrams.txt` (weight 0.3), multiplied by wordfreq frequencies of the first word | CC BY-SA 4.0 (contains values derived from wordfreq data) |
| `chat-bigrams.txt`, `web-bigrams.txt` | word-pair counts from chat lines and from search/notes/email/forum/command lines generated locally by Qwen3.5-9B-Base | generated for this project; proposed CC0 1.0 |
| `chat-corpus.txt`, `tune-web-corpus.txt`, `eval-corpus.txt`, `real-swipes.json`, `geometry.json` | written or recorded for this project | proposed CC0 1.0 |
| code (`engine.js`, `build_words.py`, benches) | written for this project | the project's code license |

No Google Web 1T / Norvig `count_2w.txt` data is used any more. `build_words.py` reads only wordfreq, the system word lists named below, `chat-bigrams.txt` and `web-bigrams.txt`.

## wordfreq

- Package: `wordfreq` 3.1.1 from PyPI (Robyn Speer), https://github.com/rspeer/wordfreq.
- Its README: the code is Apache-2.0, and "it includes data files that may be redistributed under a Creative Commons Attribution-ShareAlike 4.0 license" (https://creativecommons.org/licenses/by-sa/4.0/).
- wordfreq's data is built from Wikipedia, OPUS OpenSubtitles 2018, SUBTLEX (Brysbaert et al.; their condition: credit the SUBTLEX authors and keep it clear that SUBTLEX is freely available), Google Books Ngrams (acknowledgement and a link to http://books.google.com/ngrams appreciated), the Leeds Internet Corpus, ParaCrawl and Twitter streaming statistics.
- Citation requested by the author: Robyn Speer (2022), rspeer/wordfreq v3.0, Zenodo, https://doi.org/10.5281/zenodo.7199437.

What we did with it (the modification notice CC BY-SA asks for): `build_words.py` takes the top 200,000 English entries with `zipf_frequency`, drops entries below zipf 2.3 (higher floors for 3-5 letter words), entries not in the spelling lists below, a block list and dropped contraction spellings. It sets floors for 431 curated chat words, rounds every value to 0.1 zipf and adds phrases. `lm.js` stores, for each word pair a b, 10 × log10(f(a) × P(b | a) × 0.22), where f(a) is wordfreq's per-billion frequency of a and P comes from the chat counts mixed 0.7 / 0.3 with the web counts (each scaled to the chat total). Both files are therefore adapted material of wordfreq's data, and CC BY-SA 4.0 asks that they be shared under the same license with attribution.

## Spelling filters: SCOWL word lists

- `/usr/share/dict/american-english` and `/usr/share/dict/british-english`: Debian/Ubuntu packages `wamerican` and `wbritish` 2020.12.07, source package `scowl` (Kevin Atkinson, http://wordlist.sourceforge.net/).
- `/usr/share/hunspell/en_US.dic`: package `hunspell-en-us` 1:2020.12.07, built from the same SCOWL source.
- Their copyright file (`/usr/share/doc/wamerican/copyright`, `/usr/share/doc/hunspell-en-us/copyright`): SCOWL is "Copyright 2000-2011 by Kevin Atkinson" with a permission notice allowing use, copying, modification, distribution and sale "for any purpose ... provided that the above copyright notice appears in all copies and that both that copyright notice and this permission notice appear in supporting documentation". Parts come from public-domain sources (Moby Words II, 12Dicts, Brian Kelk's UK list). The Ispell-derived VARCON lists carry Geoff Kuenning's BSD-style notice, and the inflection data was made with WordNet 1.6 (Princeton's notice).
- The lists are used only to decide which wordfreq entries to keep and how they are capitalised; no list is copied into the output. A redistributor who considers that a use of the lists can include the SCOWL notice from the copyright file above.

## chat-bigrams.txt

- What it is: 206,227 lines `word1 word2<TAB>count`, word pairs counted from 252k chat lines (1.73M words).
- How the lines were made: `../build/gen.py` ran Qwen3.5-9B-Base (Alibaba Qwen team, Apache-2.0 according to the LICENSE in the checkpoint used and its model card, https://huggingface.co/Qwen/Qwen3.5-9B-Base) in bf16 on one workstation GPU for 72 minutes. The prompts are few-shot chat scenes written for this project (names, game titles and example lines are in `gen.py`). `../build/extract.py` cleaned the lines and kept tokens with a wordfreq zipf of at least 1.0, then counted the pairs.
- The generated text was not copied from any corpus; it does not include `chat-corpus.txt` (the generator never read it).
- Apache-2.0 places no restriction on the model's outputs. Proposed license for `chat-bigrams.txt` and the generated lines: CC0 1.0.

## web-bigrams.txt

- What it is: 42,095 lines `word1 word2<TAB>count` (134,971 pairs) counted from 22,922 lines (157,893 words), kept in `inputs/web-lines.txt.xz`.
- How the lines were made: `../build/gen-web.py` (uses `gen.py`'s generation loop) ran the same Qwen3.5-9B-Base checkpoint in bf16 on one workstation GPU for 11.5 minutes on 2026-10-23, from few-shot lists written for this project: web searches, Steam store searches, settings and app search boxes, video searches, short emails, forum posts, Discord bot commands, store reviews, everyday notes and game-guide searches. `extract.py ... bullets` cleaned them with the same rules as the chat lines.
- The prompt examples were checked to share no 4-word sequence with `chat-corpus.txt` or `eval-corpus.txt`.
- Proposed license for `web-bigrams.txt` and the generated lines: CC0 1.0, as for the chat counts.

## Permissive alternative (`OSK_WORDFREQ=0`, not the default)

`OSK_WORDFREQ=0 python3 build_words.py` builds words.js and lm.js without wordfreq. The numbers in them then come only from:

- `scowl-levels.txt.xz`: 168,600 entries `word<TAB>size<TAB>category` taken from SCOWL 2020.12.07 (`scowl-2020.12.07.tar.gz` from https://downloads.sourceforge.net/wordlist/, sha256 `5587667c…fb859cc`), lists `english|american|british-words|contractions|upper|proper-names` at sizes 10 to 70 only. Regenerate it with `OSK_SCOWL_IMPORT=<unpacked dir> python3 build_words.py`. Sizes 80 and 95 are left out because they add UKACD, whose notice asks for its copyright text to be "prominently displayed" and included verbatim. Sizes 70 and below come from public-domain sources (Moby Words II, 12Dicts, Brian Kelk's list), with inflections from SCOWL's database (WordNet 1.6 notice) and spelling variants from VarCon (Kevin Atkinson's notice and Geoff Kuenning's BSD-style Ispell notice). The full notice is `SCOWL-COPYRIGHT.txt` (verbatim from the tarball) and must ship with the vendored list and with data built from it.
- Word counts from our generated lines (`inputs/chat-lines.txt.xz`, `web-lines.txt.xz`), the curated slang/brand/phrase lists written for this project, and the pair counts above.
- The permissive build reads no `/usr/share/dict` list and no hunspell dictionary. (The default wordfreq build still filters with them: `wamerican`/`wbritish` are SCOWL size 50, hunspell `en_US` size 60, all under the same SCOWL notice.)

Proposed license line for a permissive release of the data: "words.js and lm.js: CC0 1.0 for the counts and lists written or generated for this project; word list from SCOWL by Kevin Atkinson et al., distributed under the notice in SCOWL-COPYRIGHT.txt." SCOWL's notice is permissive (use, copy, modify, distribute and sell for any purpose, keeping the notice), so the code can be MIT and the data needs only the notice. It is not the default because it fails one regression gate (BAKEOFFS.md, "Permissive data").

## Attribution text for a release

> Word frequencies from wordfreq by Robyn Speer (https://github.com/rspeer/wordfreq, doi:10.5281/zenodo.7199437), CC BY-SA 4.0, built from Wikipedia, OpenSubtitles, SUBTLEX (Brysbaert et al., freely available), Google Books Ngrams (http://books.google.com/ngrams), the Leeds Internet Corpus, ParaCrawl and Twitter statistics; filtered, rounded and extended with chat words and phrases for this keyboard. Word lists used for filtering: SCOWL by Kevin Atkinson. Word-pair statistics from chat, search and note text generated with Qwen3.5-9B-Base (Apache-2.0). words.js and lm.js are licensed CC BY-SA 4.0.
