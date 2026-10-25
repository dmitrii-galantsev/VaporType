(() => {
  const calls = (window.__steamCalls = []);
  const keyLog = (window.__keyLog = []);
  const regs = (window.__steamRegs = {});
  const t0 = performance.now();
  const now = () => Math.round(performance.now() - t0);

  const nodes = new Map();
  function deep(path) {
    if (nodes.has(path)) return nodes.get(path);
    const fn = function () {};
    const own = {};
    const node = new Proxy(fn, {
      set(_, prop, v) {
        own[prop] = v;
        return true;
      },
      get(_, prop) {
        if (Object.hasOwn(own, prop)) return own[prop];
        if (prop === "call" || prop === "apply" || prop === "bind") return Function.prototype[prop];
        if (prop === "then" || (typeof prop === "string" && prop.startsWith("__osk"))) return undefined;
        if (prop === Symbol.toPrimitive) return () => 0;
        if (prop === Symbol.iterator) return function* () {};
        if (prop === "unregister") return () => {};
        if (typeof prop === "symbol") return undefined;
        return deep(`${path}.${prop}`);
      },
      apply(_, __, args) {
        calls.push([now(), path, args]);
        const name = path.split(".").pop();
        if (/^Register/.test(name)) {
          const set = (regs[path] ??= new Set());
          const cb = args[0];
          set.add(cb);
          return { unregister: () => set.delete(cb) };
        }
        if (/^(Get|B|Is)/.test(name)) return Promise.resolve(undefined);
        return undefined;
      },
    });
    nodes.set(path, node);
    return node;
  }

  const input = {
    ControllerKeyboardSendText(text) {
      keyLog.push([now(), "text", String(text)]);
    },
    ControllerKeyboardSetKeyState(key, down) {
      if (this !== window.SteamClient.Input) throw new TypeError("Illegal invocation");
      keyLog.push([now(), down ? "down" : "up", key]);
    },
  };
  window.SteamClient = new Proxy(
    { Input: new Proxy(input, { get: (t, p) => (p in t ? t[p] : typeof p === "symbol" ? undefined : deep(`SteamClient.Input.${p}`)) }) },
    { get: (t, p) => (p in t ? t[p] : typeof p === "symbol" ? undefined : deep(`SteamClient.${p}`)) },
  );
  window.SteamUIStore = { ActiveWindowInstance: { BrowserWindow: window }, WindowStore: { SteamUIWindows: [] } };
  window.IBus = { ModifierType: { SHIFT_MASK: 1 } };
})();
