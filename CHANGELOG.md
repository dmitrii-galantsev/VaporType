# Changelog

Every release since 0.2.7. Versions 0.2.9 and 0.2.10 were never published on their own; their changes ship in 0.3.0.
To update, install the same URL again (README, Install). Learned words and settings are kept. From 0.3.1 on, VaporType
updates itself.

## 0.3.2 — 2026-11-18

Keyboard v43, engine v12. To upgrade from 0.3.1, choose **Update with Decky…** in Quick Access → VaporType → Updates.
This release replaces the updater itself, so it needs one confirmation. Learned words and settings are kept.

- Two-thumb swipes handle short, imprecise landings better. First-choice accuracy on the held-out sloppy two-pad
  simulation rose from 77.5% to 84.9%; this is not a measurement of Deck typing accuracy.
- Hold the emoji key and open **System → Two-thumb practice** to try the handoff without typing into the active app.
- Hold **Esc** with a trackpad to toggle Private mode before typing, or switch it on in Quick Access → Privacy.
  A short tap still sends Escape.
- Turning off automatic updates cancels an install waiting for the keyboard to close. Future compatible frontend
  updates switch only after all files are on disk; backend changes go through Decky.
- Changing typing mode no longer redraws the keyboard behind Settings. Quick Access shows when settings are loading
  and prevents repeat presses while deleting typing data.

## 0.3.1 — 2026-11-16

Keyboard v42, engine v11, word pairs v6. Changes since 0.3.0.

### Updates

- **VaporType updates itself.** It checks GitHub releases about twice a day and installs a new version once the
  keyboard is closed, never while you type. One short notice says when it did; checks and failures stay quiet.
- Quick Access → VaporType → Updates shows the installed version and when it last checked, with a button to check or
  update now and a switch to turn automatic updates off.
- The keyboard's settings have the same Updates row under System.
- A release that changes how Decky loads the plugin is not installed on its own: the button reads "Update with Decky…"
  and Decky asks before installing.

### Fixes

- A quick LB or RB tap (Ctrl / Alt) made while a swiped word was still being typed, or before Steam had registered the
  press, could be lost or leave Ctrl or Alt held. It now goes out once, after any queued text.

## 0.3.0 — 2026-11-16

Keyboard v40, engine v11, word pairs v6. Changes since 0.2.8.

### New defaults

- **Learning is your choice.** The first-use card asks only "Learn the words you type?", and "Don't learn" is
  selected when it opens, so learning comes on only when you pick "Learn my words". Learning is off until then.
- Turning on Settings → Typing → Learn new words also counts as your answer, so the card does not come back.
- **Solid keyboard.** The keyboard background and the top strip are opaque by default. Lower Settings → Look → Keyboard
  background to see the game through it (#1).
- **Show typed text** is a normal setting, off by default, and no longer part of the first-use card.
- If you updated from 0.2 without answering the card, Show typed text is off. Answer the card first, then turn it on in
  Settings → Look; until the card is answered it turns off again at the next start.
- Installs that already answered the card keep their own learning, typed-text and look settings.

### Suggestions

- One word model ranks the whole suggestion row. Completions, corrections, split words and next words are all scored
  as how likely the word is after the previous word, mixing the dictionary, a word-pair table and what you type
  yourself, so the row leans toward your own words and phrases.
- Two words of context: the row looks at the last two words, from a new table of 25,000 common word triples.
- Word pairs you type often complete from the first letter of the second word.
- After Enter, and when the keyboard opens, the row offers the words you usually start a line with.
- The row follows the model's order. A correction takes the middle slot only when autocorrect is on and will apply
  it, and while a word is clearly still being typed, the left slot shows a third completion instead of the typed
  letters or "+ add".
- One-letter words are no longer offered as corrections.
- Words ended by Enter or by . ! ? are learned like words ended by Space (a line of a single word still is not).

### Keys and buttons

- **Win key** between Ctrl and Alt, for Windows PCs streamed with Moonlight (Win, Shift, S takes a partial
  screenshot). It works like Ctrl and Alt: tap for one key, double tap to lock.
- Ctrl, Win and Alt are as wide as a letter key; the space bar is 240 px.
- **LB / RB can pick suggestions**: Settings → Input → LB / RB is now Ctrl / Alt (default), Pick words, or Off. With
  Pick words, RB types the chip marked RB and LB the one marked LB, and after an autocorrection LB puts back what
  you typed.

### Fixes

- Backspace right after the space or comma that ended a word goes back into that word. Before, the first ending
  ("comr") was learned as a word and the rest ("e") as another; now only the finished word counts.
- The typing log no longer writes empty key-geometry records when the keyboard closes.
- Enter, Close and Done that hide the keyboard wait for the pad click to come up. Before, the keyboard closed with
  the click still held and Steam handed that click to the game: a stray mouse click on a pad set to mouse.
- A held Enter waits for every click pressed during the hold. A trigger used as a pad click could lose the Enter,
  and a second click during the hold could close the keyboard with that click held.
- Errors from the word engine are shown in the status line instead of being dropped.

### Docs

- README shows where the settings are and what Settings → Look → Keyboard background does (#1).
- The developer docs were cut by about a fifth: each fact is written once and checked against the code, and
  superseded measurements are gone (the decisions and their reasons stay).
- `docs/BAKEOFFS.md` has the replay of a real typing log before and after each suggestion change, and what was tried
  and not taken.

## 0.2.8 — 2026-10-28

- Denser two-column settings panel built for the trackpads: one bar of five tabs, every tab fits without scrolling,
  pads ring and preview the control they are on, sliders drag with a pad click.
- Look is split into Style and Opacity, with a live preview above the sliders.

## 0.2.7 — 2026-10-25

First public release: swipe typing, word suggestions, autocorrect and Esc / Ctrl / Alt keys for the Steam Deck's
on-screen keyboard, as a Decky Loader plugin. It also unregisters the input handlers Steam leaks every time its
keyboard opens, which otherwise make trackpad typing slower until Steam restarts.
