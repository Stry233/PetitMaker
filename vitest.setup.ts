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

// Canvas tests install the context they need; the default stub suppresses jsdom's unsupported-context diagnostic.
if (typeof HTMLCanvasElement !== 'undefined') {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    writable: true,
    value: () => null,
  });
}

// Every locale's interface table, installed before any test runs. The app fetches ONE table at boot
// (`i18n/locales/index.ts`) precisely so the other six stay off the start-up payload, but a test that
// renders in French should not have to fetch anything to see French words — and would silently read
// English instead, which is how this went in. `translations` is the merged record kept for tests and
// scripts (see the note on it), and it goes in through the SAME overlay the runtime uses, so the
// lookup path under test is the one that ships.
//
// Loaded dynamically, and awaited, for two reasons: a static import would be evaluated before the
// storage stub above (ESM imports run first, and the store reads localStorage as it loads), and an
// un-awaited one would let tests start before the tables are in.
const [{ registerExtraStrings }, { translations }] = await Promise.all([
  import('./src/i18n/context'),
  import('./src/i18n/translations'),
]);
registerExtraStrings(translations);
