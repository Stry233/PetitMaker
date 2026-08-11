/*
 * edge-cut-glyph.tsx — the auto-trim setting's three states, drawn and named.
 *
 * Auto trim is a SETTING, not a tool: it is the corner treatment a finished build stroke gets, and
 * it is a cycle of three rather than a switch. The three facts a control needs of it — what comes
 * next, what corner each state produces, and the key that names it — are data, so they sit beside
 * `AutoTrim.tsx` rather than inside it, where a test can read them without mounting the chip.
 *
 * The name keys are a TABLE, not `'edgecut.' + mode`. A key assembled at runtime is a key no search
 * finds and no missing-string check can enumerate, and a lookup that misses announces the raw key to
 * a screen reader.
 */
import type { AutoEdgeCut } from '../../../core/model/types';

/** Off, then the two shapes a trim can leave, then off again. */
export const EC_NEXT: Record<AutoEdgeCut, AutoEdgeCut> = { off: 'rect', rect: 'round', round: 'off' };

/** What each state is called. */
export const EC_STATE_KEY: Record<AutoEdgeCut, string> = {
  off: 'edgecut.off',
  rect: 'edgecut.rect',
  round: 'edgecut.round',
};

/**
 * The corner this state produces: an untouched square block, a bevel, a rounded corner.
 *
 * Off is drawn HOLLOW and the two working states solid, so the setting says whether it is doing
 * anything through the shape itself and not only through whatever the host plates it with.
 */
export function edgeCutGlyph(mode: AutoEdgeCut, size: number, color: string) {
  const common = { width: size, height: size, viewBox: '0 0 24 24' };
  if (mode === 'round') {
    return <svg {...common}><circle cx="12" cy="12" r="9" fill={color} /></svg>;
  }
  if (mode === 'rect') {
    return <svg {...common}><polygon points="12,2 22,12 12,22 2,12" fill={color} /></svg>;
  }
  return <svg {...common}><rect x="3.5" y="3.5" width="17" height="17" rx="1.5" fill="none" stroke={color} strokeWidth="2.5" /></svg>;
}
