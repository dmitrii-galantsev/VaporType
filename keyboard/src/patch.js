(() => {
  const VERSION = 31;
  const prior = window.__oskTrackpadFix;
  if (prior?.version === VERSION && (!prior.stopped || prior.unsupported)) return prior.status();
  window.__oskTrackpadFix?.stop?.();

  const LPAD = 5;
  const RPAD = 6;
  const EDGE_PX = 80;
  const SLIDE_TOL = 12;
  const TOUCH = 4;
  const LPAD_CLICK = 20;
  const TRIGGER_LEFT = 7;
  const TRIGGER_RIGHT = 8;
  const RPAD_CLICK = 22;
  const JOIN_MS = 220;
  const WORD_COST = 12;
  const REWRITE_COST = 4;
  const SLICE_MS = 8;
  const SAME_KEY_GAP_MS = 100;
  const ARROW_GAP_MS = 45;
  const NAMED_KEY_GAP_MS = 100;
  const SHIFT_GAP_MS = 60;
  const CHORD_GAP_MS = 40;
  const KEY_GAP_MS = 30;
  const BACKSPACE_REPEAT_MS = 100;
  const HOLD_MS = 550;
  const LEARN_SWIPE_ZIPF = 3.5;
  const STALE_MS = 30000;
  const NEW_WORD_USES = 2;
  const PAD_SPAN = 0.55;
  const MOVE_KEYS = 0.55;
  const PAD_SETTLE_MS = 70;
  const PAD_FAST_MS = 120;
  const PAD_FAST_KEYS = 1.1;
  const PAD_FAR_KEYS = 1.5;
  const PREVIEW_MS = 350;
  const ECHO_KEEP = 240;
  const ECHO_SHOW = 60;
  const SLIDE_STEP = 0.5;
  const SLIDE_FAST_STEP = 0.25;
  const SLIDE_FAST = 1.5;
  const SLIDE_LAG_MS = 150;
  const SUG = "OSKSug_";
  const ECHO_KEY = "OSKEcho";
  const LS_KEY = "oskSwipeUserWords";
  const SPECIAL_TEXT = new Set([
    "Backspace",
    "Enter",
    "Tab",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "VKClose",
    "VKDone",
    "VKPaste",
    "VKMove",
    "Escape",
  ]);
  const BUMPER_LEFT = 5;
  const BUMPER_RIGHT = 6;
  const META = 4;
  const HELD = 4;
  const OK_BTN = 1;
  const CANCEL_BTN = 2;
  const DIRS = { 9: "up", 10: "down", 11: "left", 12: "right" };
  const TAB_STEP = { [BUMPER_LEFT]: -1, [BUMPER_RIGHT]: 1 };
  const PAGE_STEP = { [TRIGGER_LEFT]: -1, [TRIGGER_RIGHT]: 1 };
  const PANEL_SWALLOW = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20, 22]);
  const EMOJI = "SwitchKeys_Steam";
  const SET = "OSKSet_";
  const SETTINGS_KEY = "oskSwipeSettings";
  const DEFAULTS = {
    swipe: true,
    autocorrect: true,
    suggestions: true,
    learn: true,
    trail: true,
    autoSpace: true,
    removeAutoSpace: true,
    bumpers: true,
    echo: true,
    slideCursor: true,
    enterCloses: false,
    privateMode: false,
    typingLog: false,
    tipShown: false,
    consent: false,
    logFile: false,
    oneAspect: 2,
    reach: 55,
    deadzone: 100,
    theme: "modern",
    boardAlpha: 40,
    keyAlpha: 100,
    spaceAlpha: 30,
    stripAlpha: 90,
    blur: 0,
    mode: "bigkeys",
  };
  const TOGGLE_LABELS = [
    ["swipe", "Swipe typing", "Drag through the letters of a word on a pad or the screen"],
    ["autocorrect", "Autocorrect", "Space fixes a mistyped word; Backspace puts it back"],
    ["suggestions", "Suggestion row", "Three word guesses above the keys"],
    ["learn", "Learn new words", "Remembers words you type, only on this Deck"],
    ["trail", "Swipe trail", "Draws the path while you swipe"],
    ["autoSpace", "Automatic word spacing", "Spaces a swiped word from the word before it, and a letter tapped after a swipe"],
    ["removeAutoSpace", "Remove auto space before punctuation", "Punctuation or Enter right after a picked word drops its space"],
    ["bumpers", "LB / RB hold Ctrl / Alt", "Hold a bumper for a shortcut like Ctrl+C"],
    ["echo", "Show typed text", "What you type appears above the keys"],
    ["slideCursor", "Slide space bar to move cursor", "Hold the space bar and slide left or right"],
    ["enterCloses", "Enter closes keyboard", "Enter sends the text and hides the keyboard"],
    ["privateMode", "Private mode", "No learning, autocorrect, typing log or typed text"],
    ["typingLog", "Keep typing log", "Saves typed text to a file on this Deck for bug reports"],
  ];
  const PRIVATE_OFF = new Set(["learn", "autocorrect", "echo", "typingLog"]);
  const LOG_KEEP = 400;
  const SCAN_BASE_MS = 30000;
  const SCAN_MAX_MS = 600000;
  const CHOICES = {
    mode: [
      "Typing mode",
      [
        ["standard", "Standard", "Steam's layout", "Standard"],
        ["bigkeys", "Big letter keys", "Letters fill most of each pad", "Big keys"],
      ],
    ],
    reach: [
      "Pad reach",
      [
        [55, "Own half", "Each pad covers its side (Steam)"],
        [75, "Past the middle", "Each pad reaches three quarters across", "Past middle"],
        [100, "Whole keyboard", "Either thumb can swipe any word", "Whole"],
        ["right", "Right pad only", "The right pad covers the whole keyboard; the left pad keeps its half", "Right only"],
      ],
    ],
    deadzone: [
      "Swipe threshold",
      [
        [80, "Small", "A pad move 20 % shorter already starts a swipe"],
        [100, "Normal", "Resting or rolling thumbs do not start a swipe"],
        [130, "Large", "A pad move must go 30 % farther to start a swipe"],
      ],
    ],
    oneAspect: [
      "Full-width pad up/down",
      [
        [2, "Balanced", "Up/down moves half as far as sideways"],
        [1, "Even", "Same distance up/down as sideways"],
        [3, "Stretched", "Pad height covers the keyboard (Steam)"],
      ],
    ],
    theme: [
      "Theme",
      [
        ["modern", "Modern", "Rounded keys with gaps"],
        ["steam", "Steam", "Steam's original keyboard"],
        ["oled", "OLED", "Black keys"],
      ],
    ],
  };
  const percent = (v) => `${v} %`;
  const BLUR_PX = [0, 6, 16];
  const SLIDERS = {
    boardAlpha: {
      label: "Keyboard background",
      desc: "Behind the keys",
      min: 0,
      max: 100,
      step: 5,
      text: percent,
    },
    keyAlpha: { label: "Keys", desc: "Keys and symbols", min: 0, max: 100, step: 5, text: percent },
    spaceAlpha: { label: "Space bar", desc: "Bar and its text", min: 0, max: 100, step: 5, text: percent },
    stripAlpha: { label: "Top strip", desc: "Typed text and suggestions", min: 0, max: 100, step: 5, text: percent },
    blur: { min: 0, max: 2, step: 1 },
  };
  const GLASS = [
    "Glass",
    [
      [0, "Off", "The game shows through as it is"],
      [1, "Light", "Softly blurs the game behind the keyboard"],
      [2, "Strong", "Frosted glass; the heaviest to draw"],
    ],
  ];
  const LOOK_RESET = ["theme", "boardAlpha", "keyAlpha", "spaceAlpha", "stripAlpha", "blur"];
  const SLIDER_DELAY_MS = 400;
  const SLIDER_REPEAT_MS = 83;
  const STICK_DELAY_MS = 350;
  const STICK_REPEAT_MS = 125;
  const UNDO_MS = 5000;
  const PANEL_TABS = [
    ["typing", "Typing", "keys"],
    ["input", "Input", "pad"],
    ["look", "Look", "eye"],
    ["words", "Words", "book"],
    ["system", "System", "gear"],
  ];
  const PANEL_ROWS = {
    typing: [
      [["Keys", ["c_mode", "t_swipe", "t_suggestions"]]],
      [["Spelling", ["t_autocorrect", "t_learn", "t_autoSpace", "t_removeAutoSpace"]]],
    ],
    input: [[["Pads", ["c_reach", "c_oneAspect", "c_deadzone"]]], [["Buttons", ["t_slideCursor", "t_bumpers", "t_enterCloses"]]]],
    look: [
      [["Style", ["c_theme", "c_blur", "t_trail", "t_echo", "reset_look"]]],
      [["Opacity", ["preview", "s_boardAlpha", "s_keyAlpha", "s_spaceAlpha", "s_stripAlpha"]]],
    ],
    words: [[["", ["c_list", "words"]]]],
    system: [[["Privacy", ["t_privateMode", "t_typingLog", "clear_log", "forget_all"]]], [["Controls", ["help", "version"]]]],
  };
  const PANEL_MIN_H = 252;
  const PANEL_NARROW = 600;
  const PANEL_TINY = 420;
  const BLUE = "#0a74d6";
  const gearUrl = (fill) =>
    `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${fill}" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L14.9 3h-4l-.4 2.7a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.4 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.7h4l.4-2.7a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM12.9 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>`)}")`;
  const GEAR_LIGHT = gearUrl("#eef6ff");
  const GEAR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#9fd0ff" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L14.9 3h-4l-.4 2.7a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.4 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.7h4l.4-2.7a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM12.9 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>')}")`;
  const ICONS_SVG = {
    keys: "M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zm1 3v2h2V9zm4 0v2h2V9zm4 0v2h2V9zm4 0v2h2V9zM7 14v2h10v-2z",
    pad: "M7 7h10a5 5 0 0 1 0 10c-1.6 0-2.5-1-3.3-2h-3.4c-.8 1-1.7 2-3.3 2A5 5 0 0 1 7 7zm0 3v1.5H5.5v1H7V14h1v-1.5h1.5v-1H8V10zm9 .5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm2 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z",
    eye: "M12 5c5 0 9 4.5 10 7-1 2.5-5 7-10 7S3 14.5 2 12c1-2.5 5-7 10-7zm0 3.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z",
    book: "M3 5h7a2 2 0 0 1 2 1.5A2 2 0 0 1 14 5h7v14h-7a2 2 0 0 0-2 1 2 2 0 0 0-2-1H3zm2 2v10h5a3 3 0 0 1 1 .2V7.5A1 1 0 0 0 10 7zm9 0a1 1 0 0 0-1 .5v9.7a3 3 0 0 1 1-.2h5V7z",
    gear: "M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L14.9 3h-4l-.4 2.7a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.4 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.7h4l.4-2.7a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM12.9 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z",
  };
  const LOOK = new Set(["theme", "reach", "bumpers"]);
  const LIST_PAGE = 12;
  const LEARNED_MAX = 1000;

  const K_LALT = 100;
  const K_LSHIFT = 101;
  const K_RSHIFT = 105;
  const K_LCTRL = 103;

  const ESC_KEY = { key: "Escape", label: "#Key_Escape", type: META, strLocDescription: "#KeyboardKey_Escape" };
  const MOD_KEYS = [
    { key: "Control", label: "#Key_Control", type: META, strLocDescription: "#KeyboardKey_LControl" },
    { key: "Alt", label: "#Key_Alt", type: META, strLocDescription: "#KeyboardKey_LAlt" },
  ];
  const SUG_KEYS = [0, 1, 2].map((i) => ({ key: SUG + i, label: () => T.labels[i] ?? "", type: META }));
  const TOGGLES = new Set(["Shift", "CapsLock", "Control", "Alt", "AltGr"]);

  const HID = {
    Enter: [40],
    Escape: [41],
    Backspace: [42],
    Tab: [43],
    " ": [44],
    ArrowRight: [79],
    ArrowLeft: [80],
    ArrowDown: [81],
    ArrowUp: [82],
  };
  const addKeys = (chars, first, shift) => [...chars].forEach((c, i) => (HID[c] = [first + i, shift]));
  addKeys("abcdefghijklmnopqrstuvwxyz", 4, false);
  addKeys("ABCDEFGHIJKLMNOPQRSTUVWXYZ", 4, true);
  addKeys("1234567890", 30, false);
  addKeys("!@#$%^&*()", 30, true);
  addKeys("-=[]\\", 45, false);
  addKeys("_+{}|", 45, true);
  addKeys(";'`,./", 51, false);
  addKeys(':"~<>?', 51, true);

  const active = (v) => (v & 7) !== 0;
  const releaseOneShot = (v) => {
    const t = v & 3;
    return (t === 1 ? 0 : t) | (v & HELD);
  };

  const state = {
    version: VERSION,
    bumpers: {},
    pending: {},
    blocked: (window.__oskBlocked ??= new Set()),
    swipeLog: (window.__oskSwipeLog ??= []),
    timer: null,
    protoPatched: false,
    layouts: 0,
    sent: new Map(),
    windows: new Set(),
    wrapped: [],
    keycodes: [],
    statics: [],
    props: [],
    checked: new WeakSet(),
    errors: [],
    swipeOn: true,
  };
  const T = {
    buf: "",
    taps: [],
    prev: null,
    lastOut: "unknown",
    auto: false,
    fromSwipe: null,
    labels: [],
    sugs: [],
    mode: null,
    current: -1,
  };
  const SL = { s: null, dropped: 0 };
  const SW = {
    kb: null,
    strokes: [],
    held: {},
    swallow: {},
    gesture: false,
    timer: null,
    finishing: null,
    preview: null,
    previewAt: 0,
    touch: null,
    recent: null,
    typing: false,
  };
  const note = (e) => {
    state.errors.push(String(e?.message ?? e));
    if (state.errors.length > 10) state.errors.shift();
  };

  function cleanSettings(s) {
    const out = { ...DEFAULTS };
    if (typeof s?.opacity === "number" && !("boardAlpha" in s) && !("keyAlpha" in s) && !("stripAlpha" in s))
      s = { ...s, ...fromOpacity(s.opacity, s.theme) };
    if (s && typeof s === "object" && !("consent" in s)) out.consent = true;
    for (const k of Object.keys(DEFAULTS)) if (validSetting(k, s?.[k])) out[k] = s[k];
    if (s?.onePad === true) out.reach = "right";
    return out;
  }

  function fromOpacity(opacity, theme) {
    const a = Math.min(1, Math.max(0.8, opacity / 100));
    const round5 = (x) => Math.min(100, Math.max(0, Math.round(x * 20) * 5));
    const board = a < 1 ? Math.max(0, a - 0.5) + (theme === "oled" ? 0.3 : 0) : 1;
    return { boardAlpha: round5(board), keyAlpha: round5(a + (1 - a) * 0.9), stripAlpha: round5(Math.max(0.9, a)) };
  }

  function validSetting(k, v) {
    const sl = SLIDERS[k];
    if (sl) return Number.isInteger(v) && v >= sl.min && v <= sl.max && (v - sl.min) % sl.step === 0;
    return CHOICES[k] ? CHOICES[k][1].some(([x]) => x === v) : typeof v === "boolean";
  }

  const stampOf = (s) => (Number.isFinite(s?.at) ? s.at : 0);

  function loadSettings() {
    const file = window.__oskUserWords?.settings;
    let local = null;
    try {
      local = JSON.parse(window.localStorage?.getItem(SETTINGS_KEY) ?? "null");
    } catch (e) {}
    const s = file && (!local || stampOf(file) >= stampOf(local)) ? file : (local ?? file);
    window.__oskSettingsAt = settingsAt = stampOf(s);
    return cleanSettings(s);
  }

  let settingsAt = window.__oskSettingsAt ?? 0;
  const settings = (window.__oskSettings = cleanSettings(window.__oskSettings ?? loadSettings()));
  const eff = (name) =>
    settings.privateMode && PRIVATE_OFF.has(name)
      ? false
      : !settings.consent && (name === "learn" || name === "echo")
        ? false
        : settings[name];
  const SUPPORTED_LAYOUTS = new Set(["qwerty", "qwerty_int"]);
  const layoutSupported = (layout = state.layoutApi?.current?.()) => SUPPORTED_LAYOUTS.has(layout?.name);
  state.settings = settings;
  state.swipeOn = settings.swipe;
  const P = {
    open: false,
    kb: null,
    el: null,
    tab: "typing",
    list: "learned",
    page: 0,
    confirm: 0,
    focus: null,
    rows: null,
    padDown: {},
    held: new Set(),
    aDown: false,
    touch: null,
    slide: null,
    rep: null,
  };

  function setKey(code, down) {
    if (!!state.sent.get(code) === down) return;
    try {
      SteamClient.Input.ControllerKeyboardSetKeyState(code, down);
    } catch (e) {
      note(e);
      return;
    }
    if (down) state.sent.set(code, true);
    else state.sent.delete(code);
  }

  function tapKey(code, shiftCode) {
    const I = SteamClient.Input;
    try {
      if (shiftCode) I.ControllerKeyboardSetKeyState(shiftCode, true);
      try {
        I.ControllerKeyboardSetKeyState(code, true);
      } finally {
        I.ControllerKeyboardSetKeyState(code, false);
      }
    } finally {
      if (shiftCode) I.ControllerKeyboardSetKeyState(shiftCode, false);
    }
  }

  function isAccessor(obj, name) {
    for (let o = obj; o; o = Object.getPrototypeOf(o)) {
      const d = Object.getOwnPropertyDescriptor(o, name);
      if (d) return !!(d.get || d.set);
    }
    return false;
  }

  function wrap(obj, name, make) {
    if (isAccessor(obj, name)) return false;
    const cur = obj[name];
    if (cur?.__oskVersion === VERSION) return false;
    const orig = cur?.__oskOrig ?? cur;
    const f = make(orig);
    f.__oskOrig = orig;
    f.__oskVersion = VERSION;
    obj[name] = f;
    state.wrapped.push([obj, name, orig]);
    return true;
  }

  function webpackRequire() {
    if (window.__oskReq) return window.__oskReq;
    let req;
    window.webpackChunksteamui?.push([
      [`osk-${Math.random()}`],
      {},
      (r) => {
        req = r;
      },
    ]);
    if (req) window.__oskReq = req;
    return req;
  }

  const INPUT_REGISTERS = [
    ["Input", "RegisterForControllerInputMessages", "HandleControllerInputMessages"],
    ["Input", "RegisterForControllerAnalogInputMessages", "HandleControllerInputMessages"],
    ["System.UI", "RegisterForSystemKeyEvents", "HandleSystemKeyEvents"],
  ];
  const INPUT_IDLE = ["OnAnalogPad", "OnButtonDown", "OnButtonUp", "OnSystemButtonPress"];
  const inputRegs = (window.__oskInputRegs ??= new WeakMap());

  function steamApi(path) {
    let o = window.SteamClient;
    for (const k of path.split(".")) o = o?.[k];
    return o;
  }

  function trackInputRegisters() {
    for (const [path, name] of INPUT_REGISTERS) {
      const api = steamApi(path);
      if (typeof api?.[name] !== "function") continue;
      wrap(
        api,
        name,
        (orig) =>
          function (fn, ...rest) {
            const h = orig.call(this, fn, ...rest);
            if (typeof fn === "function" && typeof h?.unregister === "function") {
              const hs = inputRegs.get(fn);
              if (hs) hs.add(h);
              else inputRegs.set(fn, new Set([h]));
            }
            return h;
          },
      );
    }
  }

  function ownValue(obj, name) {
    const d = Object.getOwnPropertyDescriptor(obj, name);
    return typeof d?.value === "function" ? d.value : null;
  }

  function releaseInput(inp) {
    if (!inp || typeof inp !== "object" || inp.__oskReleased) return;
    inp.__oskReleased = [];
    for (const [, , method] of INPUT_REGISTERS) {
      const fn = ownValue(inp, method);
      const hs = fn && inputRegs.get(fn);
      if (!hs) continue;
      for (const h of hs) {
        try {
          h.unregister();
        } catch (e) {
          note(e);
        }
      }
      inputRegs.delete(fn);
      inp.__oskReleased.push(method);
    }
    for (const k of INPUT_IDLE) {
      if (typeof inp[k] !== "function") continue;
      Object.defineProperty(inp, k, { value: () => {}, configurable: true, writable: true });
    }
    state.inputReleased = (state.inputReleased ?? 0) + 1;
  }

  function reviveInput(inp) {
    const done = inp?.__oskReleased;
    if (!done) return;
    delete inp.__oskReleased;
    for (const k of INPUT_IDLE) delete inp[k];
    for (const [path, name, method] of INPUT_REGISTERS) {
      const fn = ownValue(inp, method);
      if (!fn || !done.includes(method)) continue;
      try {
        steamApi(path)?.[name]?.(fn);
      } catch (e) {
        note(e);
      }
    }
  }

  function hookLifecycle(proto, name, before, after) {
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (!d?.configurable || d.value?.__oskVersion === VERSION) return;
    const orig = d.value?.__oskOrig ?? proto[name];
    if (typeof orig !== "function") return;
    const run = (hook, self) => {
      try {
        hook?.(self);
      } catch (e) {
        note(e);
      }
    };
    const f = function (...args) {
      run(before, this);
      try {
        return orig.apply(this, args);
      } finally {
        run(after, this);
      }
    };
    f.__oskOrig = orig;
    f.__oskVersion = VERSION;
    Object.defineProperty(proto, name, { value: f, writable: true, configurable: true, enumerable: d.enumerable });
    state.props.push(() => {
      if (proto[name] === f) Object.defineProperty(proto, name, d.value?.__oskOrig ? { ...d, value: orig } : d);
    });
  }

  function hookInputRelease(proto) {
    hookLifecycle(proto, "componentWillUnmount", null, (kb) => releaseInput(kb.m_trackpadInput));
    hookLifecycle(proto, "componentDidMount", (kb) => reviveInput(kb.m_trackpadInput), null);
  }

  function scanDue(name) {
    const sc = ((state.scans ??= {})[name] ??= { n: 0, at: -Infinity });
    const now = performance.now();
    const wait = sc.n < 4 ? (sc.n ? SCAN_BASE_MS : 0) : Math.min(SCAN_MAX_MS, SCAN_BASE_MS * 2 ** (sc.n - 3));
    if (now - sc.at < wait) return false;
    sc.n++;
    sc.at = now;
    return true;
  }

  function findLayoutApi() {
    if (state.layoutApi) return state.layoutApi;
    if (!scanDue("layout")) return null;
    const req = webpackRequire();
    if (!req) return null;
    for (const id of Object.keys(req.m)) {
      const src = Function.prototype.toString.call(req.m[id]);
      if (!src.includes("#KeyboardLayout_QWERTY") || !src.includes("rgLayout")) continue;
      let mod;
      try {
        mod = req(id);
      } catch (e) {
        continue;
      }
      const api = {};
      for (const name of Object.keys(mod)) {
        const fn = mod[name];
        if (typeof fn !== "function" || fn.length !== 0) continue;
        let out;
        try {
          out = fn();
        } catch (e) {
          continue;
        }
        if (typeof out?.rgLayout === "function") api.current = fn;
        else if (Array.isArray(out) && out.length && out.every((l) => typeof l?.rgLayout === "function")) api.enabled = fn;
      }
      if (api.current) return (state.layoutApi = api);
    }
    return null;
  }

  function isBottomRow(row) {
    return row.some((x) => (Array.isArray(x) ? x : [x]).some((k) => k && typeof k === "object" && k.key === " "));
  }

  function patchLayouts() {
    const api = findLayoutApi();
    if (!api) return;
    const all = new Set([api.current()]);
    try {
      for (const l of api.enabled?.() ?? []) all.add(l);
    } catch (e) {
      note(e);
    }
    for (const layout of all) {
      if (!layout || typeof layout.rgLayout !== "function") continue;
      const changed = wrap(
        layout,
        "rgLayout",
        (orig) =>
          function (opts) {
            const rows = orig.call(this, opts);
            const last = rows.length - 1;
            if (last < 1 || !isBottomRow(rows[last]) || rows[last].some((x) => x?.key === "Control")) return rows;
            if (!state.tickSoon) {
              state.tickSoon = true;
              setTimeout(() => {
                state.tickSoon = false;
                tick();
              }, 0);
            }
            return [
              ...(settings.suggestions && layoutSupported(layout) ? [[...SUG_KEYS]] : []),
              [ESC_KEY, ...rows[0]],
              ...rows.slice(1, last),
              [...MOD_KEYS, ...rows[last]],
            ];
          },
      );
      if (Array.isArray(layout.rgKeycodes) && !layout.rgKeycodes.__osk) {
        state.keycodes.push([layout, layout.rgKeycodes]);
        layout.rgKeycodes = buildCodes(layout.rgKeycodes, layout);
      }
      if (changed) state.layouts++;
    }
  }

  function buildCodes(orig, layout) {
    const codes = orig.map((r) => r);
    const last = codes.length - 1;
    if (last >= 1 && Array.isArray(codes[last]) && Array.isArray(codes[0])) {
      codes[0] = [0, ...codes[0]];
      codes[last] = [...MOD_KEYS.map(() => 0), ...codes[last]];
      if (settings.suggestions && layoutSupported(layout)) codes.unshift(SUG_KEYS.map(() => 0));
    }
    codes.__osk = true;
    return codes;
  }

  function relayout() {
    for (const [layout, orig] of state.keycodes) layout.rgKeycodes = buildCodes(orig, layout);
    for (const doc of documents()) {
      const kb = findKeyboard(doc);
      if (!kb) continue;
      setFocusRow(kb);
      dropGeometry(kb);
      try {
        if (state.layoutApi) kb.setState({ standardLayout: state.layoutApi.current() });
        kb.forceUpdate(() => {
          if (P.open && P.kb === kb) placePanel();
        });
      } catch (e) {
        note(e);
      }
    }
  }

  function setFocusRow(kb) {
    const C = kb.constructor;
    if (!C || typeof C.s_initialFocusRow !== "number") return;
    if (state.focusRow === undefined) {
      if (C.s_initialFocusRow !== 2) return;
      state.focusRow = 2;
      state.statics.push([C, "s_initialFocusRow", 2]);
    }
    C.s_initialFocusRow = state.focusRow + (settings.suggestions && layoutSupported() ? 1 : 0);
  }

  function setRepeat(kb) {
    const C = kb.constructor;
    if (!C || typeof C.s_longPressRepeatThreshold !== "number") return;
    if (state.repeatMs === undefined) {
      state.repeatMs = C.s_longPressRepeatThreshold;
      state.statics.push([C, "s_longPressRepeatThreshold", state.repeatMs]);
    }
    if (C.s_longPressRepeatThreshold !== BACKSPACE_REPEAT_MS) C.s_longPressRepeatThreshold = Math.min(state.repeatMs, BACKSPACE_REPEAT_MS);
  }

  function findKeyboard(doc) {
    const key = doc?.querySelector?.("[data-key]");
    if (!key) return null;
    const fk = Object.keys(key).find((k) => k.startsWith("__reactFiber"));
    for (let f = fk && key[fk]; f; f = f.return) {
      const s = f.stateNode;
      if (s && typeof s.HandleTrackpadClick === "function") return s;
    }
    return null;
  }

  function documents() {
    const docs = new Set();
    const store = window.SteamUIStore;
    const add = (w) => {
      try {
        if (w?.BrowserWindow?.document) docs.add(w.BrowserWindow.document);
      } catch (e) {}
    };
    add(store?.ActiveWindowInstance);
    try {
      for (const w of store?.WindowStore?.SteamUIWindows ?? []) add(w);
    } catch (e) {}
    return [...docs];
  }

  function isOpen(kb) {
    if (!kb?.m_keyboardDiv?.isConnected) return false;
    if (kb.m_keyboardDiv.ownerDocument?.visibilityState === "hidden") return false;
    const showing = kb.props?.VirtualKeyboardManager?.m_bIsVirtualKeyboardShowing;
    return showing?.Value !== false;
  }

  function openKeyboards() {
    const out = [];
    for (const doc of documents()) {
      const kb = findKeyboard(doc);
      if (kb && isOpen(kb)) out.push(kb);
    }
    return out;
  }

  function syncHeld(kbs = openKeyboards()) {
    let ctrl = false,
      alt = false;
    for (const kb of kbs) {
      const ts = kb.state?.toggleStates ?? {};
      ctrl ||= active(ts.Control);
      alt ||= active(ts.Alt);
    }
    holdKey(K_LCTRL, ctrl);
    holdKey(K_LALT, alt);
  }

  function holdKey(code, down) {
    if (down && !state.sent.get(code) && outputPending()) holdLater();
    else setKey(code, down);
  }

  function holdLater() {
    if (OUT.restore) return;
    OUT.restore = true;
    emit(() => {
      OUT.restore = false;
      syncHeld();
    }, CHORD);
  }

  function plainOut() {
    if (!state.sent.get(K_LCTRL) && !state.sent.get(K_LALT)) return;
    setKey(K_LCTRL, false);
    setKey(K_LALT, false);
    holdLater();
  }

  function releaseAll() {
    for (const code of [...state.sent.keys()]) setKey(code, false);
  }

  function clearOneShots(kb) {
    kb.setState(
      (s) => ({
        ...s,
        toggleStates: {
          ...s.toggleStates,
          Shift: releaseOneShot(s.toggleStates.Shift),
          Control: releaseOneShot(s.toggleStates.Control),
          Alt: releaseOneShot(s.toggleStates.Alt),
          AltGr: releaseOneShot(s.toggleStates.AltGr),
        },
      }),
      () => syncHeld(),
    );
  }

  function sendChord(kb, key, shifted) {
    const ts = kb.state?.toggleStates ?? {};
    const ctrl = active(ts.Control),
      alt = active(ts.Alt),
      shift = active(ts.Shift);
    const isEsc = key === "Escape";
    const shiftNav = shift && key === "Tab";
    if (!isEsc && !ctrl && !alt && !shiftNav) return false;
    if (kb.state?.layoutState !== 0 && kb.state?.layoutState !== 1) return false;
    const hid = HID[key];
    if (!hid) return false;
    const letter = key.length === 1 && /[a-z]/i.test(key);
    const needShift = hid[1] === true || (!shifted && (letter || key.length > 1 || key === " ") && shift);
    const shiftCode = needShift ? (key === "Tab" ? K_RSHIFT : K_LSHIFT) : 0;
    emit(() => {
      setKey(K_LCTRL, ctrl);
      setKey(K_LALT, alt);
      tapKey(hid[0], shiftCode);
      syncHeld();
      echoReset(true);
    }, CHORD);
    clearOneShots(kb);
    return true;
  }

  function getEngine() {
    const E = window.__oskSwipeEngine,
      W = window.__oskWords,
      L = window.__oskLM;
    if (!E?.createEngine || !W?.text) return null;
    const sig = `${E.version}:${W.version}:${L?.version ?? 0}`;
    if (window.__oskEngine?.__sig === sig) return window.__oskEngine;
    if (state.engineFailedSig === sig) return null;
    let eng;
    try {
      eng = E.createEngine(W.text, L?.text ? { lm: L.text } : {});
    } catch (e) {
      state.engineFailedSig = sig;
      note(e);
      return null;
    }
    eng.__sig = sig;
    let data = null;
    try {
      data = window.__oskEngine?.exportUser?.() ?? null;
    } catch (e) {}
    data ??= window.__oskUserWords;
    if (!data) {
      try {
        data = JSON.parse(window.localStorage?.getItem(LS_KEY) ?? "null");
      } catch (e) {}
    }
    try {
      if (data) eng.setUser(data);
    } catch (e) {
      note(e);
    }
    for (const w of data?.blocked ?? []) state.blocked.add(String(w).toLowerCase());
    window.__oskEngine = eng;
    return eng;
  }

  const notBlocked = (c) => c && !state.blocked.has(String(c.word ?? "").toLowerCase());

  function exportAll(eng) {
    return { ...eng.exportUser(), blocked: [...state.blocked], settings: { ...settings, at: settingsAt } };
  }

  function activeMode() {
    const m = window.__oskModes?.modes?.[settings.mode];
    return m && m.id !== "standard" ? m : null;
  }

  function modeChanged() {
    for (const kb of openKeyboards()) {
      try {
        window.__oskModes?.sync?.(kb, settings.mode, modeApi);
        refreshSuggestions(kb);
      } catch (e) {
        note(e);
      }
    }
  }

  function setSetting(name, on) {
    if (!(name in DEFAULTS)) return false;
    if ((CHOICES[name] || SLIDERS[name]) && !validSetting(name, on)) return false;
    const wasPrivate = settings.privateMode;
    if (name === "privateMode" && !!on && !wasPrivate) {
      try {
        flushLog();
      } catch (e) {
        note(e);
      }
    }
    settings[name] = CHOICES[name] || SLIDERS[name] ? on : !!on;
    window.__oskSettingsAt = settingsAt = Math.max(Date.now(), settingsAt + 1);
    if (name === "privateMode" && settings.privateMode !== wasPrivate) resetContext(null, false);
    if (name === "swipe") state.swipeOn = settings.swipe;
    try {
      window.localStorage?.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, at: settingsAt }));
    } catch (e) {
      note(e);
    }
    userChanged();
    if (name === "suggestions") relayout();
    if (name === "trail" && !on) clearTrail(SW.kb);
    if (name === "swipe" && !on) resetSession();
    if (P.open && (LOOK.has(name) || SLIDERS[name])) P.lookDue = true;
    else if (LOOK.has(name)) for (const doc of documents()) applyLook(doc);
    else if (SLIDERS[name]) for (const doc of documents()) applyLookVars(doc);
    if (name === "echo" || name === "suggestions" || name === "privateMode" || name === "mode" || name === "reach") scheduleEcho();
    if (name === "mode" || name === "oneAspect" || name === "reach") modeChanged();
    paintSetting(name);
    return true;
  }

  function blockWord(kb, word) {
    const k = String(word).toLowerCase();
    if (!k) return;
    state.blocked.add(k);
    try {
      getEngine()?.forget?.(word);
    } catch (e) {
      note(e);
    }
    userChanged();
    const i = T.sugs.findIndex((x) => String(x?.word ?? "").toLowerCase() === k);
    const notice = { word, label: `blocked: ${word} · tap to undo`, unblock: true, note: true };
    const items = T.sugs.slice();
    if (i >= 0) items[i] = notice;
    T.notice = notice;
    setSuggestions(kb, items, T.mode, T.current === i ? -1 : T.current);
    clearTimeout(state.noticeTimer);
    state.noticeTimer = setTimeout(() => {
      if (T.notice !== notice) return;
      T.notice = null;
      refreshSuggestions(kb);
    }, 3000);
  }

  function userChanged() {
    const eng = window.__oskEngine;
    if (!eng) return;
    state.userRev = (state.userRev ?? 0) + 1;
    if (state.lsTimer) return;
    state.lsTimer = setTimeout(() => {
      state.lsTimer = null;
      try {
        window.localStorage?.setItem(LS_KEY, JSON.stringify(exportAll(eng)));
      } catch (e) {
        note(e);
      }
    }, 10000);
  }

  function vkmOf(kb) {
    return kb.props?.VirtualKeyboardManager;
  }

  const OUT = { queue: [], busy: false, gen: 0, timer: null, at: {}, word: false };

  const SHIFTED = {
    "!": "1",
    "@": "2",
    "#": "3",
    $: "4",
    "%": "5",
    "^": "6",
    "&": "7",
    "*": "8",
    "(": "9",
    ")": "0",
    _: "-",
    "+": "=",
    "{": "[",
    "}": "]",
    "|": "\\",
    ":": ";",
    '"': "'",
    "<": ",",
    ">": ".",
    "?": "/",
    "~": "`",
  };
  const CHORD = "\u0000chord";
  const physKey = (k) => (k === null || k.length !== 1 ? k : (SHIFTED[k] ?? k.toLowerCase()));

  const shiftOf = (k) => k !== null && k.length === 1 && (k in SHIFTED || k !== k.toLowerCase());
  const isArrow = (k) => k?.startsWith("Arrow");

  function waitFor(key, shifted) {
    if (key === null) return 0;
    const now = performance.now();
    const last = OUT.last;
    let gap = KEY_GAP_MS;
    if (key === CHORD || last === CHORD) gap = CHORD_GAP_MS;
    else if (last?.length > 1 && key !== last && !(isArrow(key) && isArrow(last))) gap = NAMED_KEY_GAP_MS;
    else if (OUT.lastShift !== undefined && OUT.lastShift !== shifted) gap = SHIFT_GAP_MS;
    const same = isArrow(key) ? ARROW_GAP_MS : SAME_KEY_GAP_MS;
    return Math.max(gap - (now - (OUT.lastAt ?? -1e9)), same - (now - (OUT.at[key] ?? -1e9)));
  }

  function markSent(key, shifted) {
    if (key === null) return;
    const now = performance.now();
    OUT.last = key;
    OUT.lastAt = now;
    OUT.lastShift = shifted;
    OUT.at[key] = now;
  }

  function emit(fn, key = null, tag = null) {
    if (state.stopped) return;
    OUT.queue.push([fn, physKey(key), tag, OUT.gen, shiftOf(key), OUT.word]);
    if (!OUT.running) pump();
  }

  function dropOutput() {
    OUT.gen++;
    OUT.queue.length = 0;
    clearTimeout(OUT.timer);
    OUT.timer = null;
    OUT.busy = false;
    OUT.restore = false;
  }

  function keepWords() {
    const words = OUT.queue.filter((x) => x[5] && x[3] === OUT.gen);
    if (!words.length) return dropOutput();
    if (words[0] !== OUT.queue[0]) {
      clearTimeout(OUT.timer);
      OUT.timer = null;
      OUT.busy = false;
    }
    OUT.queue.splice(0, OUT.queue.length, ...words);
    if (!OUT.busy && !OUT.running) pump();
  }

  function pump() {
    while (!OUT.busy && OUT.queue.length && !state.stopped) {
      const [fn, key, , gen, shifted] = OUT.queue[0];
      if (gen !== OUT.gen) {
        OUT.queue.shift();
        continue;
      }
      const wait = waitFor(key, shifted);
      if (wait > 0) {
        OUT.busy = true;
        const g = OUT.gen;
        OUT.timer = setTimeout(() => {
          if (g !== OUT.gen || state.stopped) return;
          OUT.timer = null;
          OUT.busy = false;
          pump();
        }, wait);
        return;
      }
      OUT.queue.shift();
      OUT.running = true;
      try {
        fn();
      } catch (e) {
        note(e);
      } finally {
        OUT.running = false;
      }
      markSent(key, shifted);
    }
  }

  const outputPending = () => OUT.busy || OUT.queue.length > 0;

  const EC = { text: "", lost: false, at: 0, el: null, raf: false, shown: null };

  function echoStale() {
    if (EC.at && performance.now() - EC.at > STALE_MS && (EC.text || EC.lost)) {
      EC.text = "";
      EC.lost = true;
    }
    EC.at = performance.now();
  }

  function echoAdd(s) {
    if (settings.privateMode) return;
    echoStale();
    EC.text = (EC.text + s).slice(-ECHO_KEEP);
    scheduleEcho();
  }

  function echoBack() {
    echoStale();
    if (EC.text) EC.text = Array.from(EC.text).slice(0, -1).join("");
    scheduleEcho();
  }

  function echoReset(lost) {
    if (EC.text === "" && EC.lost === lost) return;
    EC.text = "";
    EC.lost = lost;
    EC.at = performance.now();
    scheduleEcho();
  }

  function echoKey(kb, key, ch, spec) {
    if (TOGGLES.has(key) || key.startsWith("SwitchKeys_") || key.startsWith("IME_") || key === "VKMove") return;
    if (key === "Backspace") echoBack();
    else if (key === "Enter" || key === "VKClose" || key === "VKDone") echoReset(false);
    else if (SPECIAL_TEXT.has(key) || spec?.strDeadKeyNext || spec?.strKeyHandler) echoReset(true);
    else echoAdd(key.length === 1 ? ch : key);
  }

  function scheduleEcho() {
    if (EC.raf) return;
    EC.raf = true;
    const win = EC.win && !EC.win.closed ? EC.win : window;
    const run = () => {
      try {
        renderEcho();
      } catch (e) {
        EC.raf = false;
        note(e);
      }
    };
    if (win.requestAnimationFrame) win.requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  function echoHost(kb) {
    const root = kb.m_keyboardDiv;
    let host = root?.querySelector(`[data-key="${SUG}0"]`)?.parentElement ?? null;
    if (host && !host.getBoundingClientRect().width) host = host.parentElement;
    if (host) return [host, "row"];
    host = root?.querySelector('[data-key=" "]') ?? null;
    return host ? [host, "space"] : [null];
  }

  function renderEcho(kb = openKeyboards()[0]) {
    EC.raf = false;
    if (state.stopped) return;
    const [host, where] =
      kb && (eff("echo") || settings.privateMode) && !P.open && !isImeLayout() && layoutSupported() ? echoHost(kb) : [null];
    if (!host) {
      if (EC.el && !EC.el.hidden) EC.el.hidden = true;
      if (EC.badge && !EC.badge.hidden) EC.badge.hidden = true;
      return;
    }
    const doc = host.ownerDocument;
    if (!EC.el || EC.el.ownerDocument !== doc) {
      EC.el?.remove();
      EC.el = doc.createElement("div");
      EC.el.append(doc.createElement("span"), doc.createElement("span"));
      EC.el.firstChild.className = "osk-echo-t";
      EC.el.lastChild.className = "osk-echo-c";
      EC.shown = null;
    }
    const cls = `osk-echo ${where}${EC.over ? " over" : ""}${settings.privateMode ? " private" : ""}${EC.el.classList.contains("badged") ? " badged" : ""}`;
    if (EC.el.className !== cls) EC.el.className = cls;
    if (EC.el.parentElement !== host) host.appendChild(EC.el);
    if (EC.el.hidden) EC.el.hidden = false;
    if (EC.badge && !EC.badge.isConnected) EC.badge = null;
    let chars = Array.from(EC.text);
    let lead = EC.lost;
    if (chars.length + (lead ? 1 : 0) > ECHO_SHOW) {
      chars = chars.slice(-(ECHO_SHOW - 1));
      lead = true;
    }
    const shown = settings.privateMode ? "Private mode · hold here to turn off" : (lead ? "…" : "") + chars.join("");
    renderBadge(host, where);
    const mark = !settings.privateMode && EC.mark && performance.now() < EC.mark.until ? EC.mark.text : "";
    const at = mark ? shown.lastIndexOf(mark) : -1;
    const markOk = at >= 0 && at >= shown.length - mark.length - 2;
    const key = `${shown}|${markOk ? at : -1}`;
    if (EC.shown === key) return;
    EC.shown = key;
    const parts = markOk
      ? [
          shown.slice(0, at),
          Object.assign(doc.createElement("span"), { className: "osk-echo-mark", textContent: mark }),
          shown.slice(at + mark.length),
        ]
      : [shown];
    EC.el.firstChild.replaceChildren(...parts);
    EC.el.classList.remove("over");
    EC.el.lastChild.style.animation = "none";
    EC.over = EC.el.scrollWidth > EC.el.clientWidth + 1;
    if (EC.over) EC.el.classList.add("over");
    EC.el.lastChild.style.animation = "";
  }

  const MODE_BADGE = { standard: "Standard" };

  function renderBadge(host, where) {
    const text = [settings.mode !== DEFAULTS.mode ? MODE_BADGE[settings.mode] : null, settings.reach === "right" ? "1-thumb" : null]
      .filter(Boolean)
      .join(" · ");
    const doc = host.ownerDocument;
    if (!EC.badge || EC.badge.ownerDocument !== doc) {
      EC.badge?.remove();
      EC.badge = doc.createElement("div");
      EC.badge.className = "osk-badge";
    }
    const show = !!text && where === "row";
    if (EC.badge.parentElement !== host) host.appendChild(EC.badge);
    if (EC.badge.textContent !== text) EC.badge.textContent = text;
    if (EC.badge.hidden !== !show) EC.badge.hidden = !show;
    if (EC.el.classList.contains("badged") !== show) EC.el.classList.toggle("badged", show);
  }

  const TIP = { el: null, timer: null };

  function showTip(kb) {
    const doc = kb.m_keyboardDiv?.ownerDocument;
    const r = kb.m_keyboardDiv?.getBoundingClientRect();
    if (!doc?.body || !r?.width) return;
    setSetting("tipShown", true);
    TIP.el?.remove();
    const el = doc.createElement("div");
    el.className = "osk-toast";
    const line = (b, t, gear) => {
      const d = doc.createElement("div");
      const s = doc.createElement("b");
      s.textContent = b;
      if (gear) {
        const g = doc.createElement("span");
        g.className = "osk-gear";
        s.append(" ", g, " (the emoji key)");
      }
      d.append(s, t);
      return d;
    };
    el.append(
      line("Hold", " for settings", true),
      line("Hold space and slide", " to move the cursor"),
      line("Swipe words", " with the trackpads or the screen"),
    );
    const top = Math.min(
      r.top,
      ...[...kb.m_keyboardDiv.querySelectorAll("[data-key]")]
        .map((e) => e.getBoundingClientRect())
        .filter((b) => b.height)
        .map((b) => b.top),
    );
    const { z, f } = zoomOf(kb);
    if (z !== 1) el.style.zoom = String(z);
    Object.assign(el.style, {
      left: `${(r.left * f) / z + 8}px`,
      bottom: `${((doc.defaultView?.innerHeight ?? r.bottom * f) - top * f) / z + 8}px`,
      maxWidth: `${(r.width * f) / z - 16}px`,
    });
    doc.body.appendChild(el);
    TIP.el = el;
    clearTimeout(TIP.timer);
    TIP.timer = setTimeout(hideTip, 8000);
  }

  function hideTip() {
    clearTimeout(TIP.timer);
    TIP.el?.remove();
    TIP.el = null;
  }

  function markEcho(text) {
    EC.mark = { text, until: performance.now() + 1500 };
    clearTimeout(EC.markTimer);
    EC.markTimer = setTimeout(() => {
      EC.shown = null;
      scheduleEcho();
    }, 1550);
    EC.shown = null;
    scheduleEcho();
  }

  function sendText(kb, text) {
    if (!text) return;
    const vkm = vkmOf(kb);
    for (const ch of text) {
      if (ch.charCodeAt(0) > 126 || ch.charCodeAt(0) < 32) continue;
      emit(() => {
        plainOut();
        vkm.HandleVirtualKeyDown(ch, false);
        echoAdd(ch);
      }, ch);
    }
  }

  function backspace(kb, n) {
    const vkm = vkmOf(kb);
    for (let i = 0; i < n; i++)
      emit(() => {
        plainOut();
        vkm.HandleVirtualKeyDown("Backspace", false);
        echoBack();
      }, "Backspace");
  }

  const SHIFT_UP = Object.fromEntries(Object.entries(SHIFTED).map(([up, base]) => [base, up]));
  const AUTO_SPACE_DROP = /^[.,!?:;)\]}]$/;
  const WORD_RE = /^[A-Za-z]+(?:'[A-Za-z]+)?$/;
  const isUpper = (w) => w.length > 1 && w === w.toUpperCase() && w !== w.toLowerCase();
  const capFirst = (w) => w.charAt(0).toUpperCase() + w.slice(1);

  function caseLike(src, word) {
    if (isUpper(src)) return word.toUpperCase();
    if (src && src[0] !== src[0].toLowerCase()) return capFirst(word);
    return word;
  }

  function caseFlags(kb) {
    const ts = kb.state?.toggleStates ?? {};
    return { caps: active(ts.CapsLock), shift: active(ts.Shift) };
  }

  function applyToggleCase(kb, word, flags = caseFlags(kb)) {
    if (flags.caps) return word.toUpperCase();
    if (flags.shift) return capFirst(word);
    return word;
  }

  function releaseShiftOneShot(kb) {
    const v = kb.state?.toggleStates?.Shift ?? 0;
    if ((v & 3) === 1) kb.setState((s) => ({ ...s, toggleStates: { ...s.toggleStates, Shift: releaseOneShot(s.toggleStates.Shift) } }));
  }

  function commitBuffer(how) {
    const w = T.buf;
    const swipe = T.fromSwipe;
    const fromSwipe = !!swipe;
    if (w && how !== "end") {
      try {
        logWord(w, swipe, how);
      } catch (e) {
        note(e);
      }
    }
    T.buf = "";
    T.taps = [];
    T.fromSwipe = null;
    if (how === "end" || settings.privateMode) {
      T.prev = how === "end" ? null : T.prev;
      return;
    }
    const eng = getEngine();
    if (w && eng && w.includes(" ") && w.split(" ").every((x) => WORD_RE.test(x))) {
      let phrase = false;
      try {
        phrase = !!eng.info?.(w)?.phrase;
      } catch (e) {}
      const parts = phrase ? [w] : w.split(" ");
      try {
        for (const part of parts) {
          if (eff("learn")) eng.learn(part, T.prev, { allowNew: false });
          T.prev = part;
        }
        if (eff("learn")) userChanged();
      } catch (e) {
        note(e);
      }
      return;
    }
    if (!w || !WORD_RE.test(w) || !eng) {
      T.prev = null;
      return;
    }
    if (fromSwipe && !swipe.picked) {
      let inf = null;
      try {
        inf = eng.info?.(w) ?? null;
      } catch (e) {}
      if (inf && !(inf.c > 0) && (inf.z ?? 0) < LEARN_SWIPE_ZIPF) {
        T.prev = w;
        return;
      }
    }
    if (!eff("learn")) {
      T.prev = w;
      return;
    }
    let allowNew = !fromSwipe && (how === "space" || how === "punct" || how === "swipe");
    try {
      const k = w.toLowerCase();
      if (allowNew && !eng.known(k)) {
        state.pending[k] = (state.pending[k] ?? 0) + 1;
        allowNew = state.pending[k] >= NEW_WORD_USES;
        if (allowNew) delete state.pending[k];
      }
      if (eng.learn(w, T.prev, { allowNew })) userChanged();
    } catch (e) {
      note(e);
    }
    T.prev = w;
  }

  function resetTracker(lastOut = "unknown", flush = true) {
    if (flush) {
      try {
        flushLog();
      } catch (e) {
        note(e);
      }
    }
    SW.recent = null;
    T.buf = "";
    T.taps = [];
    T.prev = null;
    T.fromSwipe = null;
    T.auto = false;
    T.lastOut = lastOut;
  }

  const LOG = { out: [], seq: 0, acked: 0, staged: null, deleted: null, env: null, geo: null };
  const REQ = { pending: {}, rev: 0, taken: 0, takes: 0, acks: 0, hostAcks: false };

  function request(kind) {
    REQ.pending[kind] = true;
    REQ.rev++;
    REQ.takes = 0;
  }

  function logVersions() {
    return {
      keyboard: VERSION,
      engine: window.__oskSwipeEngine?.version ?? 0,
      words: window.__oskWords?.version ?? 0,
      pairs: window.__oskLM?.version ?? 0,
      modes: window.__oskModes?.version ?? 0,
      installed: window.__oskInstall?.date ?? null,
    };
  }

  function logLine(rec) {
    if (!eff("typingLog")) return;
    LOG.out.push([++LOG.seq, JSON.stringify(rec)]);
    if (LOG.out.length > LOG_KEEP) LOG.out.splice(0, LOG.out.length - LOG_KEEP);
  }

  function logContext(kb) {
    if (!eff("typingLog")) return;
    const env = {
      type: "env",
      versions: logVersions(),
      settings: {
        mode: settings.mode,
        reach: settings.reach,
        oneAspect: settings.oneAspect,
        swipe: settings.swipe,
        autocorrect: settings.autocorrect,
        autoSpace: settings.autoSpace,
        suggestions: settings.suggestions,
      },
    };
    const es = JSON.stringify(env);
    if (es !== LOG.env) {
      LOG.env = es;
      logLine({ t: Date.now(), ...env });
    }
    const keys = kb ? letterKeys(kb) : null;
    if (!keys) return;
    const r = kb.m_keyboardDiv?.getBoundingClientRect();
    const geo = {
      type: "geo",
      rect: r ? [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 10) / 10) : null,
      keys: Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, [v.x, v.y, v.w, v.h].map((n) => Math.round(n * 10) / 10)])),
    };
    const gs = JSON.stringify(geo);
    if (gs !== LOG.geo) {
      LOG.geo = gs;
      logLine({ t: Date.now(), ...geo });
    }
  }

  function logWord(w, swipe, how) {
    if (settings.privateMode) return;
    if (!/^[A-Za-z]+(?:'[A-Za-z]+)?(?: [A-Za-z]+(?:'[A-Za-z]+)?)*$/.test(w)) return;
    const rec = { type: "word", t: Date.now(), how, committed: w, mode: settings.mode };
    if (swipe?.rec) {
      Object.assign(rec, {
        kind: "swipe",
        trace: swipe.rec.trace,
        top: swipe.rec.top,
        outcome: swipe.rec.outcome?.startsWith("replaced:") ? "picked" : "kept",
      });
      if (rec.outcome === "picked") rec.decoded = swipe.rec.top?.[0]?.[0] ?? null;
    } else {
      const ac = T.autocorr && T.autocorr.to === w ? T.autocorr : null;
      const pk = T.picked;
      Object.assign(rec, {
        kind: pk?.predict ? "predict" : "tap",
        typed: ac ? ac.from : pk ? pk.typed : w,
        taps: ac ? ac.taps : pk ? pk.taps : T.taps.slice(),
        top: (pk?.sugs ?? T.sugs).filter(Boolean).map((x) => x.word),
        outcome: ac ? "autocorrected" : pk ? "picked" : "kept",
      });
    }
    logStage(rec);
  }

  function logStage(rec) {
    flushStaged();
    if (LOG.deleted) {
      LOG.deleted.next = rec.committed;
      logLine(LOG.deleted);
      LOG.deleted = null;
    }
    LOG.staged = rec;
  }

  function flushStaged() {
    if (LOG.staged) {
      logContext(SW.kb ?? openKeyboards()[0]);
      logLine(LOG.staged);
      LOG.staged = null;
    }
  }

  function flushLog() {
    flushStaged();
    if (LOG.deleted) {
      logLine(LOG.deleted);
      LOG.deleted = null;
    }
  }

  function logDeleted(f) {
    if (settings.privateMode) return;
    flushStaged();
    if (LOG.deleted) logLine(LOG.deleted);
    LOG.deleted = f.rec
      ? {
          type: "word",
          t: Date.now(),
          kind: "swipe",
          committed: f.text,
          trace: f.rec.trace,
          top: f.rec.top,
          mode: settings.mode,
          outcome: "deleted",
        }
      : null;
  }

  function clearTypingLog() {
    LOG.out = [];
    LOG.acked = LOG.seq;
    LOG.staged = null;
    LOG.deleted = null;
    LOG.env = null;
    LOG.geo = null;
    request("clearLog");
    if (settings.logFile) setSetting("logFile", false);
  }

  function setSuggestions(kb, items, mode, current = -1) {
    T.sugs = items;
    T.mode = mode;
    T.current = current;
    const labels = items.map((x) => x?.label ?? x?.word ?? "");
    const same = labels.length === T.labels.length && labels.every((l, i) => l === T.labels[i]) && T.renderedCurrent === current;
    T.labels = labels;
    if (same || !kb) return;
    T.renderedCurrent = current;
    try {
      if (writeLabels(kb)) markCurrent(kb);
      else kb.forceUpdate(() => markCurrent(kb));
    } catch (e) {
      note(e);
    }
  }

  function writeLabels(kb) {
    const root = kb.m_keyboardDiv;
    if (!root) return false;
    const spans = [];
    for (let i = 0; i < 3; i++) {
      const el = root.querySelector(`[data-key="${SUG}${i}"] span`);
      if (!el) return false;
      const want = String(T.labels[i] ?? "");
      if (el.textContent === want) continue;
      const pk = Object.keys(el).find((k) => k.startsWith("__reactProps"));
      if (!pk || typeof el[pk]?.children !== "string") return false;
      spans.push([el, want]);
    }
    for (const [el, want] of spans) el.textContent = want;
    return true;
  }

  function markCurrent(kb) {
    const doc = kb.m_keyboardDiv?.ownerDocument;
    if (!doc) return;
    for (let i = 0; i < 3; i++) {
      const el = doc.querySelector(`[data-key="${SUG}${i}"]`);
      el?.classList.toggle("osk-sug-current", i === T.current);
      el?.classList.toggle("osk-sug-note", !!T.sugs[i]?.note);
    }
  }

  function takeTouchTap() {
    const t = SW.touchTap;
    SW.touchTap = null;
    return t && performance.now() - t.t < 1000 ? t : null;
  }

  const modeApi = {
    note,
    spans: () => ({ L: padSpan("L"), R: padSpan("R"), aspect: settings.oneAspect }),
    keys: (kb) => letterKeys(kb),
    rect: (kb) => kb.m_keyboardDiv?.getBoundingClientRect(),
    extent: (kb) => keyExtent(kb),
    zoom: (kb) => zoomOf(kb).f,
    req: () => webpackRequire(),
    covered: () => P.open,
    classes: () => steamClasses(),
  };

  function refreshSuggestions(kb) {
    T.at = performance.now();
    if (!layoutSupported()) return setSuggestions(kb, [], null);
    const eng = getEngine();
    if (!eng) return setSuggestions(kb, [], null);
    const slot = (list) => [list[1], list[0], list[2]];
    if (T.fromSwipe) {
      const cur = T.fromSwipe.text.toLowerCase();
      const alts = T.fromSwipe.cands
        .filter((c) => c.word.toLowerCase() !== cur)
        .slice(0, 2)
        .map((c) => ({ ...c, word: caseLike(T.fromSwipe.text, c.word) }));
      return setSuggestions(kb, [alts[0], { word: T.fromSwipe.text }, alts[1]], "swipe", 1);
    }
    if (T.buf) {
      const lower = T.buf.toLowerCase();
      let raw = [];
      try {
        raw = eng.suggest(T.buf, { prev: T.prev, keys: letterKeys(kb), taps: tapsCtx() }, 6) ?? [];
      } catch (e) {
        note(e);
      }
      const seen = new Set([lower]);
      const list = [];
      const corr = correction(kb);
      if (corr) {
        list.push({ word: corr.text, key: corr.word.toLowerCase(), corr: true });
        seen.add(corr.word.toLowerCase());
      }
      for (const c of raw) {
        const k = String(c?.word ?? "").toLowerCase();
        if (!k || seen.has(k) || !notBlocked(c)) continue;
        seen.add(k);
        list.push({ word: caseLike(T.buf, c.word), key: c.key ?? k, kind: c.kind });
      }
      const unknown = eff("learn") && T.buf.length >= 2 && WORD_RE.test(T.buf) && !eng.known(lower);
      const lit = unknown ? { word: T.buf, label: `+ add ${T.buf}`, add: true } : { word: T.buf, label: `“${T.buf}”`, literal: true };
      const items = [lit, list[0] ?? null, list[1] ?? null];
      return setSuggestions(kb, items, "complete", list.length && corr?.confident && eff("autocorrect") ? 1 : -1);
    }
    if (T.autocorr && !T.buf) {
      const p = eng.predict?.(T.prev, 8)?.filter(notBlocked) ?? [];
      return setSuggestions(kb, [{ word: T.autocorr.from, label: `↶ ${T.autocorr.from}`, undo: true }, p[0], p[1]], "predict");
    }
    if (T.prev && T.lastOut === "space") {
      return setSuggestions(kb, slot(eng.predict(T.prev, 8).filter(notBlocked).slice(0, 3)), "predict");
    }
    setSuggestions(kb, [], null);
  }

  function pickSuggestion(kb, i) {
    settleFinish();
    SW.recent = null;
    const item = T.sugs[i];
    if (!item?.word || item.inert) return;
    if (item.unblock) {
      unblockWord(item.word);
      T.notice = null;
      refreshSuggestions(kb);
      return;
    }
    if (item.undo && T.autocorr) {
      const sep = T.autocorr.sep;
      undoAutocorrect(kb);
      sendText(kb, sep);
      commitBuffer(sep === " " ? "space" : /[.!?]/.test(sep) ? "end" : "punct");
      T.lastOut = sep === " " ? "space" : "punct";
      refreshSuggestions(kb);
      return;
    }
    if (T.mode === "swipe" && T.fromSwipe) {
      if (i === T.current) return;
      const old = T.fromSwipe.text;
      const text = caseLike(old, item.word);
      backspace(kb, old.length);
      sendText(kb, text);
      T.fromSwipe.text = text;
      T.fromSwipe.picked = true;
      if (T.fromSwipe.rec) T.fromSwipe.rec.outcome = `replaced:${text}`;
      T.buf = text;
      T.lastOut = "word";
    } else if (T.mode === "complete" && T.buf && item.add) {
      const eng = getEngine();
      try {
        eng?.learn(T.buf, T.prev, { allowNew: true });
        delete state.pending[T.buf.toLowerCase()];
        userChanged();
      } catch (e) {
        note(e);
      }
      sendText(kb, " ");
      T.picked = { typed: T.buf, taps: T.taps.slice(), sugs: T.sugs.slice() };
      try {
        logWord(T.buf, null, "space");
      } catch (e) {
        note(e);
      }
      T.picked = null;
      const added = T.buf;
      T.prev = T.buf;
      T.buf = "";
      T.taps = [];
      T.lastOut = "space";
      T.auto = true;
      refreshSuggestions(kb);
      const items = T.sugs.slice();
      const notice = { word: added, label: `added: ${added}`, note: true, inert: true };
      items[0] = notice;
      T.notice = notice;
      setSuggestions(kb, items, T.mode, -1);
      clearTimeout(state.noticeTimer);
      state.noticeTimer = setTimeout(() => {
        if (T.notice !== notice) return;
        T.notice = null;
        refreshSuggestions(kb);
      }, 2000);
      return;
    } else if (T.mode === "complete" && T.buf) {
      const text = caseLike(T.buf, item.word);
      if (text !== T.buf) backspace(kb, T.buf.length);
      sendText(kb, (text !== T.buf ? text : "") + " ");
      T.picked = { typed: T.buf, taps: T.taps.slice(), sugs: T.sugs.slice() };
      T.buf = text;
      commitBuffer("space");
      T.picked = null;
      T.lastOut = "space";
      T.auto = true;
    } else if (T.mode === "predict") {
      const pre = T.lastOut === "word" ? " " : "";
      sendText(kb, pre + item.word + " ");
      T.picked = { typed: "", taps: [], sugs: T.sugs.slice(), predict: true };
      T.buf = item.word;
      commitBuffer("space");
      T.picked = null;
      T.lastOut = "space";
      T.auto = true;
    }
    refreshSuggestions(kb);
  }

  function correction(kb, final = false) {
    const eng = getEngine();
    if (!eng?.correct || !T.buf || T.fromSwipe || T.noCorrect === T.buf || T.buf.length < 2) return null;
    if (!/^[A-Za-z']+$/.test(T.buf) || isUpper(T.buf)) return null;
    let c = null;
    try {
      c = eng.correct(T.buf, { prev: T.prev, keys: letterKeys(kb), taps: tapsCtx(), ...(final ? { final: true } : {}) });
    } catch (e) {
      note(e);
    }
    if (!c?.word || c.word.toLowerCase() === T.buf.toLowerCase() || !notBlocked(c)) return null;
    return { ...c, text: caseLike(T.buf, c.word) };
  }

  function autocorrect(kb, sep) {
    const c = correction(kb, true);
    if (!c?.confident) return false;
    backspace(kb, T.buf.length);
    sendText(kb, c.text);
    T.autocorr = { from: T.buf, to: c.text, sep, prev: T.prev, taps: T.taps.slice() };
    T.buf = c.text;
    emit(() => markEcho(c.text), null);
    return true;
  }

  function undoAutocorrect(kb) {
    const a = T.autocorr;
    T.autocorr = null;
    if (!a) return false;
    if (LOG.staged?.committed === a.to && LOG.staged.outcome === "autocorrected") LOG.staged.outcome = "autocorrect-undone";
    backspace(kb, a.to.length + a.sep.length);
    sendText(kb, a.from);
    if (eff("learn")) {
      try {
        for (const part of a.to.split(" ")) getEngine()?.unlearn?.(part, null);
        userChanged();
      } catch (e) {
        note(e);
      }
    }
    T.buf = a.from;
    T.taps = a.taps ?? [];
    T.prev = a.prev;
    T.noCorrect = a.from;
    T.fromSwipe = null;
    T.lastOut = "word";
    refreshSuggestions(kb);
    return true;
  }

  function undoSwipe(kb) {
    const f = T.fromSwipe;
    if (!f || T.buf !== f.text) return false;
    backspace(kb, f.text.length + f.prefix.length);
    if (f.rec) f.rec.outcome = "deleted";
    try {
      logDeleted(f);
    } catch (e) {
      note(e);
    }
    if (eff("learn")) {
      try {
        getEngine()?.unlearn?.(f.text, null);
        userChanged();
      } catch (e) {
        note(e);
      }
    }
    T.buf = "";
    T.taps = [];
    T.fromSwipe = null;
    T.lastOut = f.prefix ? "word" : "unknown";
    refreshSuggestions(kb);
    return true;
  }

  function spaceAfterSwipe(kb, key) {
    if (!settings.autoSpace || !/^[A-Za-z]$/.test(key) || !T.fromSwipe || T.buf !== T.fromSwipe.text) return;
    if (kb.state?.layoutState !== 0 && kb.state?.layoutState !== 1) return;
    sendText(kb, " ");
    commitBuffer("space");
    T.lastOut = "space";
  }

  function typedChar(kb, key) {
    const ts = kb.state?.toggleStates ?? {};
    return key.length === 1 && (active(ts.Shift) || active(ts.CapsLock)) ? key.toUpperCase() : key;
  }

  function tapsCtx() {
    if (T.taps.length !== T.buf.length || !T.taps.some(Boolean)) return null;
    return T.taps.map((t) => (t ? { x: t.x, y: t.y } : null));
  }

  const repeating = (kb) => SW.repeat || !!kb.m_nBackspaceTimer;

  function track(kb, key, ch, tap) {
    const auto = T.auto;
    T.auto = false;
    if (!layoutSupported()) {
      if (T.buf || T.prev || T.fromSwipe) resetTracker();
      return;
    }
    if (TOGGLES.has(key) || key.startsWith("SwitchKeys_") || key === "VKMove" || key === "VKPaste") {
      T.auto = auto;
      if (key === "VKPaste") resetTracker();
      return;
    }
    if (kb.state?.layoutState !== 0 && kb.state?.layoutState !== 1) {
      resetTracker();
    } else if (/^[A-Za-z']$/.test(ch)) {
      if (T.taps.length !== T.buf.length) T.taps = Array(T.buf.length).fill(null);
      T.buf += ch;
      T.taps.push(
        tap && typeof tap.x === "number" ? { x: Math.round(tap.x * 10) / 10, y: Math.round(tap.y * 10) / 10, s: tap.side ?? null } : null,
      );
      T.fromSwipe = null;
      T.lastOut = "word";
    } else if (key === "Backspace") {
      T.fromSwipe = null;
      if (T.buf) {
        T.buf = T.buf.slice(0, -1);
        T.taps = T.taps.slice(0, T.buf.length);
        T.lastOut = T.buf ? "word" : "unknown";
      } else {
        T.prev = null;
        T.lastOut = "unknown";
      }
    } else if (key === " ") {
      commitBuffer("space");
      T.lastOut = "space";
    } else if (key === "Enter") {
      commitBuffer("end");
      T.lastOut = "unknown";
    } else if (/^[.,!?;:]$/.test(ch)) {
      commitBuffer(/[.!?]/.test(ch) ? "end" : "punct");
      T.lastOut = "punct";
    } else if (key === "VKClose" || key === "VKDone") {
      commitBuffer("end");
      resetTracker();
    } else {
      resetTracker();
    }
    clearTimeout(state.refreshTimer);
    state.refreshTimer = null;
    if (key === "Backspace" && repeating(kb))
      state.refreshTimer = setTimeout(() => {
        state.refreshTimer = null;
        if (!state.stopped) refreshSuggestions(kb);
      }, BACKSPACE_REPEAT_MS * 2);
    else refreshSuggestions(kb);
  }

  function rectOf(kb) {
    const r = kb?.m_keyboardDiv?.getBoundingClientRect?.();
    return r ? [r.left, r.top, r.width, r.height] : null;
  }

  function sameRect(a, b) {
    return !!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
  }

  function dropGeometry(kb) {
    delete kb.__oskBounds;
    delete kb.__oskLetters;
    delete kb.__oskZoom;
  }

  function zoomOf(kb) {
    const el = kb?.m_keyboardDiv;
    if (!el?.isConnected) return { z: 1, f: 1 };
    const now = performance.now();
    const rc = rectOf(kb);
    if (kb.__oskZoom && now - kb.__oskZoom.at < 1000 && sameRect(kb.__oskZoom.rc, rc)) return kb.__oskZoom;
    const win = el.ownerDocument.defaultView ?? window;
    let z = 1;
    for (let n = el; n; n = n.parentElement) z *= parseFloat(win.getComputedStyle(n).zoom) || 1;
    let f = 1;
    if (Math.abs(z - 1) < 0.001) z = 1;
    else {
      const w = el.getBoundingClientRect().width;
      const m = w && el.offsetWidth ? (z * el.offsetWidth) / w : z;
      f = Math.abs(m - z) <= Math.abs(m - 1) ? z : 1;
    }
    kb.__oskZoom = { at: now, rc, z, f };
    return kb.__oskZoom;
  }

  function letterKeys(kb) {
    const now = performance.now();
    const rc = rectOf(kb);
    if (kb.__oskLetters && now - kb.__oskLetters.at < 500 && sameRect(kb.__oskLetters.rc, rc)) return kb.__oskLetters.keys;
    const keys = {};
    for (const el of kb.m_keyboardDiv?.querySelectorAll?.("[data-key]") ?? []) {
      const k = el.getAttribute("data-key");
      if (!/^[a-z]$/.test(k) || keys[k]) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.height) keys[k] = { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    }
    kb.__oskLetters = { at: now, rc, keys };
    return keys;
  }

  function moveThreshold(kb) {
    const ws = Object.values(letterKeys(kb))
      .map((k) => k.w)
      .sort((a, b) => a - b);
    return (ws[Math.floor(ws.length / 2)] || 90) * MOVE_KEYS;
  }

  function isImeLayout() {
    const l = state.layoutApi?.current?.();
    return /japan|chinese|korea|pinyin|zhuyin|bopomofo|cangjie|hangul|kana|quick|wubi|vietnam/i.test(
      `${l?.name ?? ""} ${l?.locToken ?? ""}`,
    );
  }

  function reassertHeld(kb) {
    const want = Object.entries(state.bumpers)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (!want.length) return;
    setTimeout(() => {
      try {
        kb.setState(
          (s) => {
            const ts = { ...s.toggleStates };
            for (const k of want) if (state.bumpers[k]) ts[k] = (ts[k] & ~3) | HELD;
            return { ...s, toggleStates: ts };
          },
          () => syncHeld(),
        );
      } catch (e) {
        note(e);
      }
    }, 0);
  }

  function swipeAllowed(kb) {
    if (!state.swipeOn || !kb || !isOpen(kb)) return false;
    if (kb.state?.layoutState !== 0 && kb.state?.layoutState !== 1) return false;
    const ts = kb.state.toggleStates ?? {};
    if (active(ts.Control) || active(ts.Alt) || active(ts.AltGr)) return false;
    if (!layoutSupported()) return false;
    return !!getEngine();
  }

  function trail(kb) {
    const doc = kb.m_keyboardDiv?.ownerDocument;
    if (!doc?.body) return null;
    let c = doc.getElementById("osk-swipe-trail");
    if (!c) {
      c = doc.createElement("canvas");
      c.id = "osk-swipe-trail";
      c.style.cssText = "position:fixed;pointer-events:none;z-index:2147483000;left:0;top:0";
      doc.body.appendChild(c);
    }
    const now = performance.now();
    if (!c.__rect || now - c.__rectAt > 1000) {
      c.__rect = kb.m_keyboardDiv.getBoundingClientRect();
      c.__rectAt = now;
    }
    const r = c.__rect;
    const f = zoomOf(kb).f;
    if (c.width !== Math.round(r.width * f) || c.height !== Math.round(r.height * f)) {
      c.width = Math.round(r.width * f);
      c.height = Math.round(r.height * f);
    }
    c.style.left = `${r.left * f}px`;
    c.style.top = `${r.top * f}px`;
    c.__ox = r.left;
    c.__oy = r.top;
    c.__f = f;
    return c;
  }

  function drawTrail(kb, strokes) {
    if (!settings.trail) return;
    SW.draw = { kb, strokes };
    if (SW.drawPending) return;
    SW.drawPending = true;
    const win = kb.m_keyboardDiv?.ownerDocument?.defaultView ?? window;
    win.requestAnimationFrame(() => {
      SW.drawPending = false;
      const d = SW.draw;
      SW.draw = null;
      if (d) {
        try {
          paintTrail(d.kb, d.strokes);
        } catch (e) {
          note(e);
        }
      }
    });
  }

  const TRAIL_COLORS = { L: [26, 159, 255], R: [255, 170, 60], T: [26, 159, 255] };

  function paintTrail(kb, strokes) {
    const c = trail(kb);
    if (!c) return;
    const g = c.getContext("2d");
    if (c.__fading) {
      c.__fading = false;
      clearTimeout(c.__fadeTimer);
      c.style.transition = "none";
      c.style.opacity = "1";
    }
    wipeTrail(c);
    g.setTransform(c.__f, 0, 0, c.__f, 0, 0);
    g.lineCap = "round";
    g.lineJoin = "round";
    const ox = c.__ox,
      oy = c.__oy;
    for (const s of strokes) {
      const pts = s.pts;
      if (pts.length < 2 && !s.moved) continue;
      const col = TRAIL_COLORS[s.side] ?? TRAIL_COLORS.L;
      const n = pts.length;
      const t = pts[0],
        h0 = pts[n - 1];
      const grad = g.createLinearGradient(t.x - ox, t.y - oy, h0.x - ox + 0.01, h0.y - oy);
      grad.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},0.15)`);
      grad.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0.85)`);
      g.strokeStyle = grad;
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(t.x - ox, t.y - oy);
      for (let i = 1; i < n; i++) g.lineTo(pts[i].x - ox, pts[i].y - oy);
      if (n === 1) g.lineTo(t.x - ox + 0.1, t.y - oy);
      g.stroke();
      const h = pts[n - 1];
      g.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},0.95)`;
      g.beginPath();
      g.arc(h.x - ox, h.y - oy, 5, 0, Math.PI * 2);
      g.fill();
    }
  }

  function wipeTrail(c) {
    const g = c.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
  }

  function clearTrail(kb, delay = 0) {
    const doc = kb?.m_keyboardDiv?.ownerDocument ?? SW.kb?.m_keyboardDiv?.ownerDocument;
    const c = doc?.getElementById("osk-swipe-trail");
    if (!c) return;
    SW.draw = null;
    if (!delay) {
      wipeTrail(c);
      return;
    }
    c.__fading = true;
    c.style.transition = `opacity ${delay}ms ease-out`;
    c.style.opacity = "0";
    clearTimeout(c.__fadeTimer);
    c.__fadeTimer = setTimeout(() => {
      if (!c.__fading) return;
      c.__fading = false;
      wipeTrail(c);
      c.style.transition = "none";
      c.style.opacity = "1";
    }, delay + 20);
  }

  function sessionTrace() {
    return traceOf(SW.strokes);
  }

  function resetSession() {
    clearTimeout(SW.timer);
    clearTimeout(SW.preview);
    SW.timer = null;
    SW.preview = null;
    SW.strokes = [];
    SW.gesture = false;
    SW.flags = { caps: false, shift: false };
    for (const side of ["L", "R"]) {
      if (SW.held[side]) SW.swallow[side] = SW.held[side].trigger ? "trigger" : true;
      SW.held[side] = null;
    }
  }

  function setPadDown(kb, side, down) {
    try {
      kb.setState({ [side === "L" ? "bLeftTrackpadDown" : "bRightTrackpadDown"]: down });
    } catch (e) {}
  }

  function decode(kb, trace) {
    const eng = getEngine();
    if (!eng || trace.length < 2) return [];
    try {
      const ctx = { prev: T.lastOut === "space" || T.lastOut === "word" ? T.prev : null };
      if (trace.some((p) => p.s?.[0] === "L" || p.s?.[0] === "R")) {
        const r = kb.m_keyboardDiv.getBoundingClientRect();
        ctx.pads = { L: [r.left, r.left + r.width * padSpan("L")], R: [r.right - r.width * padSpan("R"), r.right] };
      }
      return eng.decode(trace, letterKeys(kb), ctx).filter(notBlocked);
    } catch (e) {
      note(e);
      return [];
    }
  }

  function resetContext(kb, flush = false) {
    if (flush) {
      try {
        flushLog();
      } catch (e) {
        note(e);
      }
    }
    LOG.staged = null;
    LOG.deleted = null;
    dropFinish();
    resetSession();
    SW.touch = null;
    SW.recent = null;
    resetTracker("unknown", false);
    T.autocorr = null;
    T.noCorrect = null;
    T.picked = null;
    T.notice = null;
    for (const k of Object.keys(state.pending)) delete state.pending[k];
    echoReset(true);
    const k = kb ?? openKeyboards()[0];
    if (k) {
      try {
        refreshSuggestions(k);
      } catch (e) {
        note(e);
      }
    }
  }

  function logSwipe(kb, trace, cands) {
    if (settings.privateMode) return null;
    const rec = {
      at: Date.now(),
      trace: trace.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.t), p.s]),
      top: cands.slice(0, 6).map((c) => [c.word, Math.round(c.score * 100) / 100]),
      outcome: "kept",
    };
    state.swipeLog.push(rec);
    if (state.swipeLog.length > 200) state.swipeLog.shift();
    return rec;
  }

  function commitSwipe(kb, cands, flags, rec) {
    settleFinish();
    if (!cands.length) return;
    if (T.buf) commitBuffer("swipe");
    const snapshot = { buf: T.buf, prev: T.prev, lastOut: T.lastOut, fromSwipe: T.fromSwipe, auto: T.auto, taps: [] };
    const prefix = settings.autoSpace && (T.lastOut === "word" || T.lastOut === "punct") ? " " : "";
    const now = caseFlags(kb);
    const text = applyToggleCase(kb, cands[0].word, { caps: now.caps || !!flags?.caps, shift: now.shift || !!flags?.shift });
    sendText(kb, prefix + text);
    releaseShiftOneShot(kb);
    T.buf = text;
    T.fromSwipe = { text, prefix, cands: cands.slice(0, 8), rec };
    T.auto = false;
    T.lastOut = "word";
    refreshSuggestions(kb);
    return { snapshot, text, word: cands[0].word, del: prefix.length + text.length };
  }

  function finishGesture(kb, spread = false) {
    settleFinish();
    const recent = SW.recent;
    SW.recent = null;
    const saved = { buf: T.buf, prev: T.prev, lastOut: T.lastOut, fromSwipe: T.fromSwipe, auto: T.auto, taps: T.taps };
    const merged = !!(recent && SW.strokes[0] && SW.strokes[0].t0 - recent.end < JOIN_MS && T.buf.endsWith(recent.text));
    if (merged) {
      SW.strokes[0].boundary = true;
      SW.strokes.unshift(...recent.strokes);
      Object.assign(T, recent.snapshot);
    }
    const trace = sessionTrace();
    const strokes = SW.strokes;
    const flags =
      merged && recent.flags ? { caps: SW.flags.caps || recent.flags.caps, shift: SW.flags.shift || recent.flags.shift } : SW.flags;
    resetSession();
    drawTrail(kb, strokes);
    clearTrail(kb, 180);
    let spent = 0;
    let best = null;
    const jobs = [
      () => {
        const cands = decode(kb, trace);
        best = { parts: [cands], score: cands[0]?.score ?? -Infinity };
      },
    ];
    let splits = 0;
    strokes.forEach((st, i) => {
      if (!st.boundary || i === 0 || ++splits > 3) return;
      let a = [];
      jobs.push(() => {
        a = decode(kb, traceOf(strokes.slice(0, i)));
      });
      jobs.push(() => {
        if (!a.length) return;
        const b = decode(kb, traceOf(strokes.slice(i)));
        if (!b.length) return;
        const keepBonus = merged && recent.word && i === recent.strokes.length && a[0].word === recent.word ? REWRITE_COST : 0;
        const score = a[0].score + b[0].score - WORD_COST + keepBonus;
        if (score > best.score) best = { parts: [a, b], score, split: i };
      });
    });
    const finish = () => {
      OUT.word = true;
      try {
        commitBest();
      } finally {
        OUT.word = false;
      }
    };
    const commitBest = () => {
      state.lastDecodeMs = Math.round(spent);
      if (!best.parts.every((c) => c.length)) {
        if (merged) Object.assign(T, saved);
        refreshSuggestions(kb);
        return;
      }
      const keep = merged && recent.word && best.split === recent.strokes.length && best.parts[0][0].word === recent.word;
      if (keep) Object.assign(T, saved);
      else if (merged) backspace(kb, recent.del ?? recent.text.length);
      let last = null;
      best.parts.forEach((c, i) => {
        if (keep && i === 0) return;
        const part = best.parts.length > 1 ? (i === 0 ? strokes.slice(0, best.split) : strokes.slice(best.split)) : strokes;
        const done = commitSwipe(kb, c, i === 0 ? flags : null, logSwipe(kb, best.parts.length > 1 ? traceOf(part) : trace, c));
        if (done) last = { ...done, strokes: part, flags: i === 0 ? flags : null };
      });
      if (last && T.fromSwipe?.text === last.text) {
        SW.recent = { ...last, end: Math.max(...last.strokes.map((x) => x.t1 ?? x.t0)) };
      }
    };
    const run = (all) => {
      const start = performance.now();
      do {
        const t0 = performance.now();
        jobs.shift()();
        spent += performance.now() - t0;
      } while (jobs.length && (all || performance.now() - start < SLICE_MS));
      if (jobs.length) return false;
      SW.finishing = null;
      finish();
      return true;
    };
    const f = { run, timer: null };
    SW.finishing = f;
    if (!spread) return run(true);
    const step = () => {
      f.timer = null;
      if (SW.finishing === f && !run(false)) f.timer = setTimeout(step, 0);
    };
    step();
  }

  function settleFinish() {
    const f = SW.finishing;
    if (!f) return;
    clearTimeout(f.timer);
    f.run(true);
  }

  function dropFinish() {
    clearTimeout(SW.finishing?.timer);
    SW.finishing = null;
  }

  function settleOnClose() {
    settleFinish();
    if (SW.gesture && SW.kb && !SW.held.L && !SW.held.R && SW.strokes.length) {
      try {
        finishGesture(SW.kb);
      } catch (e) {
        note(e);
      }
    }
    dropFinish();
    SW.recent = null;
  }

  function joinsRecent(strokes) {
    const r = SW.recent;
    return !!(r?.word && strokes[0] && strokes[0].t0 - r.end < JOIN_MS && T.buf.endsWith(r.text));
  }

  function traceOf(strokes) {
    const pts = [];
    for (const s of strokes) for (const p of s.pts) pts.push(p);
    return pts.sort((a, b) => a.t - b.t);
  }

  function commitTaps(kb, done) {
    settleFinish();
    const strokes = done ?? [...SW.strokes].sort((a, b) => a.t0 - b.t0);
    if (done) SW.strokes = SW.strokes.filter((s) => !done.includes(s));
    else resetSession();
    spaceAfterSwipe(kb, strokes[0]?.el?.getAttribute?.("data-key"));
    const chained = SW.recent && strokes[0] && strokes[0].t0 - SW.recent.end < JOIN_MS && T.buf.endsWith(SW.recent.text);
    const snapshot = chained ? SW.recent.snapshot : { buf: T.buf, prev: T.prev, lastOut: T.lastOut, fromSwipe: T.fromSwipe };
    const before = T.buf;
    SW.typing = true;
    try {
      for (const s of strokes) {
        SW.tapPt = { x: s.pts[0].x, y: s.pts[0].y, side: s.side };
        try {
          kb.TypeKey(s.el);
        } catch (e) {
          note(e);
        }
      }
    } finally {
      SW.typing = false;
      SW.tapPt = null;
    }
    const added = T.buf.startsWith(before) ? T.buf.slice(before.length) : null;
    if (added === null || added.length !== strokes.length) {
      SW.recent = null;
      return;
    }
    SW.recent = {
      strokes: [...(chained ? SW.recent.strokes : []), ...strokes],
      text: (chained ? SW.recent.text : "") + added,
      end: performance.now(),
      snapshot,
    };
  }

  function flushSession(kb) {
    settleFinish();
    if (!SW.strokes.length) return;
    if (SW.gesture || joinsRecent(SW.strokes)) finishGesture(kb);
    else commitTaps(kb);
  }

  function settleSwipe(kb) {
    settleFinish();
    if (SW.typing || !SW.strokes.length || SW.held.L || SW.held.R || SW.kb !== kb) return;
    clearTimeout(SW.timer);
    SW.timer = null;
    flushSession(kb);
  }

  function schedulePreview(kb) {
    if (SW.preview) return;
    const wait = Math.max(0, PREVIEW_MS - (performance.now() - SW.previewAt));
    SW.preview = setTimeout(() => {
      SW.preview = null;
      if (!SW.gesture || !SW.strokes.length || (SW.held.L && SW.held.R)) return;
      SW.previewAt = performance.now();
      const cands = decode(kb, sessionTrace());
      if (cands.length) setSuggestions(kb, [cands[1], { word: applyToggleCase(kb, cands[0].word) }, cands[2]], "preview", 1);
    }, wait);
  }

  function padSpan(side) {
    const r = settings.reach;
    if (r === "right") return side === "R" ? 1 : PAD_SPAN;
    return r === 75 || r === 100 ? r / 100 : PAD_SPAN;
  }

  const fullPad = () => padSpan("L") >= 0.99 || padSpan("R") >= 0.99;

  function startStroke(kb, side, el, x, y) {
    settleFinish();
    if (SW.kb !== kb) resetSession();
    SW.kb = kb;
    const boundary = !!SW.timer || !!SW.held.L || !!SW.held.R;
    if (SW.timer) {
      clearTimeout(SW.timer);
      SW.timer = null;
    }
    const t = performance.now();
    SW.press = (SW.press ?? 0) + 1;
    const tag = side + SW.press;
    const s = { side, tag, el, t0: t, moved: false, boundary, pts: [{ x, y, t, s: tag }] };
    SW.strokes.push(s);
    SW.held[side] = s;
    const f = caseFlags(kb);
    SW.flags = { caps: !!SW.flags?.caps || f.caps, shift: !!SW.flags?.shift || f.shift };
    setPadDown(kb, side, true);
    if (SW.gesture) drawTrail(kb, SW.strokes);
  }

  function addPoint(kb, s, x, y) {
    const last = s.pts[s.pts.length - 1];
    if (Math.hypot(x - last.x, y - last.y) < 2) return;
    s.pts.push({ x, y, t: performance.now(), s: s.tag ?? s.side });
    const span = padSpan(s.side);
    const sx = PAD_SPAN / span,
      sy = span >= 0.99 ? Math.min(1, settings.oneAspect / 3) : 1;
    if (!s.moved && padMoved(kb, s, sx, sy)) {
      s.moved = true;
      SW.gesture = true;
    }
    if (SW.gesture) {
      drawTrail(kb, SW.strokes);
      schedulePreview(kb);
    }
  }

  function padMoved(kb, s, sx, sy) {
    const p = s.pts[s.pts.length - 1];
    const k = Number(settings.deadzone) / 100 || 1;
    const dist = (a) => Math.hypot((p.x - a.x) * sx, (p.y - a.y) * sy) / keyWidth(kb);
    if (p.t < s.t0 + PAD_SETTLE_MS) return dist(s.pts[0]) > PAD_FAST_KEYS * k;
    let recent = s.pts[0],
      rest = s.pts[0];
    for (const a of s.pts) {
      if (a.t <= p.t - PAD_FAST_MS) recent = a;
      if (a.t <= s.t0 + PAD_SETTLE_MS) rest = a;
    }
    return dist(recent) > PAD_FAST_KEYS * k || dist(rest) > PAD_FAR_KEYS * k;
  }

  function onPadSample(kb, side, pad) {
    const s = SW.held[side];
    if (!s || SW.kb !== kb) return;
    addPoint(kb, s, pad.x, pad.y);
  }

  function endStroke(kb, side) {
    const s = SW.held[side];
    SW.held[side] = null;
    s.t1 = performance.now();
    setPadDown(kb, side, false);
    if (SW.held.L || SW.held.R) {
      if (!SW.gesture) {
        const order = [...SW.strokes].sort((a, b) => a.t0 - b.t0);
        const n = order.findIndex((x) => x === SW.held.L || x === SW.held.R);
        if (n > 0 && !joinsRecent(order)) commitTaps(kb, order.slice(0, n));
      }
      return;
    }
    if (SW.gesture) scheduleFinish(kb);
    else if (joinsRecent(SW.strokes)) finishGesture(kb);
    else commitTaps(kb);
  }

  function scheduleFinish(kb) {
    SW.timer = setTimeout(() => {
      SW.timer = null;
      finishGesture(kb, true);
    }, 0);
  }

  function inputSettings() {
    if (state.inputSettings) return state.inputSettings;
    if (!scanDue("input")) return null;
    const req = webpackRequire();
    for (const m of Object.values(req?.c ?? {})) {
      const ex = m?.exports;
      if (!ex || typeof ex !== "object") continue;
      for (const k of Object.keys(ex)) {
        let v;
        try {
          v = ex[k];
        } catch (e) {
          continue;
        }
        if (v && typeof v === "object" && "TrackpadTypingTriggerAsClick" in v) return (state.inputSettings = v);
      }
    }
    return null;
  }

  function padSideFor(kb, button) {
    if (button === LPAD_CLICK) return "L";
    if (button === RPAD_CLICK) return "R";
    if (button !== TRIGGER_LEFT && button !== TRIGGER_RIGHT) return null;
    const side = button === TRIGGER_LEFT ? "L" : "R";
    if (SW.held[side]?.trigger || SW.swallow[side] === "trigger") return side;
    const pad = side === "L" ? kb.m_leftTrackpad : kb.m_rightTrackpad;
    let asClick = false;
    try {
      asClick = !!inputSettings()?.TrackpadTypingTriggerAsClick;
    } catch (e) {}
    return pad?.active && asClick ? side : null;
  }

  function startSugHold(kb, side, i) {
    const old = SW.sugHold;
    if (old) {
      clearTimeout(old.timer);
      setPadDown(kb, old.side, false);
    }
    const h = { side, i, word: T.sugs[i]?.word, done: false };
    h.timer = setTimeout(() => {
      h.done = true;
      const item = T.sugs[h.i];
      if (item?.word && !item.add && item.word === h.word) blockWord(kb, item.word);
    }, HOLD_MS);
    SW.sugHold = h;
    setPadDown(kb, side, true);
  }

  function endSugHold(kb) {
    const h = SW.sugHold;
    SW.sugHold = null;
    if (!h) return;
    clearTimeout(h.timer);
    setPadDown(kb, h.side, false);
    if (!h.done) {
      try {
        pickSuggestion(kb, h.i);
      } catch (e) {
        note(e);
      }
    }
  }

  function startEchoHold() {
    clearTimeout(SW.echoHold?.timer);
    const h = {};
    h.timer = setTimeout(() => {
      if (SW.echoHold !== h) return;
      setSetting("privateMode", !settings.privateMode);
    }, HOLD_MS);
    SW.echoHold = h;
  }

  function endEchoHold() {
    clearTimeout(SW.echoHold?.timer);
    SW.echoHold = null;
  }

  function startEmojiHold(kb, side, el) {
    const old = SW.emojiHold;
    if (old) {
      clearTimeout(old.timer);
      holdRing(old.el, false);
      if (old.side === "L" || old.side === "R") setPadDown(kb, old.side, false);
    }
    const h = { side, el, done: false };
    h.timer = setTimeout(() => {
      h.done = true;
      holdRing(el, false);
      openPanel(kb);
      focusFirst();
    }, HOLD_MS);
    SW.emojiHold = h;
    holdRing(el, true);
    if (side === "L" || side === "R") setPadDown(kb, side, true);
  }

  function endEmojiHold(kb) {
    const h = SW.emojiHold;
    SW.emojiHold = null;
    if (!h) return;
    clearTimeout(h.timer);
    holdRing(h.el, false);
    if (h.side === "L" || h.side === "R") setPadDown(kb, h.side, false);
    if (!h.done) {
      try {
        kb.TypeKey(h.el);
      } catch (e) {
        note(e);
      }
    }
  }

  function clearSlide() {
    SL.s?.el?.classList?.remove("osk-sliding", "osk-slide-left", "osk-slide-right");
    SL.s = null;
  }

  function holdRing(el, on) {
    try {
      el?.classList?.toggle("osk-holding", on);
    } catch (e) {}
  }

  function slideAllowed(kb) {
    if (!settings.slideCursor || P.open || !kb || !isOpen(kb)) return false;
    if (kb.state?.layoutState !== 0 && kb.state?.layoutState !== 1) return false;
    const ts = kb.state.toggleStates ?? {};
    return !(active(ts.Control) || active(ts.Alt) || active(ts.AltGr));
  }

  function keyWidth(kb) {
    return moveThreshold(kb) / MOVE_KEYS;
  }

  function slideScale(s) {
    return s.side === "T" ? 1 : padSpan(s.side) / PAD_SPAN;
  }

  function startSlide(kb, side, el, x, extra = {}) {
    SL.s = { kb, side, el, x0: x, last: x, t: performance.now(), acc: 0, speed: 0, active: false, done: false, ...extra };
  }

  function slideBegin(s) {
    s.active = true;
    s.el?.classList?.add("osk-sliding");
    const kb = s.kb;
    if (s.side === "T") {
      try {
        kb.m_mapTouched?.delete(s.target);
        kb.CancelLongPressTimer?.(TOUCH);
        kb.ClearHoldTarget?.(TOUCH);
      } catch (e) {
        note(e);
      }
    }
    if (T.buf) commitBuffer("end");
    resetTracker();
    T.autocorr = null;
    echoReset(true);
    refreshSuggestions(kb);
  }

  function slideTo(x) {
    const s = SL.s;
    if (!s || s.done || typeof x !== "number") return;
    const now = performance.now();
    const kw = keyWidth(s.kb) * slideScale(s);
    if (!s.active) {
      if (Math.abs(x - s.x0) <= kw * MOVE_KEYS) return;
      slideBegin(s);
      arrow(s.kb, x < s.x0 ? "ArrowLeft" : "ArrowRight");
      s.last = x;
      s.t = now;
      return;
    }
    const dx = x - s.last;
    const v = (Math.abs(dx) / kw / Math.max(1, now - s.t)) * 100;
    s.speed = s.speed * 0.5 + v * 0.5;
    s.last = x;
    s.t = now;
    s.acc += dx;
    const step = kw * (s.speed > SLIDE_FAST ? SLIDE_FAST_STEP : SLIDE_STEP);
    while (Math.abs(s.acc) >= step) {
      const d = Math.sign(s.acc);
      s.acc -= d * step;
      arrow(s.kb, d < 0 ? "ArrowLeft" : "ArrowRight");
    }
  }

  function arrow(kb, key) {
    const el = SL.s?.el;
    if (el?.classList) {
      el.classList.toggle("osk-slide-left", key === "ArrowLeft");
      el.classList.toggle("osk-slide-right", key === "ArrowRight");
    }
    const q = OUT.queue;
    const tail = q[q.length - 1];
    if (tail?.[2] === "arrow" && tail[1] !== key) {
      q.pop();
      return;
    }
    if (q.filter((x) => x[2] === "arrow").length >= Math.floor(SLIDE_LAG_MS / ARROW_GAP_MS)) {
      SL.dropped++;
      return;
    }
    const vkm = vkmOf(kb);
    emit(() => vkm.HandleVirtualKeyDown(key, false), key, "arrow");
  }

  function settleSlide() {
    const s = SL.s;
    if (!s || s.done) return;
    s.done = true;
    if (!s.active && s.side !== "T") {
      try {
        s.kb.TypeKey(s.el);
      } catch (e) {
        note(e);
      }
    }
  }

  function endPadSlide(kb) {
    const s = SL.s;
    clearSlide();
    setPadDown(kb, s.side, false);
    if (!s.done && !s.active) {
      try {
        kb.TypeKey(s.el);
      } catch (e) {
        note(e);
      }
    }
  }

  function onPadButton(e) {
    const button = e.detail?.button;
    if (TIP.el && e.type === "vgp_onbuttondown") hideTip();
    if (button !== LPAD_CLICK && button !== RPAD_CLICK && button !== TRIGGER_LEFT && button !== TRIGGER_RIGHT) return;
    const kbAny = findKeyboard(e.currentTarget?.document ?? e.target?.ownerDocument);
    const side = kbAny && padSideFor(kbAny, button);
    if (!side) return;
    const down = e.type === "vgp_onbuttondown";
    const isTrigger = button === TRIGGER_LEFT || button === TRIGGER_RIGHT;
    if (SW.held[side] && !!SW.held[side].trigger !== isTrigger) {
      e.stopImmediatePropagation();
      if (!down && isTrigger) {
        try {
          kbAny.setState((st) => ({ ...st, toggleStates: { ...st.toggleStates, Shift: st.toggleStates.Shift & ~3 } }));
        } catch (err) {
          note(err);
        }
      }
      return;
    }
    const kb = findKeyboard(e.currentTarget?.document ?? e.target?.ownerDocument);
    if (!kb) return;
    if (SL.s?.side === side && (!down || !e.detail?.is_repeat)) {
      e.stopImmediatePropagation();
      e.preventDefault();
      endPadSlide(kb);
      if (!down) return;
    }
    if (!down && SW.swallow[side]) {
      SW.swallow[side] = false;
      if (!SW.held[side]) {
        e.stopImmediatePropagation();
        setPadDown(kb, side, false);
        return;
      }
    }
    if (e.detail?.is_repeat) {
      if (SW.held[side] || SW.sugHold?.side === side || SW.emojiHold?.side === side || SL.s?.side === side) e.stopImmediatePropagation();
      return;
    }
    if (!down && SW.sugHold?.side === side) {
      e.stopImmediatePropagation();
      e.preventDefault();
      endSugHold(kb);
      return;
    }
    if (!down && SW.emojiHold?.side === side) {
      e.stopImmediatePropagation();
      e.preventDefault();
      endEmojiHold(kb);
      return;
    }
    try {
      if (down) {
        SW.swallow[side] = false;
        if (SL.s && SL.s.side !== side) settleSlide();
        const pad = side === "L" ? kb.m_leftTrackpad : kb.m_rightTrackpad;
        let hit = null;
        try {
          hit = kb.getElementFromPointWorkaround(pad.x, pad.y, side === "L" ? LPAD : RPAD);
        } catch (err) {}
        const hitKey = hit?.getAttribute?.("data-key") ?? "";
        pressFlash(side, hit);
        const sugIdx = hitKey.startsWith(SUG) ? Number(hitKey.slice(SUG.length)) : -1;
        if (sugIdx >= 0 && !SW.held[side]) {
          flushSession(kb);
          e.stopImmediatePropagation();
          e.preventDefault();
          startSugHold(kb, side, sugIdx);
          return;
        }
        const emojiEl = !SW.held[side] && !SW.emojiHold && hitKey === EMOJI ? hit : null;
        if (emojiEl) {
          flushSession(kb);
          e.stopImmediatePropagation();
          e.preventDefault();
          startEmojiHold(kb, side, emojiEl);
          return;
        }
        if (hitKey === " " && !SW.held[side] && !SL.s && slideAllowed(kb)) {
          flushSession(kb);
          e.stopImmediatePropagation();
          e.preventDefault();
          startSlide(kb, side, hit, pad.x);
          setPadDown(kb, side, true);
          return;
        }
        const el = swipeAllowed(kb) && /^[a-z]$/.test(hitKey) ? hit : null;
        if (SW.held[side]) endStroke(kb, side);
        if (!el) {
          flushSession(kb);
          return;
        }
        e.stopImmediatePropagation();
        e.preventDefault();
        startStroke(kb, side, el, pad.x, pad.y);
        SW.held[side].trigger = button === TRIGGER_LEFT || button === TRIGGER_RIGHT;
      } else if (SW.held[side]) {
        e.stopImmediatePropagation();
        e.preventDefault();
        endStroke(kb, side);
      }
    } catch (err) {
      note(err);
    }
  }

  function pressFlash(side, el) {
    const prev = SW.flash?.[side];
    if (prev) {
      clearTimeout(prev.timer);
      prev.el.classList.remove("osk-press");
    }
    if (!el?.classList || !el.getAttribute("data-key")) return;
    el.classList.add("osk-press");
    (SW.flash ??= {})[side] = { el, timer: setTimeout(() => el.classList.remove("osk-press"), 140) };
  }

  function onOutsidePointer(e) {
    const kb = findKeyboard(e.currentTarget?.document);
    if (!kb?.m_keyboardDiv || kb.m_keyboardDiv.contains(e.target) || P.el?.contains(e.target)) return;
    echoReset(true);
    if (T.buf || T.fromSwipe || T.prev) {
      resetTracker();
      refreshSuggestions(kb);
    }
  }

  function learnedWords() {
    let words = {};
    try {
      words = window.__oskEngine?.exportUser?.().words ?? {};
    } catch (e) {
      note(e);
    }
    return Object.entries(words)
      .filter(([, u]) => u?.c > 0)
      .map(([k, u]) => ({ k, d: u.d || k, c: u.c }))
      .sort((a, b) => b.c - a.c || a.k.localeCompare(b.k));
  }

  function wordLists() {
    const rev = state.userRev ?? 0;
    if (!P.words || P.words.rev !== rev) {
      const all = learnedWords();
      P.words = { rev, total: all.length, learned: all.slice(0, LEARNED_MAX) };
    }
    P.words.blocked = [...state.blocked].sort();
    return P.words;
  }

  function openPanel(kb, tab = "typing") {
    if (!kb?.m_keyboardDiv) return;
    hideTip();
    const doc = kb.m_keyboardDiv.ownerDocument;
    if (!doc?.body) return;
    try {
      flushSession(kb);
    } catch (e) {
      note(e);
    }
    resetSession();
    SW.touch = null;
    clearSlide();
    clearTrail(kb);
    injectStyle(doc);
    if (P.el?.ownerDocument !== doc) buildFrame(doc);
    P.kb = kb;
    P.open = true;
    P.page = 0;
    P.list = "learned";
    P.words = null;
    P.touch = null;
    P.drag = null;
    P.mouseDrag = null;
    setHover(null);
    for (const e of P.el.querySelectorAll(".osk-set-hover")) e.classList.remove("osk-set-hover");
    disarm();
    clearUndo();
    setFocus(null);
    const asking = tab === "consent";
    P.el.classList.toggle("osk-set-asking", asking);
    if (asking) {
      buildConsent();
      P.tab = "consent";
      paintFoot();
    } else {
      showTab(PANEL_ROWS[tab] ? tab : "typing");
      paintCount();
    }
    if (!P.el.isConnected) doc.body.appendChild(P.el);
    placePanel();
    if (P.shown && !asking) P.shown.el.scrollTop = 0;
    focusFirst();
    if (!asking) schedulePanelWork();
    renderEcho(kb);
    try {
      window.__oskModes?.sync?.(kb, layoutSupported() ? settings.mode : null, modeApi);
    } catch (e) {
      note(e);
    }
  }

  function schedulePanelWork() {
    clearTimeout(P.work);
    const step = () => {
      P.work = null;
      if (!P.open || state.stopped || P.tab === "consent") return;
      for (const pg of Object.values(P.pages)) pg.el.classList.remove("pre");
      if (!P.words) {
        wordLists();
        paintCount();
        if (P.tab === "words") paintWords();
      } else {
        const next = PANEL_TABS.find(([id]) => !P.pages[id]);
        if (!next) return;
        const pg = buildPage(next[0]);
        for (const r of pg.all) r.paint?.();
        if (next[0] === "words") paintWords();
      }
      P.work = setTimeout(step, 40);
    };
    P.work = setTimeout(step, 60);
  }

  function focusFirst() {
    if (!P.open) return;
    if (P.tab === "consent") return setFocus(SET + "consent_on");
    setFocus(P.pages[P.tab]?.rows[0]?.key ?? SET + `tab_${P.tab}`);
  }

  function closePanel() {
    releaseSlider();
    stopRepeat();
    disarm();
    clearUndo();
    clearTimeout(P.clearedTimer);
    clearTimeout(P.work);
    P.work = null;
    if (P.open && P.tab === "consent" && !settings.consent) state.consentLater = true;
    P.open = false;
    setFocus(null);
    setHover(null);
    P.el?.remove();
    P.touch = null;
    P.drag = null;
    P.mouseDrag = null;
    if (P.lookDue) {
      P.lookDue = false;
      for (const doc of documents()) applyLook(doc);
    }
    if (P.kb && !state.stopped && isOpen(P.kb)) {
      try {
        window.__oskModes?.sync?.(P.kb, layoutSupported() ? settings.mode : null, modeApi);
      } catch (e) {
        note(e);
      }
    }
    if (EC.el) scheduleEcho();
  }

  function placePanel() {
    const r = P.kb?.m_keyboardDiv?.getBoundingClientRect();
    if (!r || !P.el) return;
    const { z, f } = zoomOf(P.kb);
    const k = f / z;
    const zoom = z === 1 ? "" : String(z);
    if (P.el.style.zoom !== zoom) P.el.style.zoom = zoom;
    const h = Math.max(r.height * k, PANEL_MIN_H);
    const top = Math.max(0, r.bottom * k - h);
    const box = [`${r.left * k}px`, `${top}px`, `${r.width * k}px`, `${r.bottom * k - top}px`];
    if (P.box === box.join()) return;
    P.box = box.join();
    Object.assign(P.el.style, { left: box[0], top: box[1], width: box[2], height: box[3] });
    const w = r.width * k;
    if (P.el.classList.contains("narrow") !== w < PANEL_NARROW) P.el.classList.toggle("narrow", w < PANEL_NARROW);
    if (P.el.classList.contains("tiny") !== w < PANEL_TINY) P.el.classList.toggle("tiny", w < PANEL_TINY);
  }

  function panelPadY(kb, y) {
    if (!P.el?.isConnected || P.kb !== kb) return y;
    const p = P.el.getBoundingClientRect();
    const r = kb.m_keyboardDiv?.getBoundingClientRect();
    if (!r?.height || p.height - r.height < 1) return y;
    return p.top + ((y - r.top) * p.height) / r.height;
  }

  function panelPadNested(kb, pad, side, x, y) {
    const last = pad.lastElement;
    if (!last?.querySelector?.("[data-key]") || !P.el?.contains(last)) return;
    const r = last.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return;
    if (kb.getElementFromPointWorkaround(x, y, side === "L" ? LPAD : RPAD) === last) return;
    kb.OnTrackpadHover(last, undefined);
    pad.lastElement = undefined;
  }

  function panelPadScroll(side, x, y) {
    const pg = P.shown?.el;
    const now = performance.now();
    const last = P.edge?.[side] ?? now;
    (P.edge ??= {})[side] = now;
    if (!pg || pg.scrollHeight - pg.clientHeight < 2) return;
    const r = pg.getBoundingClientRect();
    if (x < r.left || x > r.right) return;
    const d = y > r.bottom - 20 ? 1 : y < r.top + 14 ? -1 : 0;
    if (d) pg.scrollTop += d * Math.min(now - last, 50) * 0.3;
  }

  function versionLine() {
    const v = logVersions();
    return `VaporType v${v.keyboard} · engine v${v.engine} · words v${v.words} · pairs v${v.pairs} · modes v${v.modes} · installed ${v.installed ?? "unknown"}`;
  }

  function el(cls, text) {
    const d = P.doc.createElement("div");
    if (cls) d.className = cls;
    if (text !== undefined) d.appendChild(P.doc.createTextNode(text));
    return d;
  }

  function setText(e, text) {
    const t = e.firstChild;
    if (t?.nodeType === 3 && !t.nextSibling) {
      if (t.data !== text) t.data = text;
    } else e.textContent = text;
  }

  function keyEl(id, cls, text) {
    const b = el(`osk-set-btn ${cls}`, text);
    b.setAttribute("data-key", SET + id);
    return b;
  }

  function addRow(r, pg) {
    if (r.key) P.rows.set(r.key, r);
    for (const name of r.bind ?? []) {
      if (!P.bound.has(name)) P.bound.set(name, []);
      P.bound.get(name).push(r);
    }
    if (pg) {
      pg.all.push(r);
      if (r.key && r.focus !== false) pg.rows.push(r);
      pg.col.appendChild(r.el);
    }
    return r;
  }

  function buildFrame(doc) {
    P.el?.remove();
    P.doc = doc;
    P.rows = new Map();
    P.bound = new Map();
    P.pages = {};
    P.shown = null;
    P.consentEl = null;
    P.footKey = null;
    P.hints = null;
    P.box = null;
    P.focusEl = null;
    P.el = el("osk-set");
    P.el.addEventListener("click", (e) => {
      const k = e.target?.closest?.("[data-key]")?.getAttribute("data-key");
      e.stopPropagation();
      if (k) pointerActivate(k, e.isTrusted ? e.clientX : undefined, e.clientY);
    });
    P.el.addEventListener("mouseover", (e) => {
      if (P.open) setHover(e.target?.closest?.(".osk-set-btn")?.getAttribute("data-key") ?? null);
    });
    P.el.addEventListener("mouseleave", () => P.open && setHover(null));
    P.el.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      const k = e.target?.closest?.("[data-key]")?.getAttribute("data-key");
      P.mouseDrag = grabSlider(k, e.clientX, e.clientY);
      if (P.mouseDrag) e.target.setPointerCapture?.(e.pointerId);
    });
    P.el.addEventListener("pointermove", (e) => {
      if (P.open && P.mouseDrag && e.buttons & 1) dragSlider(P.mouseDrag, e.clientX);
    });
    for (const t of ["pointerup", "pointercancel"]) P.el.addEventListener(t, () => (P.mouseDrag = null));
    const tabs = el("osk-set-tabs");
    P.tabEls = {};
    for (const [id, label, icon] of PANEL_TABS) {
      const b = keyEl(`tab_${id}`, "osk-set-tab");
      const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "osk-set-ico");
      svg.setAttribute("viewBox", "0 0 24 24");
      const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("fill-rule", "evenodd");
      path.setAttribute("d", ICONS_SVG[icon]);
      svg.appendChild(path);
      b.append(svg, el("osk-set-tab-label", label));
      if (id === "words") {
        P.wordCount = el("osk-set-tab-count");
        P.wordCount.hidden = true;
        b.appendChild(P.wordCount);
      }
      P.tabEls[id] = b;
      tabs.appendChild(b);
      addRow({ key: SET + `tab_${id}`, el: b, type: "tab", act: () => showTab(id) });
    }
    tabs.appendChild(addRow({ key: SET + "close", el: keyEl("close", "osk-set-close", "✕"), type: "close", act: () => closePanel() }).el);
    P.body = el("osk-set-body");
    const foot = el("osk-set-foot");
    P.hint = el("osk-set-hint");
    P.undoEl = keyEl("undo", "osk-set-undo");
    P.undoEl.hidden = true;
    addRow({ key: SET + "undo", el: P.undoEl, type: "undo", act: () => doUndo() });
    P.pager = el("osk-set-pager");
    P.pager.hidden = true;
    P.pageNo = el("osk-set-pageno", "");
    for (const [id, text, d] of [
      ["prev", "‹", -1],
      ["next", "›", 1],
    ])
      addRow({ key: SET + id, el: keyEl(id, "osk-set-page-btn", text), type: "pager", act: () => stepPage(d) });
    P.pager.append(P.rows.get(SET + "prev").el, P.pageNo, P.rows.get(SET + "next").el);
    foot.append(P.hint, P.undoEl, P.pager);
    P.el.append(tabs, P.body, foot);
  }

  function buildConsent() {
    if (P.consentEl) return;
    const card = el("osk-set-consent");
    card.appendChild(
      el("osk-set-consent-text", "VaporType can learn words you type and show what you typed above the keys. Both stay on this Deck."),
    );
    const row = el("osk-set-consent-buttons");
    const answer = (on) => () => {
      setSetting("learn", on);
      setSetting("echo", on);
      setSetting("consent", true);
      closePanel();
    };
    for (const [id, cls, text, on] of [
      ["consent_on", "osk-set-primary", "Turn on", true],
      ["consent_off", "osk-set-secondary", "Keep off", false],
    ])
      row.appendChild(addRow({ key: SET + id, el: keyEl(id, cls, text), type: "consent", act: answer(on) }).el);
    card.appendChild(row);
    const hint = el("osk-set-consent-hint", "You can change both later: hold ");
    hint.append(el("osk-gear"), " (the emoji key) for settings.");
    card.append(hint, el("osk-set-consent-later", "B: later"));
    P.consentEl = card;
    P.el.appendChild(card);
  }

  function buildPage(id) {
    if (P.pages[id]) return P.pages[id];
    const pg = { id, el: el("osk-set-page pre"), rows: [], all: [] };
    for (const sections of PANEL_ROWS[id]) {
      pg.col = el("osk-set-col");
      pg.el.appendChild(pg.col);
      for (const [title, ids] of sections) {
        if (title) pg.col.appendChild(el("osk-set-sec", title));
        for (const rid of ids) buildRow(rid, pg);
      }
    }
    P.pages[id] = pg;
    P.body.appendChild(pg.el);
    return pg;
  }

  function buildRow(id, pg) {
    const k = id.slice(2);
    if (id.startsWith("t_")) return addRow(toggleRow(k), pg);
    if (id.startsWith("s_")) return addRow(sliderRow(k), pg);
    if (id === "c_blur")
      return addRow(
        segRow(
          id,
          GLASS[0],
          GLASS[1],
          () => settings.blur,
          (v) => setSetting("blur", v),
          ["blur"],
        ),
        pg,
      );
    if (id === "c_list") {
      const r = segRow(
        id,
        "List",
        [
          ["learned", "Learned", "Your most used words; A forgets one"],
          ["blocked", "Blocked", "Words you held to block; A unblocks one"],
        ],
        () => P.list,
        (v) => {
          P.words = null;
          if (P.list !== v) {
            P.list = v;
            P.page = 0;
            clearUndo();
            r.paint();
          }
          paintWords();
        },
      );
      P.listRow = r;
      r.el.classList.add("osk-set-inline");
      return addRow(r, pg);
    }
    if (id === "preview") return addRow(previewRow(), pg);
    if (id.startsWith("c_")) {
      const [label, values] = CHOICES[k];
      const r = segRow(
        id,
        label,
        values,
        () => settings[k],
        (v) => setSetting(k, v),
        k === "oneAspect" ? [k, "reach"] : [k],
      );
      if (k === "oneAspect") {
        const paint = r.paint;
        r.paint = () => {
          r.el.hidden = !fullPad();
          paint();
        };
      }
      return addRow(r, pg);
    }
    if (id === "reset_look")
      return addRow(
        actionRow("reset_look", "Reset look", "Modern theme, default see-through, no blur", () => resetLook()),
        pg,
      );
    if (id === "clear_log") return addRow(clearLogRow(), pg);
    if (id === "forget_all") return addRow(forgetRow(), pg);
    if (id === "version") return addRow({ el: el("osk-set-version", versionLine()), focus: false }, pg);
    if (id === "help") return addRow({ el: helpCard(), focus: false }, pg);
    if (id === "words") {
      const col = pg.col;
      pg.col = el("osk-set-words");
      col.appendChild(pg.col);
      pg.items = [];
      for (let i = 0; i < LIST_PAGE; i++) {
        const b = keyEl(`w_${i}`, "osk-set-row osk-set-item");
        const r = { key: SET + `w_${i}`, el: b, type: "item", w: el("osk-set-word"), c: el("osk-set-count"), a: el("osk-set-chev") };
        r.act = () => actOnWord(i);
        b.append(r.w, r.c, r.a);
        b.hidden = true;
        pg.items.push(addRow(r, pg));
      }
      pg.col = col;
      P.empty = el("osk-set-empty");
      P.empty.hidden = true;
      col.appendChild(P.empty);
    }
  }

  function labelEl(b, label, r) {
    const l = el("osk-set-label", label);
    r.d = el("osk-set-desc", r.info ?? "");
    b.append(l, r.d);
    return l;
  }

  function setInfo(r, text) {
    if (r.info === text) return;
    r.info = text;
    paintDesc(r);
  }

  function paintDesc(r) {
    if (!r?.d) return;
    setText(r.d, r.peek ?? r.info ?? "");
    const peek = !!r.peek;
    if (r.pk !== peek) r.d.classList.toggle("peek", (r.pk = peek));
  }

  function toggleRow(k) {
    const [, label, desc] = TOGGLE_LABELS.find(([x]) => x === k);
    const b = keyEl(`t_${k}`, "osk-set-row osk-set-toggle");
    b.setAttribute("role", "switch");
    const r = {
      key: SET + `t_${k}`,
      el: b,
      type: "toggle",
      info: desc,
      bind: [...new Set([k, "privateMode", "consent"])],
      paint() {
        const on = !!settings[k];
        const paused = on && !eff(k);
        if (r.v !== on) {
          r.v = on;
          b.classList.toggle("on", on);
          b.setAttribute("aria-checked", String(on));
        }
        if (r.p !== paused) b.classList.toggle("paused", (r.p = paused));
        setInfo(r, paused ? (settings.privateMode ? "Paused while private mode is on" : "Paused until first use is answered") : desc);
      },
      act: () => setSetting(k, !settings[k]),
    };
    labelEl(b, label, r);
    b.appendChild(el("osk-set-switch"));
    return r;
  }

  function sliderRow(k) {
    const sl = SLIDERS[k];
    const b = keyEl(`s_${k}`, "osk-set-row osk-set-slider");
    b.setAttribute("role", "slider");
    b.setAttribute("aria-label", sl.label);
    b.setAttribute("aria-valuemin", String(sl.min));
    b.setAttribute("aria-valuemax", String(sl.max));
    const val = el("osk-set-val");
    const track = el("osk-set-track");
    const fill = el("osk-set-fill");
    const knob = el("osk-set-knob");
    track.append(fill, knob);
    const r = {
      key: SET + `s_${k}`,
      el: b,
      type: "slider",
      info: sl.desc,
      track,
      bind: [k],
      paint() {
        const v = settings[k];
        if (r.v === v) return;
        r.v = v;
        const f = (v - sl.min) / (sl.max - sl.min);
        setText(val, sl.text(v));
        fill.style.transform = `scaleX(${f})`;
        knob.style.transform = `translateX(${+(f * 100).toFixed(2)}%)`;
        b.setAttribute("aria-valuenow", String(v));
        b.setAttribute("aria-valuetext", sl.text(v));
      },
      act: (x, drag, y) => pickSlider(k, x, track, drag, y),
      step: (dir, button) => holdSlider(k, dir, button),
    };
    labelEl(b, sl.label, r);
    b.append(val, track);
    return r;
  }

  function segRow(id, label, values, get, set, bind) {
    const b = keyEl(id, "osk-set-row osk-set-segrow");
    const group = el("osk-set-seg");
    const btns = values.map(([v, name, desc, short], i) => {
      const s = keyEl(`v_${id.slice(2)}_${i}`, "osk-set-segbtn", short ?? name);
      group.appendChild(s);
      addRow({ key: s.getAttribute("data-key"), el: s, owner: SET + id, info: `${name}: ${desc}`, act: () => set(v) });
      return s;
    });
    const at = () => values.findIndex(([v]) => v === get());
    const r = {
      key: SET + id,
      el: b,
      type: "seg",
      btns,
      bind,
      info: "",
      paint() {
        const i = at();
        if (r.v === i) return;
        if (r.v >= 0) btns[r.v]?.classList.remove("on");
        if (i >= 0) btns[i].classList.add("on");
        r.v = i;
        setInfo(r, values[i]?.[2] ?? "");
      },
      act: () => set(values[(at() + 1) % values.length][0]),
      step(dir) {
        const i = at();
        const j = Math.min(values.length - 1, Math.max(0, i + dir));
        if (j !== i) set(values[j][0]);
      },
    };
    labelEl(b, label, r);
    b.appendChild(group);
    return r;
  }

  function actionRow(id, label, desc, fn) {
    const b = keyEl(id, "osk-set-row osk-set-action");
    const r = { key: SET + id, el: b, type: "action", info: desc, act: fn };
    r.l = labelEl(b, label, r);
    b.appendChild(el("osk-set-chev", "›"));
    return r;
  }

  const logEmpty = () => !settings.typingLog && !settings.logFile && !LOG.out.length;

  function clearLogRow() {
    const r = actionRow("clear_log", "Clear typing log", "", () => {
      if (logEmpty()) return;
      clearTypingLog();
      P.cleared = performance.now();
      r.paint();
      clearTimeout(P.clearedTimer);
      P.clearedTimer = setTimeout(() => r.paint(), 5000);
    });
    r.bind = ["typingLog", "logFile", "privateMode"];
    r.paint = () => {
      const empty = logEmpty();
      const done = P.cleared && performance.now() - P.cleared < 5000;
      const text = done ? "Cleared" : empty ? "No log to clear" : "Deletes the log file on this Deck";
      setText(r.l, done ? "Typing log cleared" : "Clear typing log");
      if (r.v === text + empty) return;
      r.v = text + empty;
      r.el.classList.toggle("osk-set-disabled", empty);
      setInfo(r, text);
    };
    return r;
  }

  function forgetRow() {
    const r = actionRow("forget_all", "Forget everything", "Learned and blocked words and the typing log", () => {
      if (P.confirm && performance.now() - P.confirm < UNDO_MS) {
        disarm();
        state.forgetAll();
        P.words = null;
        paintCount();
        setInfo(r, "Done: learned and blocked words and the log are gone");
        return;
      }
      P.confirm = performance.now();
      r.el.classList.add("armed");
      setText(r.l, "Press again to forget");
      setInfo(r, "B cancels · this cannot be undone");
      clearTimeout(P.armTimer);
      P.armTimer = setTimeout(disarm, UNDO_MS);
      paintFoot();
    });
    r.type = "danger";
    r.el.classList.add("osk-set-danger");
    P.forgetRow = r;
    return r;
  }

  function disarm() {
    clearTimeout(P.armTimer);
    if (!P.confirm) return false;
    P.confirm = 0;
    const r = P.forgetRow;
    if (r) {
      r.el.classList.remove("armed");
      setText(r.l, "Forget everything");
      setInfo(r, "Learned and blocked words and the typing log");
    }
    paintFoot();
    return true;
  }

  function helpCard() {
    const card = el("osk-set-help");
    for (const [k, v] of [
      ["Pads", "Point, click, drag a slider"],
      ["A", "Select"],
      ["▴ ▾", "Move, hold to repeat"],
      ["B", "Back, then close"],
      ["◂ ▸", "Change, or other column"],
      ["LB RB", "Previous / next tab"],
      ["Hold text", "Private mode"],
      ["LT RT", "Page words, else tab"],
    ])
      card.append(el("osk-set-k", k), el("osk-set-help-text", v));
    return card;
  }

  function previewRow() {
    const pv = el("osk-set-pv");
    const kb = el("osk-set-pv-kb");
    const strip = el("osk-set-pv-strip");
    for (const w of ["the", "they", "then"]) strip.appendChild(el("osk-set-pv-chip", w));
    const keys = el("osk-set-pv-keys");
    const letters = ["q", "w", "e"].map((k) => el("osk-set-pv-key", k));
    const meta = el("osk-set-pv-key osk-set-pv-meta", "⌫");
    keys.append(...letters, meta);
    const space = el("osk-set-pv-space");
    kb.append(strip, keys, space);
    pv.append(el("osk-set-pv-check"), kb);
    const parts = [
      [
        pv,
        () => {
          const t = THEMES[settings.theme] ?? THEMES.steam;
          const c = (x) => x.join(",");
          return `--pv-board:${c(t.board)};--pv-key:${c(t.key)};--pv-meta:${c(t.meta)};--pv-text:${t.text ?? "#dcdedf"};--pv-round:${t.round ?? 3}px`;
        },
      ],
      [kb, (v) => `--osk-ba:${v["--osk-ba"]};--pv-blur:${BLUR_PX[settings.blur] ?? 0}px`],
      [strip, (v) => `--osk-ra:${v["--osk-ra"]}`],
      ...letters.map((k) => [k, (v) => `--osk-ka:${v["--osk-ka"]}`]),
      [meta, (v) => `--osk-ma:${v["--osk-ma"]}`],
      [space, (v) => `--osk-sa:${v["--osk-sa"]}`],
    ];
    const r = {
      el: pv,
      focus: false,
      bind: LOOK_RESET,
      paint() {
        const v = lookValues();
        for (const part of parts) {
          const css = part[1](v);
          if (part[2] !== css) part[0].style.cssText = part[2] = css;
        }
      },
    };
    return r;
  }

  function showTab(id) {
    if (P.tab !== id) disarm();
    if (id !== "words") clearUndo();
    P.tab = id;
    const pg = buildPage(id);
    if (P.shown !== pg) {
      P.shown?.el.classList.remove("on");
      pg.el.classList.remove("pre");
      pg.el.classList.add("on");
      P.shown = pg;
    }
    for (const [t] of PANEL_TABS) P.tabEls[t].classList.toggle("on", t === id);
    for (const r of pg.all) r.paint?.();
    if (id === "words") paintWords();
    paintFoot();
  }

  function paintCount() {
    if (!P.wordCount) return;
    const w = P.words;
    const n = w ? String(w.total + w.blocked.length) : "";
    setText(P.wordCount, n);
    P.wordCount.hidden = !n || n === "0";
  }

  function paintWords() {
    const pg = P.pages.words;
    if (!pg) return;
    const { learned, blocked } = wordLists();
    const isLearned = P.list !== "blocked";
    const items = isLearned ? learned : blocked;
    const pages = Math.max(1, Math.ceil(items.length / LIST_PAGE));
    P.page = Math.min(Math.max(P.page, 0), pages - 1);
    setText(P.listRow.btns[0], `Learned (${P.words.total})`);
    setText(P.listRow.btns[1], `Blocked (${blocked.length})`);
    pg.items.forEach((r, i) => {
      const it = items[P.page * LIST_PAGE + i];
      r.el.hidden = !it;
      if (!it) return;
      const [word, count] = isLearned ? [it.d, `×${it.c}`] : [it, ""];
      setText(r.w, word);
      setText(r.c, count);
      const act = isLearned ? "Forget" : "Unblock";
      setText(r.a, act);
    });
    P.empty.hidden = items.length > 0;
    setText(
      P.empty,
      isLearned ? "No learned words yet. Words you type often show up here." : "No blocked words. Hold a suggestion to block it.",
    );
    P.pages.words.count = pages;
    const f = P.rows.get(P.focus);
    if (f?.type === "item" && f.el.hidden) setFocus(pg.items.filter((r) => !r.el.hidden).at(-1)?.key ?? P.listRow.key);
    paintCount();
    paintFoot();
  }

  function actOnWord(i) {
    const { learned, blocked } = wordLists();
    const isLearned = P.list !== "blocked";
    const it = (isLearned ? learned : blocked)[P.page * LIST_PAGE + i];
    if (!it) return;
    const u = { kind: P.list, from: SET + `w_${i}` };
    if (isLearned) {
      u.k = it.k;
      u.d = it.d;
      try {
        const user = getEngine()?.exportUser?.();
        u.word = user?.words?.[it.k];
        u.bigrams = Object.fromEntries(
          Object.entries(user?.bigrams ?? {}).filter(([b]) => b.startsWith(it.k + " ") || b.endsWith(" " + it.k)),
        );
      } catch (e) {
        note(e);
      }
      state.forget(it.k);
    } else {
      u.k = u.d = it;
      unblockWord(it);
    }
    P.words = null;
    paintWords();
    clearTimeout(P.undo?.timer);
    P.undo = u;
    u.timer = setTimeout(clearUndo, UNDO_MS);
    setText(P.undoEl, `${isLearned ? "Forgot" : "Unblocked"} "${u.d}" — A to undo`);
    P.undoEl.hidden = false;
    setFocus(SET + "undo");
  }

  function doUndo() {
    const u = P.undo;
    if (!u) return;
    if (u.kind === "blocked") {
      state.blocked.add(u.k);
      userChanged();
      if (P.kb) refreshSuggestions(P.kb);
    } else {
      const eng = getEngine();
      try {
        const user = eng?.exportUser?.();
        if (user && u.word) {
          user.words[u.k] = u.word;
          Object.assign(user.bigrams, u.bigrams);
          eng.setUser(user);
          userChanged();
        }
      } catch (e) {
        note(e);
      }
    }
    clearUndo();
    P.words = null;
    paintWords();
    setFocus(u.from);
  }

  function clearUndo() {
    const u = P.undo;
    if (!u) return;
    clearTimeout(u.timer);
    P.undo = null;
    P.undoEl.hidden = true;
    if (P.focus === SET + "undo") {
      const back = P.rows.get(u.from);
      setFocus(back && !back.el.hidden ? u.from : (P.pages.words?.items.filter((r) => !r.el.hidden).at(-1)?.key ?? P.listRow?.key ?? null));
    }
  }

  const HINT = {
    tab: [
      ["◂ ▸", "Change"],
      ["A", "Select"],
    ],
    toggle: [["A", "Toggle"]],
    slider: [["◂ ▸", "Change"]],
    seg: [["◂ ▸", "Change"]],
    action: [["A", "Select"]],
    danger: [["A", "Select"]],
    item: [["A", "Forget"]],
    none: [["A", "Select"]],
  };

  function hintFor() {
    if (P.tab === "consent")
      return [
        ["◂ ▸", "Change"],
        ["A", "Select"],
        ["B", "Later"],
      ];
    if (P.confirm)
      return [
        ["A", "Confirm"],
        ["B", "Cancel"],
      ];
    const r = P.rows.get(P.focus);
    if (r?.type === "undo")
      return [
        ["A", "Undo"],
        ["B", "Close"],
      ];
    const own = r?.type === "item" && P.list === "blocked" ? [["A", "Unblock"]] : (HINT[r?.type] ?? HINT.none);
    const paged = P.tab === "words" && (P.pages.words?.count ?? 1) > 1 ? [["L2/R2", "Page"]] : [];
    return [...own, ...paged, ["LB/RB", "Tabs"], ["B", "Close"]];
  }

  function paintFoot() {
    if (!P.hint) return;
    const parts = hintFor();
    const key = parts.map((x) => x.join(" ")).join("|");
    if (P.footKey !== key) {
      P.hints ??= {};
      if (!P.hints[key]) {
        const h = el("osk-set-hint-set");
        for (const [k, label] of parts) h.append(el("osk-set-k", k), P.doc.createTextNode(label));
        P.hint.appendChild((P.hints[key] = h));
      }
      if (P.footKey) P.hints[P.footKey].hidden = true;
      P.hints[key].hidden = false;
      P.footKey = key;
    }
    const pages = P.tab === "words" ? (P.pages.words?.count ?? 1) : 1;
    const text = pages > 1 ? `Page ${P.page + 1} / ${pages}` : "";
    setText(P.pageNo, text);
    P.pager.hidden = !text;
  }

  function setHover(k) {
    if (P.hover === k) return;
    const was = P.hover && P.rows?.get(P.hover)?.owner;
    P.hover = k;
    const own = k && P.rows?.get(k)?.owner;
    if (was && was !== own) {
      const r = P.rows.get(was);
      r.peek = null;
      paintDesc(r);
    }
    if (own) {
      const r = P.rows.get(own);
      r.peek = P.rows.get(k).info;
      paintDesc(r);
    }
  }

  function paintSetting(name) {
    if (!P.bound) return;
    for (const r of P.bound.get(name) ?? []) r.paint();
  }

  function setFocus(k, scroll = true) {
    if (!P.el) return;
    if (P.focusEl && P.focusEl.getAttribute("data-key") !== k) P.focusEl.classList.remove("osk-set-focus");
    for (const e of P.el.querySelectorAll(".osk-set-focus")) if (e.getAttribute("data-key") !== k) e.classList.remove("osk-set-focus");
    P.focus = k;
    const r = k ? P.rows.get(k) : null;
    P.focusEl = r?.el ?? null;
    if (P.focusEl) {
      P.focusEl.classList.add("osk-set-focus");
      if (scroll && P.shown?.el.contains(P.focusEl)) scrollToRow(P.focusEl, P.shown.el);
    }
    paintFoot();
  }

  function scrollToRow(e, body) {
    const prev = e.previousElementSibling;
    const top = prev?.classList.contains("osk-set-sec") ? prev.offsetTop : e.offsetTop;
    const bottom = e.offsetTop + e.offsetHeight;
    const view = body.clientHeight;
    if (top - 4 < body.scrollTop) body.scrollTop = Math.max(0, top - 4);
    else if (bottom + 4 > body.scrollTop + view) body.scrollTop = bottom + 4 - view;
  }

  function sliderOf(k) {
    return P.rows?.get(`${SET}s_${k}`) ?? null;
  }

  function setSlider(k, v) {
    const sl = SLIDERS[k];
    v = Math.min(sl.max, Math.max(sl.min, v));
    return v !== settings[k] && setSetting(k, v);
  }

  function pickSlider(k, x, track, drag, y) {
    const sl = SLIDERS[k];
    if (typeof x !== "number") return setSlider(k, settings[k] >= sl.max ? sl.min : settings[k] + sl.step);
    const r = (track ?? sliderOf(k)?.track)?.getBoundingClientRect();
    if (!r?.width || (!drag && (x < r.left - 16 || x > r.right + 16 || y < r.top - 8))) return false;
    const f = Math.min(1, Math.max(0, (x - r.left) / r.width));
    return setSlider(k, sl.min + Math.round((f * (sl.max - sl.min)) / sl.step) * sl.step);
  }

  function grabSlider(key, x, y) {
    const r = P.rows.get(key);
    if (r?.type !== "slider") return null;
    const t = r.track.getBoundingClientRect();
    return { key, from: y < t.top - 8 ? [x, settings[r.bind[0]]] : null };
  }

  function dragSlider(d, x) {
    const r = P.rows.get(d.key);
    if (!d.from) return r?.act(x, true);
    const k = r.bind[0];
    const sl = SLIDERS[k];
    const w = r.track.getBoundingClientRect().width;
    const v = d.from[1] + ((x - d.from[0]) / w) * (sl.max - sl.min);
    if (w) setSlider(k, sl.min + Math.round((v - sl.min) / sl.step) * sl.step);
  }

  function holdSlider(k, dir, button) {
    releaseSlider();
    setSlider(k, settings[k] + dir * SLIDERS[k].step);
    const tick = () => {
      if (!P.open || !P.slide || !setSlider(k, settings[k] + dir * SLIDERS[k].step)) return releaseSlider();
      P.slide.timer = setTimeout(tick, SLIDER_REPEAT_MS);
    };
    P.slide = { button, timer: setTimeout(tick, SLIDER_DELAY_MS) };
  }

  function releaseSlider() {
    if (P.slide) clearTimeout(P.slide.timer);
    P.slide = null;
  }

  function startRepeat(button, fn) {
    stopRepeat();
    let n = 0;
    const tick = () => {
      if (!P.open || P.rep?.button !== button || ++n > 80) return stopRepeat();
      fn();
      P.rep.timer = setTimeout(tick, STICK_REPEAT_MS);
    };
    P.rep = { button, timer: setTimeout(tick, STICK_DELAY_MS) };
  }

  function stopRepeat() {
    if (P.rep) clearTimeout(P.rep.timer);
    P.rep = null;
  }

  function resetLook() {
    for (const k of LOOK_RESET) setSetting(k, DEFAULTS[k]);
  }

  function activate(key, x, y) {
    const r = P.rows?.get(key);
    if (!r?.act) return;
    try {
      r.act(x, false, y);
    } catch (e) {
      note(e);
    }
  }

  function pointerActivate(key, x, y) {
    const r = P.rows?.get(key);
    if (!r) return;
    const owner = r.owner ?? key;
    const t = P.rows.get(owner)?.type;
    if (t && t !== "close" && t !== "undo" && t !== "pager" && P.focus !== owner) setFocus(owner, false);
    activate(key, x, y);
  }

  function unblockWord(word) {
    state.blocked.delete(String(word).toLowerCase());
    userChanged();
    if (P.kb) refreshSuggestions(P.kb);
  }

  function focusOrder() {
    if (P.tab === "consent") return [SET + "consent_on", SET + "consent_off"];
    const pg = P.pages[P.tab];
    return [SET + `tab_${P.tab}`, ...(pg?.rows ?? []).filter((r) => !r.el.hidden).map((r) => r.key)];
  }

  function moveFocus(dir) {
    if (P.focus === SET + "undo" && P.undo) return setFocus(P.rows.get(P.undo.from)?.el.hidden === false ? P.undo.from : P.listRow.key);
    const order = focusOrder();
    const n = order.length;
    const i = order.indexOf(P.focus);
    const back = dir === "up" || dir === "left";
    if (i < 0) return setFocus(P.tab === "consent" ? order[0] : back ? order[n - 1] : (order[1] ?? order[0]));
    setFocus(order[(i + (back ? -1 : 1) + n) % n]);
  }

  function panelDir(dir, button) {
    const horiz = dir === "left" || dir === "right";
    const d = dir === "left" || dir === "up" ? -1 : 1;
    if (horiz && P.tab !== "consent") {
      const r = P.rows.get(P.focus);
      if (r?.type === "tab") {
        stepTab(d);
        return startRepeat(button, () => stepTab(d));
      }
      return r?.step ? r.step(d, button) : sideStep(d);
    }
    moveFocus(dir);
    startRepeat(button, () => moveFocus(dir));
  }

  function sideStep(d) {
    const cur = P.rows.get(P.focus)?.el;
    if (!cur || !P.shown?.el.contains(cur)) return;
    const a = cur.getBoundingClientRect();
    const mid = (a.top + a.bottom) / 2;
    let best = null;
    let gap = Infinity;
    for (const r of P.shown.rows) {
      if (r.el.hidden || r.el === cur) continue;
      const b = r.el.getBoundingClientRect();
      if (d < 0 ? b.right > a.left : b.left < a.right) continue;
      const dy = Math.abs((b.top + b.bottom) / 2 - mid);
      if (dy < gap) [best, gap] = [r.key, dy];
    }
    if (best) setFocus(best);
  }

  function stepTab(step) {
    if (P.tab === "consent") return;
    const ids = PANEL_TABS.map(([id]) => id);
    const i = ids.indexOf(P.tab);
    showTab(ids[(i + step + ids.length) % ids.length]);
    setFocus(SET + `tab_${P.tab}`);
  }

  function stepPage(step) {
    const pages = P.tab === "words" ? (P.pages.words?.count ?? 1) : 1;
    if (pages < 2) return stepTab(step);
    P.page = (Math.min(P.page, pages - 1) + step + pages) % pages;
    clearUndo();
    paintWords();
  }

  function onPanelButton(e) {
    const button = e.detail?.button;
    const down = e.type === "vgp_onbuttondown";
    const src = e.detail?.source;
    const fromGamepad = src === undefined || src === 1 || src === 2;
    if (button === OK_BTN && fromGamepad) {
      if (!down && SW.emojiHold?.side === "A") {
        e.stopImmediatePropagation();
        e.preventDefault();
        const kb = SW.emojiHold.kb;
        endEmojiHold(kb);
        P.aDown = false;
        return;
      }
      if (down && !P.open && !e.detail?.is_repeat) {
        const el = e.target?.closest?.("[data-key]");
        const kb = el && findKeyboard(el.ownerDocument);
        if (kb && el.getAttribute("data-key") === EMOJI && kb.m_keyboardDiv?.contains(el)) {
          e.stopImmediatePropagation();
          e.preventDefault();
          startEmojiHold(kb, "A", el);
          SW.emojiHold.kb = kb;
          return;
        }
      }
    }
    if (!down && P.slide?.button === button) releaseSlider();
    if (!down && P.rep?.button === button) stopRepeat();
    if (!down && P.held.delete(button)) {
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }
    const isTrigger = button === TRIGGER_LEFT || button === TRIGGER_RIGHT;
    const isPad = isTrigger || button === LPAD_CLICK || button === RPAD_CLICK;
    const kb = isPad ? (findKeyboard(e.currentTarget?.document ?? e.target?.ownerDocument) ?? P.kb) : null;
    const side = kb && padSideFor(kb, button);
    if (isPad && (side || !isTrigger)) {
      if (side && SW.emojiHold?.side === side) return;
      if (side && !down && P.padDown[side]) {
        P.padDown[side] = false;
        if (P.drag?.side === side) P.drag = null;
        e.stopImmediatePropagation();
        e.preventDefault();
        if (P.open) setPadDown(kb, side, false);
        return;
      }
      if (!P.open || !down) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (!side || e.detail?.is_repeat) return;
      P.padDown[side] = true;
      setPadDown(kb, side, true);
      const pad = side === "L" ? kb.m_leftTrackpad : kb.m_rightTrackpad;
      let el;
      try {
        el = kb.getElementFromPointWorkaround(pad.x, pad.y, side === "L" ? LPAD : RPAD);
      } catch (err) {
        note(err);
      }
      const k = el?.getAttribute?.("data-key") ?? "";
      if (!k.startsWith(SET) || !P.el?.contains(el)) return;
      const grab = grabSlider(k, pad.x, pad.y);
      pointerActivate(k, pad.x, pad.y);
      if (grab) P.drag = { side, ...grab };
      return;
    }
    if (button === OK_BTN && !down && P.aDown) {
      P.aDown = false;
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }
    if (!P.open || !PANEL_SWALLOW.has(button) || !down) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (e.detail?.is_repeat) return;
    if (button !== OK_BTN) P.held.add(button);
    if (button === CANCEL_BTN) return disarm() || closePanel();
    if (DIRS[button]) return panelDir(DIRS[button], button);
    if (TAB_STEP[button]) return stepTab(TAB_STEP[button]);
    if (PAGE_STEP[button]) return stepPage(PAGE_STEP[button]);
    if (button === OK_BTN) {
      P.aDown = true;
      const r = P.rows.get(P.focus);
      if (r?.type === "tab") setFocus(P.pages[P.tab]?.rows[0]?.key ?? P.focus);
      else if (r) activate(P.focus);
      else focusFirst();
    }
  }

  function onPanelTouch(e) {
    if (!P.open || !P.el) return false;
    const t = e.changedTouches?.[0];
    if (!t || !P.el.contains(t.target)) return false;
    e.stopPropagation();
    if (e.type === "touchstart") {
      const key = t.target.closest?.("[data-key]")?.getAttribute("data-key") ?? null;
      P.touch = { key, x: t.clientX, y: t.clientY, scroll: P.shown?.el.scrollTop ?? 0, drag: false };
    } else if (e.type === "touchmove") {
      const s = P.touch;
      const r = s?.key && P.rows.get(s.key);
      const dx = Math.abs(t.clientX - (s?.x ?? 0));
      if (r?.type === "slider" && (s.drag || (dx > 8 && dx > Math.abs(t.clientY - s.y)))) {
        s.drag = true;
        if (e.cancelable) e.preventDefault();
        if (P.focus !== s.key) setFocus(s.key, false);
        r.act(t.clientX, true);
      }
    } else if (e.type === "touchend") {
      if (e.cancelable) e.preventDefault();
      const s = P.touch;
      P.touch = null;
      if (!s?.key || s.drag || Math.abs((P.shown?.el.scrollTop ?? 0) - s.scroll) > 6) return true;
      const at = P.el.ownerDocument.elementFromPoint(t.clientX, t.clientY)?.closest?.("[data-key]");
      if (at?.getAttribute("data-key") === s.key) pointerActivate(s.key, t.clientX, t.clientY);
    } else if (e.type === "touchcancel") P.touch = null;
    return true;
  }

  function onTouch(e) {
    if (TIP.el && e.type === "touchstart") hideTip();
    const doc = e.currentTarget?.document;
    const kb = findKeyboard(doc);
    if (!kb) return;
    if (onPanelTouch(e)) return;
    if (e.type !== "touchmove") reassertHeld(kb);
    const zf = zoomOf(kb).f;
    try {
      if (e.type === "touchstart") {
        const sk = e.changedTouches[0]?.target?.closest?.("[data-key]")?.getAttribute("data-key") ?? "";
        if (!/^[a-z]$/.test(sk)) settleSwipe(kb);
        if (SL.s && SL.s.side !== "T") settleSlide();
        else if (SL.s) clearSlide();
        if (e.touches.length === 1 && e.changedTouches[0]?.target?.closest?.(".osk-echo.row")) startEchoHold();
        if (sk === " " && e.touches.length === 1 && slideAllowed(kb)) {
          const t0 = e.changedTouches[0];
          startSlide(kb, "T", t0.target.closest("[data-key]"), t0.clientX / zf, { id: t0.identifier, target: t0.target });
        }
        clearTimeout(SW.touchHold?.timer);
        SW.touchHold = null;
        clearTimeout(SW.emojiTouch?.timer);
        holdRing(SW.emojiTouch?.el, false);
        SW.emojiTouch = null;
        if (sk === EMOJI && e.touches.length === 1 && !P.open) {
          const h = { el: e.changedTouches[0].target.closest("[data-key]") };
          h.timer = setTimeout(() => {
            if (SW.emojiTouch !== h) return;
            holdRing(h.el, false);
            state.suppressEmoji = performance.now();
            openPanel(kb);
            focusFirst();
          }, HOLD_MS);
          SW.emojiTouch = h;
          holdRing(h.el, true);
          setTimeout(() => {
            try {
              kb.CancelLongPressTimer?.(TOUCH);
            } catch (err) {}
          }, 0);
        }
        if (sk.startsWith(SUG) && e.touches.length === 1) {
          const i = Number(sk.slice(SUG.length));
          const h = { i, word: T.sugs[i]?.word };
          h.timer = setTimeout(() => {
            const item = T.sugs[h.i];
            if (item?.word && !item.add && item.word === h.word) {
              state.suppressPick = performance.now();
              blockWord(kb, item.word);
            }
          }, HOLD_MS);
          SW.touchHold = h;
        }
        const t0 = e.changedTouches[0];
        const tk = t0?.target?.closest?.("[data-key]")?.getAttribute?.("data-key") ?? "";
        SW.touchTap = /^[a-z]$/.test(tk) ? { x: t0.clientX / zf, y: t0.clientY / zf, side: "T", t: performance.now() } : null;
        if (e.touches.length !== 1 || !swipeAllowed(kb)) {
          SW.touch = null;
          return;
        }
        const t = e.changedTouches[0];
        const keyEl = t.target?.closest?.("[data-key]");
        if (!kb.m_keyboardDiv?.contains(keyEl) || !/^[a-z]$/.test(keyEl.getAttribute("data-key"))) {
          SW.touch = null;
          return;
        }
        const now = performance.now();
        SW.touch = {
          id: t.identifier,
          target: t.target,
          moved: false,
          pts: [{ x: t.clientX / zf, y: t.clientY / zf, t: now, s: "T" }],
        };
        return;
      }
      if (e.type === "touchend" || e.type === "touchcancel") {
        if (SW.echoHold) endEchoHold();
        clearTimeout(SW.touchHold?.timer);
        SW.touchHold = null;
        clearTimeout(SW.emojiTouch?.timer);
        holdRing(SW.emojiTouch?.el, false);
        SW.emojiTouch = null;
      }
      if (SL.s?.side === "T") {
        const st = [...e.changedTouches].find((x) => x.identifier === SL.s.id);
        if (st && e.type === "touchmove" && e.touches.length === 1) slideTo(st.clientX / zf);
        else if (st || e.touches.length > 1) clearSlide();
      }
      const tt = SW.touch;
      if (!tt) return;
      if (e.touches.length > 1) {
        SW.touch = null;
        clearTrail(kb);
        return;
      }
      const t = [...e.changedTouches].find((x) => x.identifier === tt.id);
      if (!t) return;
      if (e.type === "touchmove") {
        const x = t.clientX / zf,
          y = t.clientY / zf;
        const last = tt.pts[tt.pts.length - 1];
        if (Math.hypot(x - last.x, y - last.y) < 2) return;
        tt.pts.push({ x, y, t: performance.now(), s: "T" });
        const f = caseFlags(kb);
        tt.flags = { caps: !!tt.flags?.caps || f.caps, shift: !!tt.flags?.shift || f.shift };
        if (!tt.moved && Math.hypot(x - tt.pts[0].x, y - tt.pts[0].y) > moveThreshold(kb)) {
          tt.moved = true;
          kb.m_mapTouched?.delete(tt.target);
          kb.CancelLongPressTimer?.(TOUCH);
          kb.ClearHoldTarget?.(TOUCH);
        }
        if (tt.moved) drawTrail(kb, [tt]);
        return;
      }
      SW.touch = null;
      if (!tt.moved) return;
      kb.m_mapTouched?.delete(tt.target);
      clearTrail(kb, 180);
      if (e.type === "touchend") {
        const c = decode(kb, tt.pts);
        commitSwipe(kb, c, tt.flags, c.length ? logSwipe(kb, tt.pts, c) : null);
      }
    } catch (err) {
      note(err);
    }
  }

  function injectStyle(doc) {
    if (!doc?.head || doc.getElementById("osk-swipe-style")) return;
    const st = doc.createElement("style");
    st.id = "osk-swipe-style";
    st.textContent = `[data-key^="${SUG}"]{flex:1 1 0 !important;width:auto !important;max-width:none !important;min-width:0 !important}
[data-key^="${SUG}"] *{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:1em !important;line-height:1.1 !important;max-width:100%}
.osk-sug-current, .osk-sug-current *{color:#fff !important;font-weight:700 !important}
[data-key^="${SUG}"].osk-sug-note *{font-size:.9em !important}
.osk-echo{position:absolute;z-index:1;pointer-events:none;box-sizing:border-box;display:flex;align-items:center;overflow:hidden;white-space:pre;font-family:"Motiva Sans",Arial,Helvetica,sans-serif;line-height:1.2}
.osk-echo[hidden]{display:none !important}
.osk-echo *{pointer-events:none}
.osk-echo-t{flex:none}
.osk-echo-mark{background:rgba(10,116,214,.35);border-radius:4px;box-shadow:inset 0 -2px 0 #4aa8ff;transition:background-color 400ms ease-out}
.osk-echo-c{flex:none;width:2px;height:1.15em;margin-left:1px;border-radius:1px;background:#4aa8ff;animation:osk-echo-blink 1.1s steps(1) infinite}
.osk-echo.over{justify-content:flex-end;-webkit-mask-image:linear-gradient(90deg,transparent 6px,rgba(0,0,0,.35) 22px,#000 56px);mask-image:linear-gradient(90deg,transparent 6px,rgba(0,0,0,.35) 22px,#000 56px)}
.osk-echo.row{pointer-events:auto}
.osk-echo.private .osk-echo-t{color:#aab2bf;font-style:italic}
.osk-echo.private .osk-echo-c{display:none}
.osk-echo.badged{width:calc(34% - 118px) !important}
.osk-badge{position:absolute;z-index:2;pointer-events:none;top:50%;transform:translateY(-50%);padding:2px 9px;border-radius:999px;background:#2c3542;color:#dfe6f0;font:600 12px/1.3 "Motiva Sans",Arial,Helvetica,sans-serif;white-space:nowrap}
.osk-badge[hidden]{display:none !important}
@keyframes osk-echo-blink{50%{opacity:0}}
[data-key="${EMOJI}"],[data-key=" "],[data-key="Control"],[data-key="Alt"]{position:relative}
[data-key="${EMOJI}"]::after{content:"";position:absolute;top:2px;right:3px;width:18px;height:18px;border-radius:50%;background:${GEAR_LIGHT} no-repeat center/14px,#0e141b;pointer-events:none}
.osk-gear{display:inline-block;width:1em;height:1em;vertical-align:-.12em;background:${GEAR} no-repeat center/contain}
[data-key="${EMOJI}"].osk-holding::before{content:"";position:absolute;z-index:3;left:50%;top:50%;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;pointer-events:none;background:conic-gradient(#4aa8ff var(--osk-hold),rgba(255,255,255,.18) 0);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 4px),#000 calc(100% - 4px));mask:radial-gradient(farthest-side,transparent calc(100% - 4px),#000 calc(100% - 4px));animation:osk-hold ${HOLD_MS}ms linear forwards}
@property --osk-hold{syntax:"<percentage>";inherits:false;initial-value:0%}
@keyframes osk-hold{from{--osk-hold:0%}to{--osk-hold:100%}}
[data-key=" "].osk-sliding > * > *{opacity:0 !important}
[data-key=" "].osk-slide-left::after{content:"◂  cursor" !important}
[data-key=" "].osk-slide-right::after{content:"cursor  ▸" !important}
[data-key=" "].osk-sliding::after{content:"◂  cursor  ▸";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:600 16px "Motiva Sans",Arial,Helvetica,sans-serif;letter-spacing:.04em;color:#fff;pointer-events:none}
.osk-toast{position:fixed;z-index:2147482500;pointer-events:none;box-sizing:border-box;padding:10px 16px;border-radius:12px;background:rgba(18,22,29,.96);color:#eef2f7;box-shadow:0 0 0 1px rgba(255,255,255,.12),0 8px 24px rgba(0,0,0,.45);font:15px/1.35 "Motiva Sans",Arial,Helvetica,sans-serif;transition:opacity 300ms ease-out}
.osk-toast b{color:#9fd0ff;font-weight:600}
.osk-toast[hidden]{display:none !important}
.osk-set{position:fixed;z-index:2147482000;box-sizing:border-box;display:flex;flex-direction:column;background:#12151a;border-top:1px solid rgba(255,255,255,.08);color:#e8ecf1;font-family:"Motiva Sans",Arial,Helvetica,sans-serif;font-size:12px;line-height:1.25;user-select:none;-webkit-user-select:none;touch-action:none;contain:strict;animation:osk-set-in 90ms ease-out}
@keyframes osk-set-in{from{opacity:0;transform:scale(.985)}}
@keyframes osk-set-arm{from{transform:scaleX(1)}to{transform:scaleX(0)}}
@media (prefers-reduced-motion:reduce){.osk-set{animation:none}}
.osk-set *{box-sizing:border-box}
.osk-set [hidden]{display:none !important}
.osk-set-btn{cursor:pointer}
.osk-set-btn *{pointer-events:none}
.osk-set-seg .osk-set-segbtn{pointer-events:auto}
.osk-set .osk-set-focus{outline:2px solid #4aa8ff;outline-offset:-2px}
.osk-set-tabs{flex:none;height:26px;display:flex;background:#0d1014;border-bottom:1px solid rgba(255,255,255,.07)}
.osk-set-tab{position:relative;flex:1 1 0;min-width:0;display:flex;align-items:center;justify-content:center;gap:5px;padding:0 6px;font-size:12px;font-weight:500;color:#8a93a1;white-space:nowrap}
.osk-set-tab.on{background:#18212c;color:#fff}
.osk-set-tab.on::after{content:"";position:absolute;left:22%;right:22%;bottom:0;height:2px;border-radius:2px 2px 0 0;background:#4aa8ff}
.osk-set-tab-count{min-width:16px;padding:0 4px;border-radius:999px;background:rgba(255,255,255,.1);font-size:10px;line-height:14px;text-align:center;color:#d5dbe4}
.osk-set-ico{flex:none;width:14px;height:14px;fill:currentColor}
.osk-set-close{flex:none;width:44px;display:flex;align-items:center;justify-content:center;border-left:1px solid rgba(255,255,255,.07);font-size:13px;color:#aab3c0}
.osk-set-tab:not(.on).osk-set-hover,.osk-set-close.osk-set-hover,.osk-set-page-btn.osk-set-hover,.osk-set-undo.osk-set-hover{background:#252c37;color:#fff}
@media (hover:hover){.osk-set-tab:not(.on):hover,.osk-set-close:hover,.osk-set-page-btn:hover,.osk-set-undo:hover{background:#252c37;color:#fff}}
.osk-set-body{position:relative;flex:1;min-height:0}
.osk-set-page{position:absolute;inset:0;display:flex;gap:8px;padding:4px 6px 6px;overflow-x:hidden;overflow-y:auto;touch-action:pan-y;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#3a414d transparent}
.osk-set-page:not(.on){content-visibility:hidden}
.osk-set-page.pre{content-visibility:visible;visibility:hidden}
.osk-set-page.on{z-index:1}
.osk-set-col{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:2px}
.osk-set-sec{flex:none;height:15px;display:flex;align-items:center;padding:0 8px;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6c7685}
.osk-set-row{position:relative;flex:none;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;column-gap:8px;min-height:26px;padding:3px 8px 4px;border-radius:6px;background:#1a1e25;contain:layout style}
.osk-set-row.osk-set-hover{background:#232a34;box-shadow:inset 0 0 0 1px rgba(220,232,255,.24)}
@media (hover:hover){.osk-set-row:hover{background:#232a34}}
.osk-set-row.osk-set-focus{background:#1a2c40}
.osk-set-label{grid-area:1/1;min-width:0;font-size:12px;font-weight:500;line-height:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.osk-set-desc{grid-area:2/1/3/-1;min-width:0;font-size:10.5px;line-height:13px;color:#8a93a1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.osk-set-desc.peek{color:#9fd0ff}
.osk-set-switch,.osk-set-seg,.osk-set-chev{grid-area:1/2}
.osk-set-action,.osk-set-slider,.osk-set-inline{grid-template-columns:auto minmax(0,1fr) auto}
.osk-set-action .osk-set-desc,.osk-set-slider .osk-set-desc,.osk-set-inline .osk-set-desc{grid-area:1/2;padding-top:1px}
.osk-set-action .osk-set-chev,.osk-set-slider .osk-set-val,.osk-set-inline .osk-set-seg{grid-area:1/3}
.osk-set-toggle.paused .osk-set-desc{color:#e0b05a}
.osk-set-toggle.paused .osk-set-switch{opacity:.5}
.osk-set-switch{position:relative;width:28px;height:16px;border-radius:999px;background:#3a414d;transition:background-color 90ms ease-out}
.osk-set-switch::after{content:"";position:absolute;left:2px;top:2px;width:12px;height:12px;border-radius:50%;background:#c3cad6;transition:transform 90ms ease-out}
.osk-set-toggle.on .osk-set-switch{background:${BLUE}}
.osk-set-toggle.on .osk-set-switch::after{transform:translateX(12px);background:#fff}
.osk-set-slider{touch-action:none;padding-bottom:2px}
.osk-set-val{width:36px;height:15px;line-height:15px;contain:strict;text-align:right;font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;color:#e2efff;white-space:nowrap}
.osk-set-track{grid-area:2/1/3/-1;position:relative;height:4px;margin:5px 6px 4px;border-radius:999px;background:#343b47}
.osk-set-fill{position:absolute;inset:0;border-radius:999px;background:${BLUE};transform-origin:0 50%;transform:scaleX(0)}
.osk-set-knob{position:absolute;left:-6px;top:-4px;width:100%;height:12px}
.osk-set-knob::before{content:"";position:absolute;left:0;top:0;width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:0 0 0 2px rgba(0,0,0,.3)}
.osk-set-seg{display:flex;gap:1px;margin:-1px 0;padding:1px;border-radius:5px;background:#0e1115}
.osk-set-segbtn{position:relative;min-width:40px;height:16px;padding:0 8px;display:flex;align-items:center;justify-content:center;border-radius:4px;font-size:11px;color:#a3acb9;white-space:nowrap}
.osk-set-segbtn::before{content:"";position:absolute;left:0;right:0;top:-5px;bottom:-8px}
.osk-set-segbtn.osk-set-hover{background:#2c3440;color:#fff;box-shadow:inset 0 0 0 1px rgba(220,232,255,.45)}
@media (hover:hover){.osk-set-segbtn:hover{background:#2c3440;color:#fff}}
.osk-set-segbtn.on{background:${BLUE};color:#fff;font-weight:600}
.osk-set-chev{font-size:15px;line-height:1;color:#7f8896}
.osk-set-disabled{opacity:.45}
.osk-set-danger .osk-set-label{color:#ff9b91}
.osk-set-danger.armed{background:#5c201c}
.osk-set-danger.armed .osk-set-label,.osk-set-danger.armed .osk-set-desc{color:#fff}
.osk-set-danger.armed::after{content:"";position:absolute;left:8px;right:8px;bottom:1px;height:2px;border-radius:2px;background:#ff9b91;transform-origin:0 50%;animation:osk-set-arm 5s linear forwards}
.osk-set-words{flex:none;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-rows:repeat(${LIST_PAGE / 2},auto);grid-auto-flow:column;gap:2px 8px}
.osk-set-item{display:flex}
.osk-set-word{flex:1;min-width:0;font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.osk-set-count{flex:none;font-size:10.5px;color:#8a93a1;font-variant-numeric:tabular-nums}
.osk-set-item .osk-set-chev{font-size:10.5px;opacity:.55}
.osk-set-item.osk-set-hover .osk-set-chev,.osk-set-item.osk-set-focus .osk-set-chev{opacity:1;color:#ff9b91}
@media (hover:hover){.osk-set-item:hover .osk-set-chev{opacity:1;color:#ff9b91}}
.osk-set-empty{padding:16px 12px;text-align:center;font-size:12px;color:#8a93a1}
.osk-set-help{flex:none;display:grid;grid-template-columns:auto minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:4px 6px;padding:6px 8px;border-radius:6px;background:#161a20;font-size:10.5px;color:#aeb6c2}
.osk-set-help .osk-set-k{justify-self:start}
.osk-set-help-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.osk-set-k{display:inline-block;min-width:15px;padding:0 4px;border-radius:3px;background:#2a313b;color:#e8ecf1;font-size:10px;font-weight:700;line-height:14px;text-align:center;white-space:nowrap}
.osk-set-version{flex:none;padding:4px 8px 0;font-size:10px;line-height:13px;color:#6c7685}
.osk-set-foot{flex:none;height:20px;display:flex;align-items:center;gap:8px;padding:0 6px 0 8px;background:#0d1014;border-top:1px solid rgba(255,255,255,.07);font-size:10.5px;color:#8a93a1}
.osk-set-hint{flex:1;min-width:0;white-space:nowrap;overflow:hidden}
.osk-set-hint .osk-set-k{margin:0 3px 0 9px}
.osk-set-hint .osk-set-k:first-child{margin-left:0}
.osk-set-undo{flex:none;height:16px;display:flex;align-items:center;padding:0 10px;border-radius:999px;background:#24364c;color:#eef2f7;white-space:nowrap}
.osk-set-pager{flex:none;display:flex;align-items:center;gap:2px}
.osk-set-pageno{min-width:64px;text-align:center;color:#c3cad6;font-variant-numeric:tabular-nums}
.osk-set-page-btn{position:relative;width:36px;height:16px;display:flex;align-items:center;justify-content:center;border-radius:999px;background:#232933;color:#e8ecf1;font-size:14px;line-height:1}
.osk-set-pv{position:relative;flex:none;height:36px;border-radius:6px;overflow:hidden;background:repeating-linear-gradient(90deg,rgba(255,255,255,.28) 0 2px,transparent 2px 14px),linear-gradient(120deg,#1f6fd1,#7a4bc2 50%,#f08a24)}
.osk-set-pv-check{position:absolute;left:0;right:0;top:3px;height:10px;background:repeating-conic-gradient(rgba(0,0,0,.35) 0 25%,rgba(255,255,255,.35) 0 50%) 0 0/6px 6px}
.osk-set-pv-kb{position:absolute;left:50%;top:3px;bottom:3px;width:160px;margin-left:-80px;display:flex;flex-direction:column;gap:2px;padding:0 4px 3px;border-radius:5px;background:rgba(var(--pv-board),var(--osk-ba));-webkit-backdrop-filter:blur(var(--pv-blur));backdrop-filter:blur(var(--pv-blur));color:var(--pv-text);font-size:8px;line-height:1}
.osk-set-pv-strip{height:10px;margin:0 -4px;padding:1px 4px;display:flex;gap:3px;border-radius:5px 5px 0 0;background:rgba(var(--pv-board),var(--osk-ra))}
.osk-set-pv-chip{flex:1;display:flex;align-items:center;justify-content:center;border-radius:999px;background:rgba(255,255,255,.08)}
.osk-set-pv-keys{flex:1;display:flex;gap:2px}
.osk-set-pv-key{flex:1;display:flex;align-items:center;justify-content:center;border-radius:calc(var(--pv-round) / 2);background:rgba(var(--pv-key),var(--osk-ka));font-size:9px}
.osk-set-pv-meta{background:rgba(var(--pv-meta),var(--osk-ma))}
.osk-set-pv-space{height:6px;border-radius:calc(var(--pv-round) / 2);background:rgba(var(--pv-key),var(--osk-sa))}
.osk-set-asking > :not(.osk-set-consent){display:none !important}
.osk-set-consent{display:none}
.osk-set-asking > .osk-set-consent{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:8px 20px;text-align:center}
.osk-set-consent-text{max-width:540px;font-size:15px;line-height:1.35;color:#eef2f7}
.osk-set-consent-buttons{display:flex;gap:12px}
.osk-set-consent-buttons .osk-set-btn{min-width:180px;height:40px;display:flex;align-items:center;justify-content:center;border-radius:8px;font-size:14px;font-weight:600}
.osk-set-consent-buttons .osk-set-hover{box-shadow:inset 0 0 0 2px rgba(220,232,255,.55)}
.osk-set-primary{background:${BLUE};color:#fff}
.osk-set-secondary{background:#2b3240}
.osk-set-consent-hint{font-size:12px;color:#a3abb7}
.osk-set-consent-later{font-size:11px;color:#8b93a1}
.osk-set.narrow .osk-set-page{flex-direction:column;gap:2px}
.osk-set.narrow .osk-set-col{flex:none}
.osk-set.narrow .osk-set-words{grid-template-columns:minmax(0,1fr);grid-template-rows:none;grid-auto-flow:row}
.osk-set.tiny .osk-set-tab-label,.osk-set.tiny .osk-set-desc,.osk-set.tiny .osk-set-hint{display:none}`;
    doc.head.appendChild(st);
    state.styles = [...(state.styles ?? []), st];
  }

  function steamClasses() {
    if (state.cls) return state.cls;
    if (!scanDue("cls")) return null;
    const req = webpackRequire();
    if (!req) return null;
    let kbd = null,
      glass = null;
    for (const id of Object.keys(req.m)) {
      const src = Function.prototype.toString.call(req.m[id]);
      if (src.length > 20000) continue;
      if (src.includes('TouchpadPointerContainer:"') && src.includes('KeyboardKey:"')) kbd = src;
      else if (src.includes('BackgroundGlass:"') && src.includes('DrawBackground:"')) glass = src;
      if (kbd && glass) break;
    }
    if (!kbd) return null;
    const cls = {};
    const read = (src, only) => {
      for (const m of src.matchAll(/"?([\w-]+)"?:"([\w-]+)"/g)) if (!only || only.includes(m[1])) cls[m[1]] = m[2];
    };
    if (glass) read(glass, ["BackgroundGlass", "DrawBackground"]);
    read(kbd);
    return cls.Keyboard && cls.KeyboardKey ? (state.cls = cls) : null;
  }

  function lookCss() {
    const C = steamClasses();
    if (!C) return "";
    const sig = `${settings.theme}|${padSpan("L")}|${padSpan("R")}|${settings.bumpers}`;
    if (state.lookSig === sig) return state.lookCss;
    let css = "";
    if (C.TouchpadPointerContainer)
      for (const [side, cls] of [
        ["L", C.LeftTrackpad],
        ["R", C.RightTrackpad],
      ])
        if (cls && padSpan(side) !== PAD_SPAN) css += `.${C.TouchpadPointerContainer}.${cls}{width:${padSpan(side) * 100}% !important}\n`;
    css += themeCss(C);
    state.lookSig = sig;
    state.lookCss = css;
    return css;
  }

  function applyLook(doc) {
    if (!doc?.head || (P.open && P.lookDue)) return;
    const css = lookCss();
    let st = doc.getElementById("osk-look-style");
    if (!st) {
      st = doc.createElement("style");
      st.id = "osk-look-style";
      doc.head.appendChild(st);
      state.styles = [...(state.styles ?? []), st];
    }
    if (st.textContent !== css) st.textContent = css;
    applyLookVars(doc);
  }

  function lookValues() {
    const ba = settings.boardAlpha / 100,
      ka = settings.keyAlpha / 100,
      sa = settings.spaceAlpha / 100;
    const r = (x) => +Math.min(1, Math.max(0, x)).toFixed(3);
    return {
      "--osk-ba": r(ba),
      "--osk-ka": r(ka),
      "--osk-ma": r(ka - (1 - ba) * 0.1),
      "--osk-sa": r(sa),
      "--osk-ra": r(settings.stripAlpha / 100),
      "--osk-fa": ba < 1 ? 0.12 : 0.1,
    };
  }

  function lookVars() {
    const C = state.cls;
    if (!C) return "";
    const sig = `${C.Keyboard}|${settings.boardAlpha}|${settings.keyAlpha}|${settings.spaceAlpha}|${settings.stripAlpha}|${settings.blur}`;
    if (state.varsSig === sig) return state.varsCss;
    const V = `.${C.Keyboard}.DefaultTheme`;
    const blur = BLUR_PX[settings.blur] ?? 0;
    state.varsSig = sig;
    state.varsCss = `.${C.Keyboard}{${Object.entries(lookValues())
      .map(([k, v]) => `${k}:${v}`)
      .join(";")}}${blur ? `\n${V}{backdrop-filter:blur(${blur}px)}` : ""}`;
    return state.varsCss;
  }

  function applyLookVars(doc) {
    if (!doc?.head || !state.cls || (P.open && P.lookDue)) return;
    const css = lookVars();
    let st = doc.getElementById("osk-look-vars");
    if (!st) {
      st = doc.createElement("style");
      st.id = "osk-look-vars";
      doc.head.appendChild(st);
      state.styles = [...(state.styles ?? []), st];
    }
    if (st.textContent !== css) st.textContent = css;
  }

  const THEMES = {
    steam: { board: [35, 38, 46], key: [14, 20, 27], meta: [0, 0, 0], text: null },
    modern: {
      board: [22, 25, 31],
      key: [52, 57, 68],
      meta: [36, 40, 49],
      text: "#f2f4f7",
      sub: "#9aa3b2",
      focus: [78, 87, 104],
      round: 8,
      gap: 2,
    },
    oled: {
      board: [0, 0, 0],
      key: [24, 25, 28],
      meta: [12, 12, 14],
      text: "#ffffff",
      sub: "#8a8f98",
      focus: [44, 47, 54],
      round: 6,
      gap: 2,
    },
  };

  const MOD_SEL = [
    "Escape",
    "Tab",
    "CapsLock",
    "Shift",
    "Enter",
    "Backspace",
    "Control",
    "Alt",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "VKPaste",
    "VKClose",
    "VKMove",
  ]
    .map((k) => `[data-key="${k}"]`)
    .concat(['[data-key^="SwitchKeys_"]'])
    .join(",");
  const LETTER_SEL = [..."abcdefghijklmnopqrstuvwxyz"].map((k) => `[data-key="${k}"]`).join(",");
  const ICONS = { Backspace: "⌫", Enter: "⏎", Shift: "⇧" };

  function themeCss(C) {
    const t = THEMES[settings.theme] ?? THEMES.steam;
    const rgba = (c, al) => `rgba(${c[0]},${c[1]},${c[2]},${al})`;
    const V = `.${C.Keyboard}.DefaultTheme`;
    const KK = `.${C.KeyboardKey}`;
    const SL = C.ShiftedLabel ? `.${C.ShiftedLabel}` : null;
    const vars = {};
    vars["--background-color"] = rgba(t.board, "var(--osk-ba)");
    vars["--key-background-color"] = rgba(t.key, "var(--osk-ka)");
    vars["--key-spacebar-background-color"] = rgba(t.key, "var(--osk-sa)");
    for (const n of ["meta", "tab", "caps", "shift", "enter", "backspace", "spacer", "deadkey"])
      vars[`--key-${n}-background-color`] = rgba(t.meta, "var(--osk-ma)");
    if (t.text) {
      for (const n of ["key", "meta", "tab", "caps", "shift", "enter", "backspace", "spacebar", "deadkeyinactive"])
        vars[`--key-${n}-color`] = t.text;
      vars["--key-focused-color"] = t.text;
      vars["--key-focused-action-button-left-color"] = t.text;
      vars["--key-focused-action-button-right-color"] = t.text;
    }
    if (t.sub) {
      vars["--key-shift-label-color"] = t.sub;
      vars["--key-focused-shift-label-color"] = t.sub;
    }
    vars["--key-focused-background-color"] = rgba(t.focus ?? [64, 73, 88], 1);
    vars["--key-focused-color"] = t.text ?? "#ffffff";
    vars["--key-touched-background-color"] = BLUE;
    vars["--key-touched-color"] = "#ffffff";
    let css = `${V}{${Object.entries(vars)
      .map(([k, v]) => `${k}:${v} !important`)
      .join(";")}}\n`;
    if (C.BackgroundGlass)
      css += `.${C.BackgroundGlass}:has(~ * .${C.Keyboard}.DefaultTheme){background:transparent !important;backdrop-filter:none !important}\n`;
    if (t.text) {
      css += `${V} ${KK}{box-sizing:border-box;border:${t.gap}px solid transparent;background-clip:padding-box;border-radius:${t.round + t.gap}px;transition:transform 90ms ease-out}
`;
    }
    css += `${V} ${KK}.${C.Touched},${V} .osk-press > ${KK}{background-color:${BLUE} !important;color:#fff !important${t.text ? ";transform:scale(0.94)" : ""}}
${V} ${KK}.${C.ToggleOn}{background-color:${BLUE} !important;color:#fff !important}
${V} ${KK}.${C.ToggleOn} *{color:#fff !important}
${V} :is(${LETTER_SEL}) > ${KK} > span${SL ? `:not(${SL})` : ""}{font-size:20px !important}
${V} :is(${MOD_SEL}) > ${KK} span{font-size:14px !important}
${V} [data-key="CapsLock"] > ${KK} img{transform:scale(.62);opacity:.55}
.${C.Keyboard} :has(> [data-key^="${SUG}"]),.${C.Keyboard} :has(> * > [data-key^="${SUG}"]){background-color:${rgba(t.board, "var(--osk-ra)")}}
${V} [data-key=" "] > ${KK},${V} [data-key=" "]::after{text-shadow:0 1px 3px rgba(0,0,0,.9)}
${SL && t.sub ? `${V} ${SL}{color:${t.sub} !important}\n` : ""}`;
    for (const [k, icon] of Object.entries(ICONS))
      css += `${V} [data-key="${k}"] > ${KK} > span{font-size:0 !important}\n${V} [data-key="${k}"] > ${KK} > span::after{content:"${icon}";font-size:22px;line-height:1}\n`;
    if (settings.bumpers)
      css += `${V} [data-key="Control"]::after,${V} [data-key="Alt"]::after{position:absolute;top:3px;right:5px;padding:0 3px;border-radius:3px;background:#d6dce5;color:#11151b;font:700 10px/13px "Motiva Sans",Arial,Helvetica,sans-serif;pointer-events:none}\n${V} [data-key="Control"]::after{content:"LB"}\n${V} [data-key="Alt"]::after{content:"RB"}\n`;
    const S = `.${C.Keyboard} [data-key^="${SUG}"] > ${KK}`;
    css += `${S}{box-sizing:border-box;border:${t.text ? 3 : 2}px solid transparent;background-clip:padding-box;border-radius:999px;background-color:${rgba([255, 255, 255], t.text ? 0.08 : 0.06)};color:${t.text ?? "#dcdedf"};transition:background-color 90ms ease-out}
${S}:has(> span:empty){background-color:transparent;box-shadow:none}
.${C.Keyboard} [data-key^="${SUG}"].osk-sug-current > ${KK}{background-color:${BLUE};color:#fff}
.${C.Keyboard} [data-key^="${SUG}"] > ${KK}.${C.Focused}{background-color:${rgba(t.focus ?? [61, 68, 80], 1)}}
.${C.Keyboard} [data-key^="${SUG}"].osk-press > ${KK},.${C.Keyboard} [data-key^="${SUG}"] > ${KK}.${C.Touched}{background-color:${BLUE};color:#fff}
`;
    css += echoCss(C, t);
    return css;
  }

  function echoCss(C, t) {
    const K = `.${C.Keyboard}`;
    const field =
      t === THEMES.oled ? "rgba(255,255,255,0.10)" : t === THEMES.steam ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,var(--osk-fa))";
    return `${K} :has(> .osk-echo.row:not([hidden])){position:relative;padding-left:34%}
${K} .osk-echo.row{left:4px;top:4px;bottom:5px;width:calc(34% - 8px);padding:0 16px;border-radius:999px;background:${field};color:${t.text ?? "#e6e9ee"};font-size:16px}
${K} .osk-badge{left:calc(34% - 6px);transform:translate(-100%,-50%);max-width:106px;overflow:hidden;text-overflow:ellipsis}
${K} [data-key=" "]:has(> .osk-echo:not([hidden])) > .${C.KeyboardKey} > *{opacity:0}
${K} .osk-echo.space{left:16px;right:16px;top:4px;bottom:5px;color:${t.text ?? "#e6e9ee"};font-size:15px;text-shadow:0 1px 3px rgba(0,0,0,.9)}
${K} [data-key=" "]:has(> .osk-echo.space:not([hidden])) > .${C.KeyboardKey}{background-color:${t.text ? "rgba(70,77,92,var(--osk-sa))" : "rgba(40,46,56,var(--osk-sa))"} !important;transform:none !important}
`;
  }

  function dismissOnEnter(vkm) {
    if (!vkm || !("m_bDismissOnEnter" in vkm)) return;
    if (settings.enterCloses) return restoreDismiss();
    if (!vkm.m_bDismissOnEnter) return;
    if (typeof vkm.SetDismissOnEnterKey === "function")
      wrap(
        vkm,
        "SetDismissOnEnterKey",
        (orig) =>
          function (...args) {
            if (state.dismissVkm === this) state.dismissVkm = null;
            return orig.apply(this, args);
          },
      );
    vkm.m_bDismissOnEnter = false;
    state.dismissVkm = vkm;
  }

  function restoreDismiss() {
    const vkm = state.dismissVkm;
    state.dismissVkm = null;
    if (vkm && !vkm.m_bDismissOnEnter) vkm.m_bDismissOnEnter = true;
  }

  function patchProto(proto) {
    let changed = false;
    changed =
      wrap(
        proto,
        "OnTrackpadAnalogInternal",
        (orig) =>
          function (pad, which, on, x, y, ...rest) {
            const mode = !layoutSupported() ? null : (activeMode() ?? (fullPad() ? (window.__oskModes?.modes?.standard ?? null) : null));
            const side = pad === this.m_rightTrackpad ? "R" : "L";
            let mapped = false;
            if (on && mode?.mapPad && !P.open) {
              try {
                const p = mode.mapPad(this, side, x, y, modeApi);
                if (p) [x, y] = p;
                mapped = !!p;
              } catch (e) {
                note(e);
              }
            }
            if (on && !mapped && !P.open && layoutSupported()) {
              try {
                y = slideY(this, y);
              } catch (e) {
                note(e);
              }
            }
            if (on && !P.open && layoutSupported()) {
              try {
                [x, y] = padTarget(this, x, y);
              } catch (e) {
                note(e);
              }
            }
            if (on && P.open) {
              try {
                y = panelPadY(this, y);
                panelPadNested(this, pad, side, x, y);
              } catch (e) {
                note(e);
              }
            }
            const r = orig.call(this, pad, which, on, x, y, ...rest);
            if (on && P.drag?.side === side) {
              try {
                dragSlider(P.drag, x);
              } catch (e) {
                note(e);
              }
            } else if (on && P.open) {
              try {
                panelPadScroll(side, x, y);
              } catch (e) {
                note(e);
              }
            }
            if (mode?.onPad) {
              try {
                mode.onPad(this, side, on, modeApi);
              } catch (e) {
                note(e);
              }
            }
            return r;
          },
      ) || changed;
    changed =
      wrap(
        proto,
        "StartLongPressTimer",
        (orig) =>
          function (target, source, repeat) {
            if (!repeat && (source === LPAD || source === RPAD) && target?.getAttribute?.("data-key") !== "Backspace") {
              const slot = this.LongPressSlot(source);
              const pad = source === LPAD ? this.m_leftTrackpad : this.m_rightTrackpad;
              SW.pressTap = pad ? { x: pad.x, y: pad.y, side: source === LPAD ? "L" : "R" } : null;
              try {
                this.TypeKey(target);
              } finally {
                SW.pressTap = null;
              }
              slot.bSentKey = true;
              return;
            }
            return orig.call(this, target, source, repeat);
          },
      ) || changed;
    changed =
      wrap(
        proto,
        "TypeKeyInternal",
        (orig) =>
          function (spec) {
            const key = spec?.strKey;
            if (!SW.typing) settleFinish();
            if (typeof key !== "string") return orig.call(this, spec);
            try {
              settleSwipe(this);
            } catch (e) {
              note(e);
            }
            if (T.at && performance.now() - T.at > STALE_MS && (T.buf || T.prev || T.fromSwipe || T.auto)) {
              resetTracker();
              refreshSuggestions(this);
            }
            if (key === EMOJI && (P.open || (state.suppressEmoji && performance.now() - state.suppressEmoji < 3000))) {
              state.suppressEmoji = 0;
              return;
            }
            if (TIP.el) hideTip();
            if (key.startsWith(SET) || key === ECHO_KEY) return;
            if (key === "Enter") dismissOnEnter(vkmOf(this));
            const tap = SW.typing ? SW.tapPt : (SW.pressTap ?? takeTouchTap());
            if (key.startsWith(SUG)) {
              if (state.suppressPick && performance.now() - state.suppressPick < 3000) {
                state.suppressPick = 0;
                return;
              }
              try {
                pickSuggestion(this, Number(key.slice(SUG.length)));
              } catch (e) {
                note(e);
              }
              return;
            }
            if (!TOGGLES.has(key)) {
              try {
                if (sendChord(this, key, !!spec.strShifted)) {
                  resetTracker();
                  refreshSuggestions(this);
                  return;
                }
              } catch (e) {
                note(e);
              }
              if (key === "Escape") {
                SW.recent = null;
                return;
              }
              if (key === "Backspace" && repeating(this) && OUT.queue.some((x) => x[1] === "Backspace" && x[3] === OUT.gen)) return;
              try {
                if (key === "Backspace" && T.autocorr && undoAutocorrect(this)) return;
                if (key === "Backspace" && T.fromSwipe && undoSwipe(this)) return;
              } catch (e) {
                note(e);
              }
            }
            if (!SW.typing) SW.recent = null;
            let ch = key;
            try {
              ch = typedChar(this, key);
            } catch (e) {}
            const autoc = T.autocorr;
            T.autocorr = null;
            let corrected = false;
            if (
              eff("autocorrect") &&
              (key === " " || /^[.,!?;:]$/.test(ch)) &&
              T.buf &&
              !T.fromSwipe &&
              (this.state?.layoutState === 0 || this.state?.layoutState === 1)
            ) {
              try {
                corrected = autocorrect(this, ch);
              } catch (e) {
                note(e);
              }
            }
            const sym = key.length === 1 && active(this.state?.toggleStates?.Shift) ? (SHIFT_UP[key] ?? ch) : ch;
            if (T.auto && settings.removeAutoSpace && (key === "Enter" || AUTO_SPACE_DROP.test(sym))) {
              T.auto = false;
              backspace(this, 1);
            }
            spaceAfterSwipe(this, key);
            const outCh = key.length === 1 ? ch : TOGGLES.has(key) ? null : key || null;
            const outKey = physKey(outCh);
            let r;
            const echo = () => {
              try {
                echoKey(this, key, ch, spec);
              } catch (e) {
                note(e);
              }
            };
            if (TOGGLES.has(key) || key.startsWith("SwitchKeys_")) {
              r = orig.call(this, spec);
              echo();
            } else if (outputPending() || waitFor(outKey, shiftOf(outCh)) > 0) {
              const vkm = vkmOf(this);
              const layout = this.state?.layoutState;
              if (
                vkm &&
                !this.context &&
                !spec.strKeyHandler &&
                !spec.strDeadKeyNext &&
                key !== "VKMove" &&
                !key.startsWith("IME_") &&
                (layout === 0 || layout === 1)
              ) {
                const out = key.length === 1 && !spec.strShifted ? ch : key;
                const shift = active(this.state?.toggleStates?.Shift);
                clearOneShots(this);
                emit(() => {
                  plainOut();
                  vkm.HandleVirtualKeyDown(out, shift);
                  echo();
                }, outCh);
              } else
                emit(() => {
                  plainOut();
                  orig.call(this, spec);
                  echo();
                }, outCh);
            } else {
              r = orig.call(this, spec);
              markSent(outKey, shiftOf(outCh));
              echo();
            }
            const keep = corrected ? T.autocorr : null;
            try {
              track(this, key, sym, tap);
            } catch (e) {
              note(e);
            }
            T.autocorr = keep;
            if (keep) {
              try {
                refreshSuggestions(this);
              } catch (e) {
                note(e);
              }
            }
            if (!corrected && autoc && key !== "Backspace") T.noCorrect = null;
            return r;
          },
      ) || changed;
    if (typeof proto.LongPressTimerExpired === "function")
      changed =
        wrap(
          proto,
          "LongPressTimerExpired",
          (orig) =>
            function (...args) {
              SW.repeat = true;
              try {
                return orig.apply(this, args);
              } finally {
                SW.repeat = false;
              }
            },
        ) || changed;
    changed =
      wrap(
        proto,
        "OnTrackpadHover",
        (orig) =>
          function (from, to) {
            const r = orig.call(this, from, to);
            try {
              if (from !== to) {
                if (from?.classList?.contains("osk-set-btn")) from.classList.remove("osk-set-hover");
                if (to?.classList?.contains("osk-set-btn")) to.classList.add("osk-set-hover");
                if (P.open) setHover(to?.classList?.contains("osk-set-btn") ? to.getAttribute("data-key") : null);
              }
            } catch (e) {
              note(e);
            }
            return r;
          },
      ) || changed;
    changed =
      wrap(
        proto,
        "componentDidUpdate",
        (orig) =>
          function (...args) {
            delete this.__oskBounds;
            try {
              syncHeld();
            } catch (e) {
              note(e);
            }
            return orig?.apply(this, args);
          },
      ) || changed;
    try {
      hookInputRelease(proto);
    } catch (e) {
      note(e);
    }
    state.protoPatched = true;
    return changed;
  }

  function onBumper(e) {
    const button = e.detail?.button;
    if (button !== BUMPER_LEFT && button !== BUMPER_RIGHT) return;
    const doc = e.currentTarget?.document ?? e.target?.ownerDocument;
    const which = button === BUMPER_LEFT ? "Control" : "Alt";
    const down = e.type === "vgp_onbuttondown";
    const kb = findKeyboard(doc) ?? (!down ? state.bumperKb : null);
    if (!down) {
      const wasHeld = !!state.bumpers[which];
      state.bumpers[which] = false;
      if (kb && (kb.state?.toggleStates?.[which] ?? 0) & HELD) {
        kb.setState(
          (s) => ({ ...s, toggleStates: { ...s.toggleStates, [which]: s.toggleStates[which] & ~HELD } }),
          () => syncHeld(),
        );
      }
      if (wasHeld) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
      return;
    }
    if (!settings.bumpers || P.open || !kb || !isOpen(kb) || (kb.state.layoutState !== 0 && kb.state.layoutState !== 1) || isImeLayout())
      return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (e.detail?.is_repeat) return;
    try {
      settleSwipe(kb);
    } catch (err) {
      note(err);
    }
    state.bumpers[which] = true;
    state.bumperKb = kb;
    kb.setState(
      (s) => ({ ...s, toggleStates: { ...s.toggleStates, [which]: s.toggleStates[which] | HELD } }),
      () => syncHeld(),
    );
  }

  const LISTENERS = [
    ["vgp_onbuttondown", onPanelButton],
    ["vgp_onbuttonup", onPanelButton],
    ["vgp_onbuttondown", onBumper],
    ["vgp_onbuttonup", onBumper],
    ["vgp_onbuttondown", onPadButton],
    ["vgp_onbuttonup", onPadButton],
    ["touchstart", onTouch],
    ["touchmove", onTouch],
    ["touchend", onTouch],
    ["touchcancel", onTouch],
    ["pointerdown", onOutsidePointer],
  ];

  function attachBumpers(doc) {
    const win = doc?.defaultView;
    if (!win || win.__oskBumpers?.version === VERSION) return;
    win.__oskBumpers?.detach?.();
    for (const [t, f] of LISTENERS) win.addEventListener(t, f, true);
    win.__oskBumpers = {
      version: VERSION,
      detach() {
        for (const [t, f] of LISTENERS) win.removeEventListener(t, f, true);
        delete win.__oskBumpers;
      },
    };
    state.windows.add(win);
  }

  function keyBounds(kb) {
    if (P.open && P.el?.isConnected) {
      const rc = P.el.getBoundingClientRect();
      return { l: rc.left, t: rc.top, r: rc.right, b: rc.bottom };
    }
    const now = performance.now();
    const rc = rectOf(kb);
    if (kb.__oskBounds && now - kb.__oskBounds.at < 500 && sameRect(kb.__oskBounds.rc, rc)) return kb.__oskBounds;
    const keys = kb.m_keyboardDiv?.querySelectorAll?.("[data-key]");
    let l = Infinity,
      t = Infinity,
      r = -Infinity,
      b = -Infinity;
    const rects = [];
    const core = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity };
    for (const k of keys ?? []) {
      const rc = k.getBoundingClientRect();
      if (!rc.width || !rc.height) continue;
      l = Math.min(l, rc.left);
      t = Math.min(t, rc.top);
      r = Math.max(r, rc.right);
      b = Math.max(b, rc.bottom);
      const name = k.getAttribute("data-key");
      const sug = name.startsWith(SUG) ? Number(name.slice(SUG.length)) : -1;
      rects.push({ l: rc.left, t: rc.top, r: rc.right, b: rc.bottom, sug });
      if (sug >= 0) continue;
      core.l = Math.min(core.l, rc.left);
      core.t = Math.min(core.t, rc.top);
      core.r = Math.max(core.r, rc.right);
      core.b = Math.max(core.b, rc.bottom);
    }
    const hs = rects.filter((k) => k.sug < 0).map((k) => k.b - k.t);
    core.m = hs.length ? hs.sort((a, c) => a - c)[hs.length >> 1] / 2 : 0;
    kb.__oskBounds = { at: now, rc, l, t, r, b, rects, core };
    return kb.__oskBounds;
  }

  function keyExtent(kb) {
    const rc = rectOf(kb);
    const b = keyBounds(kb);
    if (!rc || !b.rects?.length || !(rc[3] > 0) || Math.abs(rc[3] - (b.b - b.t)) <= SLIDE_TOL) return null;
    return { top: b.t, bottom: b.b, steamTop: rc[1], steamHeight: rc[3] };
  }

  function slideY(kb, y) {
    const e = keyExtent(kb);
    return e ? e.top + ((y - e.steamTop) / e.steamHeight) * (e.bottom - e.top) : y;
  }

  function padTarget(kb, x, y) {
    const { rects, core } = keyBounds(kb);
    if (!rects?.length) return [x, y];
    if (x > core.l + core.m && x < core.r - core.m && y > core.t + core.m && y < core.b - core.m) return [x, y];
    let best = null,
      bd = Infinity;
    for (const k of rects) {
      if (k.sug >= 0 && !T.labels[k.sug]) continue;
      const dx = Math.max(k.l - x, 0, x - k.r),
        dy = Math.max(k.t - y, 0, y - k.b);
      if (!dx && !dy) return [x, y];
      if (dx * dx + dy * dy < bd) {
        bd = dx * dx + dy * dy;
        best = k;
      }
    }
    if (!best) return [x, y];
    const i = Math.min(4, (best.r - best.l) / 4, (best.b - best.t) / 4);
    return [Math.min(Math.max(x, best.l + i), best.r - i), Math.min(Math.max(y, best.t + i), best.b - i)];
  }

  function clampPad(kb, pad, side) {
    if (!pad || pad.__oskClamp === state) return;
    let x = pad.x,
      y = pad.y;
    const orig = { x: Object.getOwnPropertyDescriptor(pad, "x"), y: Object.getOwnPropertyDescriptor(pad, "y") };
    state.props.push(() => {
      const cur = { x, y };
      for (const n of ["x", "y"]) {
        const d = orig[n];
        if (d && !("value" in d)) Object.defineProperty(pad, n, d);
        else Object.defineProperty(pad, n, { value: cur[n], writable: true, enumerable: d?.enumerable ?? true, configurable: true });
      }
      delete pad.__oskClamp;
    });
    const inRange = () => {
      const bb = keyBounds(kb);
      return bb.l < bb.r && x >= bb.l - EDGE_PX && x <= bb.r + EDGE_PX && y >= bb.t - EDGE_PX && y <= bb.b + EDGE_PX ? bb : null;
    };
    Object.defineProperty(pad, "x", {
      get() {
        const bb = inRange();
        return bb ? Math.min(Math.max(x, bb.l + 4), bb.r - 4) : x;
      },
      set(v) {
        x = v;
      },
      configurable: true,
    });
    Object.defineProperty(pad, "y", {
      get() {
        const bb = inRange();
        return bb ? Math.min(Math.max(y, bb.t + 4), bb.b - 4) : y;
      },
      set(v) {
        y = v;
        if (state.stopped || pad.active === false) return;
        try {
          if (SL.s?.side === side) slideTo(pad.x);
          else if (SW.held[side]) onPadSample(kb, side, pad);
        } catch (e) {
          note(e);
        }
      },
      configurable: true,
    });
    pad.__oskClamp = state;
  }

  const KB_METHODS = [
    "TypeKeyInternal",
    "TypeKey",
    "OnTrackpadAnalogInternal",
    "StartLongPressTimer",
    "OnTrackpadHover",
    "LongPressSlot",
    "getElementFromPointWorkaround",
    "HandleTrackpadClick",
    "CancelLongPressTimer",
    "ClearHoldTarget",
    "setState",
    "forceUpdate",
  ];

  function preflightGlobal() {
    const I = window.SteamClient?.Input;
    const missing = ["ControllerKeyboardSendText", "ControllerKeyboardSetKeyState"]
      .filter((f) => typeof I?.[f] !== "function")
      .map((f) => `SteamClient.Input.${f}`);
    if (missing.length) return missing.join(", ");
    if (!webpackRequire()) return "wait";
    const api = findLayoutApi();
    if (!api) {
      if ((state.scans?.layout?.n ?? 0) >= 4) state.unsupportedSoft = "keyboard layout module not found";
      return "wait";
    }
    state.unsupportedSoft = null;
    let layout;
    try {
      layout = api.current();
    } catch (e) {
      return `layout current() threw: ${e.message}`;
    }
    if (typeof layout?.rgLayout !== "function") return "layout.rgLayout";
    const vkm = window.SteamUIStore?.ActiveWindowInstance?.VirtualKeyboardManager;
    if (vkm && typeof vkm.HandleVirtualKeyDown !== "function") return "VirtualKeyboardManager.HandleVirtualKeyDown";
    return null;
  }

  function preflightKeyboard(kb) {
    const proto = Object.getPrototypeOf(kb);
    const missing = KB_METHODS.filter((m) => typeof proto?.[m] !== "function" && typeof kb[m] !== "function");
    for (const f of ["m_leftTrackpad", "m_rightTrackpad", "m_keyboardDiv"]) if (!kb[f]) missing.push(f);
    if (typeof kb.props?.VirtualKeyboardManager?.HandleVirtualKeyDown !== "function") missing.push("props.VirtualKeyboardManager");
    if (!kb.state?.toggleStates) missing.push("state.toggleStates");
    return missing.length ? `keyboard ${missing.join(", ")}` : null;
  }

  function rollback(reason) {
    state.unsupported = reason;
    try {
      teardown();
    } catch (e) {
      note(e);
    }
  }

  function tick() {
    if (state.stopped) return;
    if (!state.preflight) {
      const miss = preflightGlobal();
      if (miss === "wait") return;
      if (miss) return rollback(miss);
      state.preflight = true;
    }
    try {
      tickPatched();
    } catch (e) {
      rollback(`patch failed: ${e?.message ?? e}`);
    }
  }

  function dropHeld(kbs) {
    for (const kb of kbs) {
      const ts = kb.state?.toggleStates;
      const strip = ["Control", "Alt"].filter((k) => !state.bumpers[k] && (ts?.[k] ?? 0) & HELD);
      if (!strip.length) continue;
      try {
        kb.setState((s) => {
          const t = { ...s.toggleStates };
          for (const k of strip) t[k] &= ~HELD;
          return { ...s, toggleStates: t };
        });
      } catch (e) {
        note(e);
      }
    }
  }

  function dropHolds(kbs) {
    state.bumpers = {};
    P.held.clear();
    dropHeld(kbs);
    const kb = kbs[0];
    for (const h of [SW.sugHold, SW.emojiHold, SW.echoHold, SW.touchHold, SW.emojiTouch]) {
      if (!h) continue;
      clearTimeout(h.timer);
      if (h.el) holdRing(h.el, false);
      if (kb && (h.side === "L" || h.side === "R")) setPadDown(kb, h.side, false);
    }
    SW.sugHold = SW.emojiHold = SW.echoHold = SW.touchHold = SW.emojiTouch = null;
  }

  function tickPatched() {
    patchLayouts();
    const open = [];
    const found = [];
    for (const doc of documents()) {
      attachBumpers(doc);
      const kb = findKeyboard(doc);
      if (!kb) continue;
      found.push(kb);
      if (!state.checked.has(kb)) {
        const miss = preflightKeyboard(kb);
        if (miss) return rollback(miss);
        state.checked.add(kb);
      }
      if (patchProto(Object.getPrototypeOf(kb)) || kb.__oskVersion !== VERSION) {
        kb.__oskVersion = VERSION;
        dropGeometry(kb);
        try {
          const api = findLayoutApi();
          const cur = api?.current();
          if (!cur || kb.state?.standardLayout !== cur || !kb.m_keyboardDiv?.querySelector('[data-key="Escape"]')) {
            if (cur) kb.setState({ standardLayout: cur });
            kb.forceUpdate();
          }
        } catch (e) {
          note(e);
        }
      }
      clampPad(kb, kb.m_leftTrackpad, "L");
      clampPad(kb, kb.m_rightTrackpad, "R");
      injectStyle(doc);
      applyLook(doc);
      setFocusRow(kb);
      setRepeat(kb);
      const visible = isOpen(kb);
      if (visible !== !!kb.__oskWasOpen) {
        kb.__oskWasOpen = visible;
        dropGeometry(kb);
      }
      if (visible) open.push(kb);
    }
    if (open.length && !state.shown) {
      P.padDown = {};
      P.held.clear();
      P.aDown = false;
      dropHeld(open);
    }
    state.shown = open.length > 0;
    if (P.open && (!isOpen(P.kb) || !P.el?.isConnected)) closePanel();
    else if (P.open) placePanel();
    try {
      window.__oskModes?.sync?.(open[0] ?? null, layoutSupported() ? settings.mode : null, modeApi);
    } catch (e) {
      note(e);
    }
    if (open.length) {
      syncHeld(open);
      EC.win = open[0].m_keyboardDiv?.ownerDocument?.defaultView ?? null;
    } else {
      settleOnClose();
      restoreDismiss();
      if (OUT.queue.length || OUT.busy) keepWords();
      if (TIP.el) hideTip();
      state.consentLater = false;
      try {
        flushLog();
      } catch (e) {
        note(e);
      }
      releaseAll();
      clearSlide();
      echoReset(false);
      dropHolds(found);
      for (const side of ["L", "R"]) if (SW.held[side] && found[0]) setPadDown(found[0], side, false);
      resetSession();
      SW.touch = null;
      SW.swallow = {};
      if (T.buf || T.lastOut !== "unknown" || T.prev) {
        commitBuffer("end");
        resetTracker();
        T.labels = [];
        T.sugs = [];
      }
    }
    try {
      renderEcho(open[0]);
    } catch (e) {
      note(e);
    }
    if (open.length && !settings.consent && !P.open && !state.consentLater && layoutSupported()) {
      try {
        openPanel(open[0], "consent");
      } catch (e) {
        note(e);
      }
    } else if (open.length && settings.consent && !settings.tipShown && !P.open) {
      try {
        showTip(open[0]);
      } catch (e) {
        note(e);
      }
    }
    if (!state.engineReady && open.length) state.engineReady = !!getEngine();
    if (!state.engineReady) prepare();
    else if (open.length && !state.warmJob && window.__oskEngine?.__warm !== true) later(() => warmUp(), 300);
  }

  function later(fn, delay = 0) {
    const run = () => {
      state.warmJob = null;
      if (state.stopped) return;
      try {
        fn();
      } catch (e) {
        note(e);
      }
    };
    const idle = (f) =>
      typeof window.requestIdleCallback === "function"
        ? (state.warmJob = { idle: window.requestIdleCallback(f, { timeout: 1000 }) })
        : (state.warmJob = { timer: setTimeout(f, 16) });
    if (delay) state.warmJob = { timer: setTimeout(() => idle(run), delay) };
    else idle(run);
  }

  function cancelLater() {
    const j = state.warmJob;
    state.warmJob = null;
    if (j?.idle) window.cancelIdleCallback?.(j.idle);
    if (j?.timer) clearTimeout(j.timer);
  }

  function prepare() {
    if (state.warmJob || state.engineReady) return;
    later(() => {
      state.engineReady = !!getEngine();
      if (state.engineReady) warmEngine();
    });
  }

  function warmEngine() {
    const eng = window.__oskEngine;
    if (!eng || typeof eng.warmStep !== "function" || eng.__warmed) return;
    if (eng.warmStep()) eng.__warmed = true;
    else later(warmEngine);
  }

  function warmUp() {
    const eng = window.__oskEngine;
    const kb = openKeyboards()[0];
    if (!eng || !kb || eng.__warm === true) return;
    if (!state.idle()) return later(warmUp, 300);
    if (typeof eng.warmStep === "function" && !eng.__warmed) return warmEngine();
    const keys = letterKeys(kb);
    const steps = [
      () => eng.complete("th", {}, 8),
      () => eng.predict?.("the", 8),
      () => eng.correct?.("teh", { keys }),
      () =>
        keys.t &&
        keys.e &&
        eng.decode(
          ["t", "h", "e"].map((c, i) => ({ x: keys[c].x, y: keys[c].y, t: i * 40, s: "T" })),
          keys,
          {},
        ),
    ];
    const i = (eng.__warmAt = (eng.__warmAt ?? -1) + 1);
    if (i >= steps.length - 1) eng.__warm = true;
    else later(warmUp);
    try {
      steps[i]();
    } catch (e) {
      note(e);
    }
  }

  state.status = () =>
    state.unsupported
      ? `v${VERSION} unsupported Steam build: ${state.unsupported}`
      : state.unsupportedSoft
        ? `v${VERSION} waiting: ${state.unsupportedSoft}`
        : `v${VERSION} layouts=${state.layouts} keyboard=${state.protoPatched ? "patched" : "waiting"} swipe=${state.swipeOn ? (window.__oskEngine ? "on" : "no-engine") : "off"} mode=${activeMode()?.id ?? "standard"}${state.errors.length ? ` errors=${state.errors.join(" | ")}` : ""}`;
  state.userRev = 0;
  state.savedRev = 0;
  state.takeUserWords = () => {
    const eng = window.__oskEngine;
    if (!eng) return null;
    if (eng.__dirty) {
      eng.__dirty = false;
      state.userRev++;
    }
    if (state.userRev <= state.savedRev) return null;
    return JSON.stringify({ ...exportAll(eng), rev: state.userRev, forgetGen: state.forgetGen ?? 0 });
  };
  state.ackUserWords = (rev) => {
    if (Number.isFinite(rev) && rev > state.savedRev) state.savedRev = Math.min(rev, state.userRev);
    return state.savedRev;
  };
  state.takeTypingLog = () => {
    const pend = LOG.out.filter(([q]) => q > LOG.acked);
    if (!pend.length) return null;
    return JSON.stringify({ upTo: pend[pend.length - 1][0], lines: pend.map((x) => x[1]) });
  };
  state.ackTypingLog = (upTo) => {
    if (Number.isFinite(upTo) && upTo > LOG.acked && !settings.logFile) setSetting("logFile", true);
    if (Number.isFinite(upTo)) LOG.acked = Math.max(LOG.acked, upTo);
    LOG.out = LOG.out.filter(([q]) => q > LOG.acked);
    return LOG.acked;
  };
  state.takeRequests = () => {
    if (!Object.keys(REQ.pending).length) return null;
    const out = JSON.stringify({ ...REQ.pending, rev: REQ.rev });
    if (REQ.taken === REQ.rev) REQ.takes++;
    else {
      REQ.taken = REQ.rev;
      REQ.takes = 1;
    }
    if (!REQ.hostAcks && !REQ.acks && REQ.takes >= 3) REQ.pending = {};
    return out;
  };
  Object.defineProperty(state, "hostAcks", {
    configurable: true,
    enumerable: true,
    get: () => REQ.hostAcks,
    set: (v) => {
      if (v) REQ.hostAcks = true;
    },
  });
  state.ackRequests = (rev) => {
    if (!Number.isFinite(rev)) return REQ.rev;
    REQ.acks++;
    if (rev >= REQ.rev) REQ.pending = {};
    return REQ.rev;
  };
  state.flushLog = () => flushLog();
  state.keyboardOpen = () => openKeyboards().length > 0;
  state.tickNow = () => tick();
  state.idle = (join = true) =>
    !OUT.busy &&
    !OUT.queue.length &&
    !SW.timer &&
    !SW.finishing &&
    !SW.preview &&
    !SW.strokes.length &&
    !SL.s &&
    !SW.drawPending &&
    !SW.sugHold &&
    !SW.emojiHold &&
    !SW.echoHold &&
    !state.tickSoon &&
    !state.refreshTimer &&
    !(join && SW.recent && performance.now() - SW.recent.end < JOIN_MS);
  state.clearTypingLog = () => clearTypingLog();
  state.typingLog = LOG;
  state.versionLine = () => versionLine();
  state.setSetting = (name, on) => setSetting(name, on);
  state.setMode = (id) => {
    setSetting("mode", id);
    return state.status();
  };
  state.modeApi = modeApi;
  state.openSettings = () => {
    const kb = openKeyboards()[0];
    if (kb) openPanel(kb);
    return P.open;
  };
  state.closeSettings = () => closePanel();
  state.typeText = (text) => {
    const kb = openKeyboards()[0];
    if (kb) sendText(kb, String(text));
    return !!kb;
  };
  state.panel = P;
  state.effective = (name) => eff(name);
  state.sectionOf = (id) => Object.keys(PANEL_ROWS).find((t) => PANEL_ROWS[t].flat().some(([, ids]) => ids.includes(id))) ?? null;
  state.forget = (word) => {
    const eng = getEngine();
    if (!eng) return false;
    eng.forget(word);
    userChanged();
    return true;
  };
  state.forgetAll = () => {
    getEngine()?.setUser({ version: 1, words: {}, bigrams: {} });
    state.blocked.clear();
    for (const k of Object.keys(state.pending)) delete state.pending[k];
    try {
      window.localStorage?.removeItem(LS_KEY);
    } catch (e) {}
    state.swipeLog.length = 0;
    clearTypingLog();
    request("removeBackup");
    state.forgetGen = (state.forgetGen ?? 0) + 1;
    resetContext(null, false);
    userChanged();
    return true;
  };
  state.tracker = T;
  state.echo = EC;
  state.session = SW;
  state.slide = SL;
  state.output = OUT;
  function teardown() {
    state.stopped = true;
    clearInterval(state.timer);
    cancelLater();
    dropOutput();
    const step = (f) => {
      try {
        f();
      } catch (e) {
        note(e);
      }
    };
    step(() => window.__oskModes?.sync?.(null, null, modeApi));
    step(() => closePanel());
    for (const h of [SW.emojiHold, SW.emojiTouch, SW.sugHold, SW.touchHold, SW.echoHold]) clearTimeout(h?.timer);
    clearSlide();
    dropFinish();
    step(() => restoreDismiss());
    step(() => resetSession());
    SW.touch = null;
    clearTimeout(state.lsTimer);
    for (const win of state.windows) step(() => win.__oskBumpers?.detach?.());
    for (const [obj, name, orig] of state.wrapped.reverse()) {
      step(() => {
        if (obj[name]?.__oskVersion !== VERSION) return;
        if (orig === undefined) delete obj[name];
        else obj[name] = orig;
      });
    }
    state.wrapped = [];
    for (const [layout, codes] of state.keycodes) layout.rgKeycodes = codes;
    for (const [obj, name, v] of state.statics) obj[name] = v;
    for (const restore of state.props.reverse()) step(restore);
    state.props = [];
    for (const st of state.styles ?? []) st.remove();
    EC.el?.remove();
    EC.el = null;
    EC.badge?.remove();
    EC.badge = null;
    clearTimeout(EC.markTimer);
    clearTimeout(state.noticeTimer);
    clearTimeout(state.refreshTimer);
    hideTip();
    for (const doc of documents()) doc.getElementById("osk-swipe-trail")?.remove();
    for (const doc of documents()) {
      const kb = findKeyboard(doc);
      if (!kb) continue;
      delete kb.__oskVersion;
      step(() => {
        if (state.layoutApi) kb.setState({ standardLayout: state.layoutApi.current() });
        kb.forceUpdate();
      });
    }
    releaseAll();
  }

  state.stop = () => teardown();
  try {
    trackInputRegisters();
  } catch (e) {
    note(e);
  }
  window.__oskTrackpadFix = state;
  state.timer = setInterval(tick, 250);
  tick();
  return state.status();
})();
