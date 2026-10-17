/**
 * The plate over a map under a hand repair: how many of its objects still stand against the rules,
 * and the ways out: repair the rest automatically, finish once nothing is left, or cancel back to the map
 * that was open before.
 */
import { quantityParams, useLocale, useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { cancelRepair, finishRepair, repairTheRest } from '../../../editor/session/landmark-repair';
import { skin } from '../../design/window-skin';
import { ActionButton } from '../../primitives/ActionButton';
import { CheckIcon } from '../../primitives/line-glyphs';
import { MapPlate, plateButton, plateLabel } from './MapPlate';

const TICK = 18;

/** Whether a hand repair is under way, which is when the plate stands. */
export function useRepairLive(): boolean {
  return useEditorStore((s) => s.repairSession?.phase === 'hand');
}

export function RepairPlate({ motionProps }: { motionProps?: Record<string, unknown> }) {
  const t = useT();
  const locale = useLocale();
  const left = useEditorStore((s) => (s.repairSession?.phase === 'hand' ? s.repairSession.left.length : 0));
  return (
    <MapPlate title={t('repair.plate_title')} testId="repair-plate" {...(motionProps ? { motionProps } : {})}>
      <span data-testid="repair-left" style={plateLabel}>{t('repair.left', quantityParams(locale, { n: left }))}</span>
      <ActionButton appearance="tertiary" interaction="pill" hoverFill={skin.inset} data-testid="repair-cancel" onClick={cancelRepair}
        style={{ ...plateButton, marginInlineStart: 6 }}>
        {t('delete.cancel')}
      </ActionButton>
      <ActionButton appearance="secondary" interaction="pill" data-testid="repair-rest" disabled={left === 0} onClick={() => { repairTheRest(); }}
        style={plateButton}>
        {t('repair.rest')}
      </ActionButton>
      <ActionButton appearance="primary" interaction="pill" data-testid="repair-finish" disabled={left > 0} onClick={() => { finishRepair(); }}
        style={plateButton}>
        <CheckIcon size={TICK} />
        {t('repair.finish')}
      </ActionButton>
    </MapPlate>
  );
}
