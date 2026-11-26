/**
 * What a just-opened map changes to stand within this version's rules, before it changes: repair
 * automatically, which lands the planner's proposals, or by hand. Each choice is a picture of the
 * map it leads to, offered as Change Planet offers its maps, its objects flagged as the live map
 * would flag them, and the terrain that gives way marked in red. A map whose only change is that terrain
 * shows the one picture. Export first downloads the map as it came, before any repair, and the
 * choice stays open. Cancel, Close and Escape bring back the map that was open before.
 */
import { useId, useMemo, useState, type CSSProperties } from 'react';
import { quantityParams, useLocale, useT } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { automaticRepairCounts } from '../../../../state/slices/repair-session';
import { canExportUnrepaired, exportUnrepaired, repairPreviews, unrepairedFormat } from '../../../../editor/session/landmark-repair';
import { pressCommand } from '../../../../editor/commands/run';
import { roleFont } from '../../../design/text-weight';
import { skin } from '../../../design/window-skin';
import { ActionButton } from '../../../primitives/ActionButton';
import { ModalShell } from '../../../primitives/ModalShell';
import { WindowBody, WindowFooter, WindowHeader, windowColumn, windowFrame } from '../../../primitives/Window';
import { useWindow } from '../use-window';
import { PictureChoices, pictureStage } from '../planet/PictureOption';
import { PlanetPreview } from '../planet/PlanetPreview';
import { ExportFirstButton } from '../ExportFirstButton';
import { useExportNotice } from '../export/review/ExportNotice';
import { useWindowColumns } from '../use-window-columns';

type Choice = 'auto' | 'hand';

const cancelRepair = (): void => pressCommand('repair.cancel');

/** No report, nothing moved. */
const NO_MOVES = { moved: 0, removed: 0 } as const;
const cardStyle: CSSProperties = windowFrame;
const bodyStyle: CSSProperties = { ...windowColumn, gap: 18 };
const choiceStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 18 };
const leadStyle: CSSProperties = { ...roleFont('body'), color: skin.ink, margin: 0 };
const primaryStyle: CSSProperties = { flex: '0 0 auto', minWidth: 160 };
/** In one column the confirming action takes the footer's remaining width instead. */
const stackedPrimaryStyle: CSSProperties = { flex: '1 1 auto', minWidth: 0 };

export function LandmarkRepairWindow() {
  const t = useT();
  const locale = useLocale();
  const session = useEditorStore((s) => s.repairSession);
  const state = session?.phase === 'choose' ? session.pending : null;
  const { open } = useWindow('landmarkRepair', { onClose: cancelRepair });
  const report = session?.phase === 'choose' ? session.report : null;
  const [choice, setChoice] = useState<Choice>('auto');
  const titleId = useId();
  const [columns, bodyRef] = useWindowColumns();
  const previews = useMemo(() => (report && state ? repairPreviews(state, report) : null), [report, state]);
  const { moved, removed } = report ? automaticRepairCounts(report) : NO_MOVES;
  const objects = (report?.objects.length ?? 0) > 0;
  const autoBadge = removed > 0
    ? { text: t('repair.auto_remove', quantityParams(locale, { n: removed })), loss: true }
    : { text: t('repair.auto_badge', quantityParams(locale, { n: moved })) };
  const go = () => pressCommand('repair.apply', { how: choice === 'auto' || !objects ? 'automatic' : 'by_hand' });
  const format = unrepairedFormat(session);
  const notice = useExportNotice(open, null, state, format);
  const exportFirst = () => exportUnrepaired({ confirmNotice: () => notice.request() });
  const canExport = canExportUnrepaired(session);

  return (
    <ModalShell helpTarget={{ page: 'save' }} open={open && !!report && !!previews} onClose={cancelRepair} size="panel" width={900}
      cardStyle={cardStyle} ariaLabel={t('repair.title')}>
      {report && previews && state && (
        <div ref={bodyRef} style={bodyStyle} data-testid="landmark-repair">
          <WindowHeader reserve titleId={titleId} title={t('repair.title')} close={{ label: t('hint.close'), onPress: cancelRepair }} />
          <WindowBody contentStyle={choiceStyle}>
            <p style={leadStyle}>{t('repair.lead')}{objects && <><br />{t('repair.choose')}</>}</p>
            {objects ? (
              <PictureChoices<Choice> value={choice} onChange={setChoice} labelledBy={titleId} columns={columns} choices={[
                {
                  value: 'auto', testId: 'repair-auto-option', label: t('repair.auto'), badge: autoBadge,
                  picture: (onTap) => (
                    <PlanetPreview template={state.template} state={previews.auto} flagged={previews.autoFlagged} dropped={previews.ground}
                      fit={previews.fit} onTap={onTap} />
                  ),
                },
                {
                  value: 'hand', testId: 'repair-hand-option', label: t('repair.hand'),
                  badge: { text: t('repair.hand_badge', quantityParams(locale, { n: report.objects.length })), loss: true },
                  picture: (onTap) => (
                    <PlanetPreview template={state.template} state={previews.hand} flagged={previews.handFlagged} fit={previews.fit} onTap={onTap} />
                  ),
                },
              ]} />
            ) : (
              <div data-testid="repair-ground" style={pictureStage}>
                <PlanetPreview template={state.template} state={previews.auto} dropped={previews.ground} fit={previews.fit} />
              </div>
            )}
          </WindowBody>
          {notice.notice}
          <WindowFooter
            tertiary={canExport ? <ExportFirstButton testId="repair-export-first" onPress={() => { void exportFirst(); }} /> : undefined}
            cancel={<ActionButton appearance="tertiary" hoverFill={skin.inset} onClick={cancelRepair}>{t('delete.cancel')}</ActionButton>}
            primary={(
              <ActionButton appearance="primary" data-testid="repair-go" style={columns === 2 ? primaryStyle : stackedPrimaryStyle} onClick={go}>
                {choice === 'auto' || !objects ? t('repair.auto') : t('repair.hand')}
              </ActionButton>
            )}
          />
        </div>
      )}
    </ModalShell>
  );
}
