/**
 * What a just-opened map changes to stand within this version's rules, before it changes: repair
 * automatically, which lands the planner's proposals, or by hand. Each choice is a picture of the
 * map it leads to, offered as Change Planet offers its maps, its objects flagged as the live map
 * would flag them, and the terrain that gives way marked in red. A map whose only change is that terrain
 * shows the one picture. Export first downloads the map as it came, before any repair, and the
 * choice stays open. Cancel, Close and Escape bring back the map that was open before.
 */
import { useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { quantityParams, useLocale, useT } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { LOSS_COLOR } from '../../../../view/shared/viewport/view-constants';
import {
  cancelRepair, exportUnrepaired, repairAutomatically, repairByHand, repairPreviews, unrepairedFormat,
} from '../../../../editor/session/landmark-repair';
import { SUPPORTS_JSON_FILES } from '../../../../platform/build/edition';
import { roleFont } from '../../../design/text-weight';
import { skin } from '../../../design/window-skin';
import { ActionButton } from '../../../primitives/ActionButton';
import { ModalShell } from '../../../primitives/ModalShell';
import { WindowFooter, WindowHeader, windowFrame } from '../../../primitives/Window';
import { useWindow } from '../use-window';
import { PictureOption, pictureStage } from '../planet/PictureOption';
import { PlanetPreview } from '../planet/PlanetPreview';
import { ExportFirstButton } from '../ExportFirstButton';
import { useExportNotice } from '../export/review/ExportNotice';

type Choice = 'auto' | 'hand';
const ORDER: readonly Choice[] = ['auto', 'hand'];

const cardStyle: CSSProperties = { ...windowFrame, overflowY: 'auto', overflowX: 'hidden' };
const bodyStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 18 };
const optionsStyle: CSSProperties = { display: 'flex', gap: 16 };
const leadStyle: CSSProperties = { ...roleFont('body'), color: skin.ink, margin: 0 };
const primaryStyle: CSSProperties = { flex: '0 0 auto', minWidth: 160 };

export function LandmarkRepairWindow() {
  const t = useT();
  const locale = useLocale();
  const session = useEditorStore((s) => s.repairSession);
  const state = session?.phase === 'choose' ? session.pending : null;
  const { open } = useWindow('landmarkRepair', { onClose: cancelRepair });
  const report = session?.phase === 'choose' ? session.report : null;
  const [choice, setChoice] = useState<Choice>('auto');
  const titleId = useId();
  const refs = useRef<Record<Choice, HTMLDivElement | null>>({ auto: null, hand: null });
  const previews = useMemo(() => (report && state ? repairPreviews(state, report) : null), [report, state]);
  const moved = report ? report.plan.moves.filter((m) => m.proposal.kind !== 'no-place').length : 0;
  const removed = report ? report.plan.moves.length - moved : 0;
  const objects = (report?.objects.length ?? 0) > 0;
  const autoBadge = removed > 0
    ? { text: t('repair.auto_remove', quantityParams(locale, { n: removed })), swatch: LOSS_COLOR }
    : { text: t('repair.auto_badge', quantityParams(locale, { n: moved })) };
  const keys = (value: Choice) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setChoice(value); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const other = ORDER[(ORDER.indexOf(value) + 1) % ORDER.length]!;
    setChoice(other);
    refs.current[other]?.focus();
  };
  const option = (value: Choice) => ({
    checked: choice === value,
    onSelect: () => setChoice(value),
    onKeyDown: keys(value),
    optionRef: (el: HTMLDivElement | null) => { refs.current[value] = el; },
  });
  const go = () => { if (choice === 'auto' || !objects) repairAutomatically(); else repairByHand(); };
  const format = unrepairedFormat(session);
  const notice = useExportNotice(open, null, state, format);
  const exportFirst = async () => { if (await notice.request()) exportUnrepaired(); };
  // An edition that reads no save files offers no save file to keep.
  const canExport = format === 'image' || SUPPORTS_JSON_FILES;

  return (
    <ModalShell helpTarget={{ page: 'save' }} open={open && !!report && !!previews} onClose={cancelRepair} size="panel" width={900}
      cardStyle={cardStyle} ariaLabel={t('repair.title')}>
      {report && previews && state && (
        <div style={bodyStyle} data-testid="landmark-repair">
          <WindowHeader reserve titleId={titleId} title={t('repair.title')} close={{ label: t('hint.close'), onPress: cancelRepair }} />
          <p style={leadStyle}>{t('repair.lead')}{objects && <><br />{t('repair.choose')}</>}</p>
          {objects ? (
            <div role="radiogroup" aria-labelledby={titleId} style={optionsStyle}>
              <PictureOption {...option('auto')} testId="repair-auto-option" label={t('repair.auto')} badge={autoBadge}>
                {(onTap) => (
                  <PlanetPreview template={state.template} state={previews.auto} flagged={previews.autoFlagged} dropped={previews.ground}
                    fit={previews.fit} onTap={onTap} />
                )}
              </PictureOption>
              <PictureOption {...option('hand')} testId="repair-hand-option" label={t('repair.hand')}
                badge={{ text: t('repair.hand_badge', quantityParams(locale, { n: report.objects.length })), swatch: LOSS_COLOR }}>
                {(onTap) => <PlanetPreview template={state.template} state={previews.hand} flagged={previews.handFlagged} fit={previews.fit} onTap={onTap} />}
              </PictureOption>
            </div>
          ) : (
            <div data-testid="repair-ground" style={pictureStage}>
              <PlanetPreview template={state.template} state={previews.auto} dropped={previews.ground} fit={previews.fit} />
            </div>
          )}
          {notice.notice}
          <WindowFooter
            tertiary={canExport ? <ExportFirstButton testId="repair-export-first" onPress={() => { void exportFirst(); }} /> : undefined}
            cancel={<ActionButton appearance="tertiary" hoverFill={skin.inset} onClick={cancelRepair}>{t('delete.cancel')}</ActionButton>}
            primary={(
              <ActionButton appearance="primary" data-testid="repair-go" style={primaryStyle} onClick={go}>
                {choice === 'auto' || !objects ? t('repair.auto') : t('repair.hand')}
              </ActionButton>
            )}
          />
        </div>
      )}
    </ModalShell>
  );
}
