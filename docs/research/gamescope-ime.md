# gamescope IME vs Moonlight scancodes (2026-10-23)

Sources saved here: ime.cpp, wlserver.cpp (gamescope master aa289ea5; ime.cpp identical in 3.16.31),
mq-keyboard.cpp (moonlight-qt 781b26fd), sdl2-x11kb.c / sdl2-x11events.c (SDL2 8acf7cfc).

- type_text (ime.cpp:367-410): fast path only if string is ONE byte (ASCII) AND ime->keys empty;
  searches default keymap for the keysym at a level reachable with Shift/Ctrl/Alt -> real keycode (+LShift).
- Otherwise: each char gets keycode from allow_keycodes[] (ime.cpp:70-75) starting KEY_1 (evdev 2, X 10),
  consecutive identical char reuses keycode (152-156); generated keymap; press_key per char back-to-back.
- press_key (290-315): releases previously held key, then presses; 30 ms release timer.
- ime->keys cleared only by reset_ime_keyboard 100 ms after the LAST remap-path type_text (409, 556-565):
  single chars inside that window also take the remap path (digits).
- Moonlight maps SDL scancode -> VK (keyboard.cpp:246-252); ignores repeat keydowns (192-193).
- SDL2 X11 scancode from static key_layout chosen at init (x11keyboard 224-273), not from current keysym.
- SDL2 X11 autorepeat heuristic: KeyRelease followed by KeyPress of same keycode within <2 ms server time
  => release dropped, press is a repeat (x11events 159-165, 1169-1179). Back-to-back identical chars via IME
  (release+press in same dispatch) => second char lost in Moonlight unless gap > 30 ms release timer.
- Evidence: gamescope#2311 (Chinese commit shows "1"/"12", same path, confirms Steam JS chain);
  moonlight-qt#243 (shifted OSK chars lost, 2019, desktop); decktation PR#80 (40-char cap on gamescope typing).
- SetKeyState transport not verifiable from source (closed Steam). Hardware/uinput keys go through
  wlserver_key (wlserver.cpp:2726-2740), which re-selects default keymap but does not clear ime->keys.
