/*
 * AutoTrim.tsx — the auto-trim setting, riding inside the active build cell's own pill.
 *
 * Everything about how a setting chip looks and behaves is `SettingChip`; this is the SETTING: what
 * its states are, what comes next, and what "doing something" means for it. Every cell whose stroke
 * runs the post-stroke trim pass carries one (`terrain-cells.ts:ToolCell.autoTrim`).
 *
 * THE OFF STATE IS NAMED "No Trim", not "Off": the chip shows one word with nothing around it to say
 * what the word is about, and "off" on its own is off WHAT.
 */
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { EC_NEXT, EC_STATE_KEY, edgeCutGlyph } from './edge-cut-glyph';
import { SettingChip } from './SettingChip';

export { CHIP_FOLDED_W, CHIP_INSET } from './SettingChip';

export function AutoTrim() {
  const t = useT();
  const mode = useEditorStore((s) => s.autoEdgeCut);
  const setAutoEdgeCut = useEditorStore((s) => s.setAutoEdgeCut);

  return (
    <SettingChip
      state={mode}
      name={t(EC_STATE_KEY[mode])}
      label={t('edgecut.auto')}
      on={mode !== 'off'}
      glyph={(size, color) => edgeCutGlyph(mode, size, color)}
      onCycle={() => setAutoEdgeCut(EC_NEXT[mode])}
    />
  );
}
