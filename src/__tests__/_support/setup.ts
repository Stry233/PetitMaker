import { installStencilBrowser } from '../../tools/generation/stencil/stencil-browser';
import { DOM_STENCIL_BROWSER } from '../../editor/host/stencil-dom';
import { __setSequentialIds } from '../../core/model/object-id';
import { registerLocaleTable } from '../../i18n/translations';
import { translations as LOCALE_TABLES } from './locale-tables';
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

// Stencils draw and decode through the document, as the editor installs it.
installStencilBrowser(DOM_STENCIL_BROWSER);

// Tests mint the same ids in the same order on every run.
__setSequentialIds();

// The editor loads a locale's strings when it first shows it; tests read every locale at once.
for (const [locale, table] of Object.entries(LOCALE_TABLES)) registerLocaleTable(locale as keyof typeof LOCALE_TABLES, table);
