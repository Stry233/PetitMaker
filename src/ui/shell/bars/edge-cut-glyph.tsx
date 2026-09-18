import type { AutoEdgeCut } from '../../../core/model/types';

export const EC_STATE_KEY: Record<AutoEdgeCut, string> = {
  off: 'edgecut.off',
  rect: 'edgecut.rect',
  round: 'edgecut.round',
};

/** The corner profile produced by each automatic trim mode. */
export function edgeCutGlyph(mode: AutoEdgeCut, size: number, color: string) {
  const d = mode === 'off' ? 'M5 24V5H24' : mode === 'rect' ? 'M5 24V14L14 5H24' : 'M5 24V17Q5 5 17 5H24';
  return <svg width={size} height={size} viewBox="0 0 29 29" aria-hidden>
    <path d="M5 24V5H24" fill="none" stroke={color} opacity=".25" strokeWidth="2" strokeDasharray="2 3"/>
    <path d={d} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>;
}
