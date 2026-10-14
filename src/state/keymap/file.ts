/*
 * The keymap file: JSON export and import of the effective keymap.
 *
 * Import must reject conflicts so a crafted or edited file can't collide two commands onto one key.
 */
import { normalizeCombo } from '../../platform/input/combo';
import { META_BY_ID, UI_ZOOM_IDS, withCurrentIds } from './registry';
import { currentBinds, uiZoomVariantCombos, type Overrides } from './resolve';

const FILE_MARK = 'petitmaker-keybinds';

/** Export the current effective keymap as a portable, pretty-printed JSON string. */
export function serializeKeybinds(overrides: Overrides): string {
  const binds: Record<string, string | null> = {};
  for (const [id, combo] of currentBinds(overrides)) binds[id] = combo;
  return JSON.stringify({ app: FILE_MARK, version: 1, binds, overrides }, null, 2);
}

interface ParseResult {
  ok: boolean;
  binds?: Record<string, string | null>;
  overrides?: Overrides;
  error?: 'invalid-json' | 'invalid-shape' | 'invalid-combo' | 'reserved-combo' | 'duplicate-combo' | 'empty';
}

/** Parse + validate imported keybinds JSON → a binds map limited to known commands. Accepts either
 *  the exported envelope ({binds:{…}}) or a bare id→combo map. Rejects malformed combos, duplicates,
 *  and a command parked on a shifted twin of the file's own UI-zoom bindings; silently ignores
 *  unknown command ids (forward-compat). */
export function parseKeybinds(text: string): ParseResult {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return { ok: false, error: 'invalid-json' }; }
  const env = data as { binds?: unknown } | null;
  const raw = env && typeof env === 'object' && env.binds && typeof env.binds === 'object' ? env.binds : data;
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'invalid-shape' };

  const binds: Record<string, string | null> = {};
  const seen = new Map<string, string>(); // normalized combo → command id
  for (const [id, val] of Object.entries(withCurrentIds(raw as Record<string, unknown>))) {
    if (!META_BY_ID.has(id)) continue; // ignore unknown ids
    if (val === null) { binds[id] = null; continue; }
    if (typeof val !== 'string') return { ok: false, error: 'invalid-combo' };
    const n = normalizeCombo(val);
    if (!n) return { ok: false, error: 'invalid-combo' };
    const prev = seen.get(n);
    if (prev && prev !== id) return { ok: false, error: 'duplicate-combo' };
    seen.set(n, id);
    binds[id] = n;
  }
  if (Object.keys(binds).length === 0) return { ok: false, error: 'empty' };
  // The twins are read from the file's own zoom bindings (ids it omits keep their defaults, exactly
  // as applyBinds resolves them), so a file that moves the zoom keys is judged where it put them.
  const variants = uiZoomVariantCombos(binds);
  for (const [id, combo] of Object.entries(binds)) {
    if (combo && !UI_ZOOM_IDS.includes(id) && variants.has(combo)) return { ok: false, error: 'reserved-combo' };
  }
  if (env && typeof env === 'object' && 'overrides' in env) {
    const exact = (env as { overrides: unknown }).overrides;
    if (!exact || typeof exact !== 'object' || Array.isArray(exact)) return { ok: false, error: 'invalid-shape' };
    const parsed = Object.keys(exact).length ? parseKeybinds(JSON.stringify(exact)) : { ok: true, binds: {} };
    if (!parsed.ok || !parsed.binds) return { ok: false, error: 'invalid-shape' };
    for (const [id, combo] of currentBinds(parsed.binds)) {
      if (binds[id] !== combo) return { ok: false, error: 'invalid-shape' };
    }
    return { ok: true, binds, overrides: parsed.binds };
  }
  return { ok: true, binds };
}
