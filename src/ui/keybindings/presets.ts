/*
 * Keymap PRESETS ("shortcut styles") + JSON import/export. A preset is a set of combos that DIFFER
 * from the shipped defaults; applying one replaces the user overrides so the effective keymap matches
 * it. `detectPreset` names the current keymap (or 'custom' once hand-edited). Import/export round-trip
 * the full effective keymap as a small, validated JSON document. Reserved commands (undo/redo) are
 * never touched. All logic is pure so it unit-tests cleanly.
 */
import { COMMANDS, COMMAND_BY_ID } from './commands';
import { normalizeCombo, effectiveCombo, isReservedCombo, type Overrides } from './store';

export interface KeymapPreset {
  id: string;
  labelKey: string;
  /** Combos that DIFFER from the shipped defaults (id → combo, null = unbound). Others inherit. */
  binds: Record<string, string | null>;
}

/** "Numeric" — a number-row style for users who prefer not to hunt the left-hand cluster: tools sit
 *  on 1-8, build surfaces on Q/W/E, pan on the arrow keys (leaving WASD free), and layer up/down on
 *  Page Up / Page Down. Every other command keeps its default. */
const NUMERIC: Record<string, string | null> = {
  'surface.mountain': 'q', 'surface.river': 'w', 'surface.road': 'e',
  'tool.move': '1', 'tool.brush': '2', 'tool.eraser': '3', 'tool.rect': '4',
  'tool.circle': '5', 'tool.line': '6', 'tool.curve': '7', 'tool.edgecut': '8',
  'camera.pan_up': 'arrowup', 'camera.pan_down': 'arrowdown',
  'camera.pan_left': 'arrowleft', 'camera.pan_right': 'arrowright',
  'layer.up': 'pageup', 'layer.down': 'pagedown',
};

export const PRESETS: KeymapPreset[] = [
  { id: 'default', labelKey: 'kbd.preset.default', binds: {} },
  { id: 'numeric', labelKey: 'kbd.preset.numeric', binds: NUMERIC },
];

/** Full effective keymap of a preset: every non-reserved command → normalized combo|null. */
export function presetBinds(preset: KeymapPreset): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const cmd of COMMANDS) {
    if (cmd.reserved) continue;
    const raw = cmd.id in preset.binds ? preset.binds[cmd.id] : cmd.defaultCombo;
    m.set(cmd.id, raw == null ? null : normalizeCombo(raw));
  }
  return m;
}

/** Full effective keymap under the current overrides (non-reserved commands). */
export function currentBinds(overrides: Overrides): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const cmd of COMMANDS) {
    if (cmd.reserved) continue;
    const c = effectiveCombo(overrides, cmd.id);
    m.set(cmd.id, c == null ? null : normalizeCombo(c));
  }
  return m;
}

function mapsEqual(a: Map<string, string | null>, b: Map<string, string | null>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

/** Which preset the current overrides match, or 'custom'. */
export function detectPreset(overrides: Overrides): string {
  const cur = currentBinds(overrides);
  for (const p of PRESETS) if (mapsEqual(cur, presetBinds(p))) return p.id;
  return 'custom';
}

/* ── JSON import / export ─────────────────────────────────────────────────── */

const FILE_MARK = 'petitmaker-keybinds';

/** Export the current effective keymap as a portable, pretty-printed JSON string. */
export function serializeKeybinds(overrides: Overrides): string {
  const binds: Record<string, string | null> = {};
  for (const [id, combo] of currentBinds(overrides)) binds[id] = combo;
  return JSON.stringify({ app: FILE_MARK, version: 1, binds }, null, 2);
}

export interface ParseResult {
  ok: boolean;
  binds?: Record<string, string | null>;
  error?: 'invalid-json' | 'invalid-shape' | 'invalid-combo' | 'reserved-combo' | 'duplicate-combo' | 'empty';
}

/** Parse + validate imported keybinds JSON → a binds map limited to known, non-reserved commands.
 *  Accepts either the exported envelope ({binds:{…}}) or a bare id→combo map. Rejects malformed
 *  combos, reserved combos, and duplicates; silently ignores unknown command ids (forward-compat). */
export function parseKeybinds(text: string): ParseResult {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return { ok: false, error: 'invalid-json' }; }
  const env = data as { binds?: unknown } | null;
  const raw = env && typeof env === 'object' && env.binds && typeof env.binds === 'object' ? env.binds : data;
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'invalid-shape' };

  const binds: Record<string, string | null> = {};
  const seen = new Map<string, string>(); // normalized combo → command id
  for (const [id, val] of Object.entries(raw as Record<string, unknown>)) {
    const cmd = COMMAND_BY_ID.get(id);
    if (!cmd || cmd.reserved) continue; // ignore unknown ids + reserved commands
    if (val === null) { binds[id] = null; continue; }
    if (typeof val !== 'string') return { ok: false, error: 'invalid-combo' };
    const n = normalizeCombo(val);
    if (!n) return { ok: false, error: 'invalid-combo' };
    if (isReservedCombo(n)) return { ok: false, error: 'reserved-combo' };
    const prev = seen.get(n);
    if (prev && prev !== id) return { ok: false, error: 'duplicate-combo' };
    seen.set(n, id);
    binds[id] = n;
  }
  if (Object.keys(binds).length === 0) return { ok: false, error: 'empty' };
  return { ok: true, binds };
}
