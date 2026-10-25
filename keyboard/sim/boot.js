(async () => {
  const req = self.__steamRequire;
  await Promise.all([9068, 3714].map((c) => req.e(c)));
  try {
    req(89107);
  } catch (e) {
    console.warn("app module init:", e);
  }
  try {
    await req.e(3569);
    const tokens = req(82545);
    req(7727).pf.InitFromObjects(tokens.default ?? tokens);
  } catch (e) {
    console.warn("localization:", e);
  }
  const jsx = req(62540);
  const ReactDOM = req(7470);
  const { ER: WindowInstanceProvider } = req(29827);
  const { Y: VirtualKeyboardContainer } = req(52077);
  const base = {
    BrowserWindow: window,
    BUseVRKeyboard: () => false,
    IsAnyVRWindow: () => false,
    IsVRSimulatedOnDesktopWindow: () => false,
    IsDesktopOverlayWindow: () => false,
    IsGamepadUIWindow: () => true,
    IsMainGamepadUIWindow: () => true,
  };
  const windowInstance = new Proxy(base, {
    get(t, p) {
      if (p in t) return t[p];
      if (typeof p === "symbol" || p === "then") return undefined;
      return () => undefined;
    },
  });
  const vkm = new (req(5363).PE)(windowInstance);
  base.VirtualKeyboardManager = vkm;
  vkm.Init();
  window.__sim = { req, vkm, windowInstance, appSteamUIStore: window.SteamUIStore };
  window.SteamUIStore = { ActiveWindowInstance: windowInstance, WindowStore: { SteamUIWindows: [windowInstance] } };
  ReactDOM.createRoot(document.getElementById("root")).render(
    jsx.jsx(WindowInstanceProvider, { instance: windowInstance, children: jsx.jsx(VirtualKeyboardContainer, {}) }),
  );
  await new Promise((r) => setTimeout(r, 300));
  vkm.SetVirtualKeyboardVisible();
  window.__simReady = true;
})().catch((e) => console.error("boot failed", e.stack));
