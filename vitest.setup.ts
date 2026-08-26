// Node 22+ can expose its own experimental `localStorage`/`sessionStorage` on globalThis,
// and without `--localstorage-file` every access throws. That stub can shadow jsdom's
// working storage in the test environment, failing every persistence test. A storage that
// cannot be read is replaced with a plain in-memory Storage here; a working one is kept.
const usable = (s: Storage | undefined): boolean => {
  if (!s) return false;
  try {
    s.getItem('__probe__');
    return true;
  } catch {
    return false;
  }
};

const memoryStorage = (): Storage => {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
  };
};

for (const name of ['localStorage', 'sessionStorage'] as const) {
  if (!usable(globalThis[name])) {
    Object.defineProperty(globalThis, name, { value: memoryStorage(), configurable: true });
  }
}
