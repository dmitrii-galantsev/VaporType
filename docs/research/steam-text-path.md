# Why "hello " arrives as "123456" over Moonlight, and how to type words

Sources: sp.js module 5363 (p5363.js), module 52077 (p52077.js), module 8844 (key constants),
library.js module 6739 (platform), gamescope src/ime.cpp (ime.cpp, master; same logic in 3.14.2, 3.15.0, 3.16.1).

## Root cause: gamescope, not Steam

ControllerKeyboardSendText(s) -> steamclient -> gamescope_input_method.set_string(s)+commit -> ime.cpp type_text(s).

```
if (utf8_size(text) == 1 && text[1] == '\0' && ime->keys.empty()) {   // fast path
    keysym = keysym_from_ch(text[0]);
    if (... try_type_keysym(ime, keysym)) return;   // real keycode from the current keymap (+Shift)
}
// otherwise: build a throwaway keymap, mapping each char to the next keycode of
allow_keycodes[] = { KEY_1, KEY_2, KEY_3, KEY_4, KEY_5, KEY_6, ..., KEY_Q, ... }
// press them, reset the keymap after 100 ms idle (reset_ime_keyboard clears ime->keys)
```

Moonlight sends scancodes, not keysyms, so "hello " (h,e,l,l,o,space; "ll" reuses one code) becomes KEY_1..KEY_6 = "123456" on Windows.
A single character also goes through the scratch keymap when it is not on the current layout (emoji, é) or when
**any multi-char/non-layout string was sent less than 100 ms earlier** (`ime->keys` non-empty). That is the
"OSK only sends 1" bug on Reddit u41dvg / Steam community thread 3269059787441411431.
Actions (Enter/Backspace/Delete/arrows) always use real keycodes (KEY_BACKSPACE etc.), also in a scratch keymap.

## Steam side

VirtualKeyboardManager (5363):
```
function C(k){switch(k){case"Backspace":k="\x02";case"Enter":k="\x01";case"Tab":k="\t";
  ArrowLeft "\x03", ArrowRight "\x04", ArrowUp "\x05", ArrowDown "\x06"}
  SteamClient.Input.ControllerKeyboardSendText(k)}
DispatchKeypress(A){this.OnTextEntered.Dispatch(A);const M=vrOverride??activeElementProps.onTextEntered;
  M?M(A):this.BUseVRKeyboard()?z(A):C(A)}          // z -> SteamClient.OpenVR.Keyboard.SendText (VR)
HandleVirtualKeyDown(A,shift): dead-key resolution, Enter/VKClose/VKDone/VKPaste, else DispatchKeypress(A)
SendClientPasteCommand(){const A=isMac()?LWin(102):LControl(103);
  SetKeyState(A,1);SetKeyState(V=25,1);SetKeyState(25,0);SetKeyState(A,0)}
```
Multi-char producers, all through HandleVirtualKeyDown -> ControllerKeyboardSendText (or OpenVR SendText in VR):
- OnCommitText(text) (IBus commit, CJK; Korean jamo remapped via `ut`) - whole string
- emoji keys (layoutState 2; surrogate pairs/ZWJ, after context.reset())
- HandleSpecialBehaviorForKey: emoticon `:name:`, sticker `/sticker name\r`, roomeffect `/roomeffect name\r`
- OnForwardKeyEvent: single char; OnDeleteSurroundingText(-n,n): n x HandleVirtualKeyDown("Backspace")
- HandleDeadKeyDown: one char at a time (charAt)
So Steam does send multi-char strings in Game Mode (IME commits, emoji, emoticons, stickers) and they hit
the same scratch-keymap path; Latin typing never does.

Single tap (TypeKeyInternal): key with length 1, not literal, not emoji ->
`context.process_key_event(charCode, parseFloat(data-keycode), shift?SHIFT_MASK:0)` on the IBus input context;
if not consumed -> HandleVirtualKeyDown(char, shift). The data-keycode only reaches IBus; SendText carries no keycode.
The real keycode the game sees comes from gamescope try_type_keysym.

SteamClient.Input keyboard-output methods in this build: ControllerKeyboardSendText(string),
ControllerKeyboardSetKeyState(EHIDKeyboardKey, bool) (HID usage: A=4..Z=29, 1=30.., Return 40, Esc 41,
Backspace 42, Tab 43, Space 44, Delete 76, LAlt 100, LShift 101, LWin 102, LControl 103),
SetGamepadKeyboardText(bSubmitted, text) (game-API OSK result only), plus OpenVR.Keyboard.SendText.
No SendKeyEvent/TypeText.

Typings: decky-frontend-lib src/globals/steam-client/Input.ts, BossSloth/SteamTypes, Millennium SDK,
ricewind012/steam-sharedjscontext-types. Related: gamescope issue #2311 documents the SendText -> ime.cpp path.
