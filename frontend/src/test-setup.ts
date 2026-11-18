Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
// Node 26's experimental global storage shadows jsdom's Storage. Keep browser
// storage deterministic in component tests; persistence is also checked in Chrome.
const data = new Map<string, string>();
const storage: Storage = {
  get length() { return data.size; },
  clear() { data.clear(); },
  getItem(key) { return data.get(key) ?? null; },
  setItem(key, value) { data.set(key, String(value)); },
  removeItem(key) { data.delete(key); },
  key(index) { return Array.from(data.keys())[index] ?? null; },
};
Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
// jsdom has no viewport to scroll; Motion can request scroll preservation.
window.scrollTo = () => {};
