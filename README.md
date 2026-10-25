# VaporType

A [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) plugin that adds swipe typing, word suggestions,
autocorrect and Esc / Ctrl / Alt keys to the Steam Deck's own on-screen keyboard. It also fixes a Steam bug that makes
trackpad typing slower every time the keyboard opens.

![Swiping "hello world" with both trackpads](docs/media/swipe.gif)

It patches Steam's keyboard while Steam runs, so a Steam update can break it. When the keyboard functions it needs
are missing, VaporType switches itself off.

## Install

Needs [Decky Loader](https://decky.xyz/) 3.0 or newer.

1. **...** → Decky → gear icon → General → turn on **Developer mode**.
2. Developer → **Install Plugin from URL**: enter `https://dmitrii-galantsev.github.io/VaporType/VaporType.zip`,
   press **Install** and confirm.
3. Open the keyboard (**STEAM + X**) and answer the first-use card.

Install the same URL again to update. Learned words and settings are kept.

## Typing

Each pad reaches just past the middle of the keyboard. Letters fill most of the pad; the other keys sit at its edges.

- **Tap**: click a pad on a letter, or tap the screen.
- **Swipe**: click and hold on the first letter, drag through the word, release. A word can start on one pad and
  continue on the other. Swiping also works on the touchscreen.
- **Suggestions**: pick a word above the keys with a pad, touch or D-pad + A. Space corrects a mistyped word;
  Backspace right after a correction restores your letters, right after a swipe deletes the word.
- **Cursor**: hold the space bar and slide.
- **Ctrl / Alt**: tap once for the next key, twice to lock. Hold LB / RB to hold Ctrl / Alt.
- **Settings**: hold the emoji key. For one-thumb typing choose Input → Pad reach → **Right pad only**.

| | |
|---|---|
| ![Typing "teh" and space corrects it to "the"](docs/media/autocorrect.gif) | ![Holding the space bar and sliding moves the cursor](docs/media/cursor.gif) |

## Privacy

Nothing leaves the Deck. Learning and the typed-text line stay off until you allow them on the first-use card.

- Learned words are kept in `~/homebrew/settings/vaportype/` and Steam's local storage. Settings → Words lists them; tap one to forget it.
- VaporType can't tell a password field from any other. Before typing a password, turn on **Private mode** (Settings
  → System, or hold the typed-text line): no learning, autocorrect, typed text or log.
- The typing log is off unless you turn it on (`~/homebrew/data/vaportype/typing-log.jsonl`).
- **Forget everything** (keyboard settings or Quick Access → VaporType) deletes learned words, backups and the log.

## Problems

- Quick Access → Decky → VaporType → turn off **Enabled** to get Steam's keyboard back at once. If that panel won't
  open, disable VaporType in Decky settings → Plugins and restart the Deck.
- Swiping, suggestions and autocorrect need English QWERTY. Ctrl / Alt pause swiping. The back grips don't work while the keyboard is
  open.
- [Open an issue](https://github.com/dmitrii-galantsev/VaporType/issues/new?template=bug_report.md) with the status
  lines from the Quick Access panel and your Steam update channel.

## Uninstall

Decky settings → Plugins → VaporType → **...** → Uninstall. Learned words stay for a reinstall unless you press
**Forget everything** first.

## License

Code: MIT, see [LICENSE](LICENSE).

<!-- data-license:start -->
Word data: `words.js` CC BY-SA 4.0 (wordfreq data), with the SCOWL notices in LICENSE; `lm.js` CC BY-SA 4.0 (contains values derived from wordfreq data). Attribution and sources: [DATA-LICENSES.md](keyboard/data/DATA-LICENSES.md).
<!-- data-license:end -->
