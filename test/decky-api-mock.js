export const callable =
  (name) =>
  (...args) =>
    window.__deckyCall(name, args);
export const toaster = { toast: () => {} };
