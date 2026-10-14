/**
 * The save file: which sections it carries, each with its size, the map's title and description
 * under the same text check as the share picture, and the export. Section sizes are measured once
 * per opening (and when the history depth changes), never per switch, so a long undo history never
 * freezes the panel; the total sums the measured sizes.
 */
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { clampNotes } from '../../../../core/model/notes';
import type { MapNotes } from '../../../../core/model/types';
import { onAfterPaint } from '../../../../platform/async/after-paint';
import { useT } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import type { SectionKey, SectionSizes } from '../../../../io/save/sections';
import {
  effectiveSections, estimatedTotal, initialSections, jsonReviewParts, measureJsonSections, RECENT_HISTORY_STEPS, sectionsReducer,
  writeJsonExport, type HistoryDepth,
} from '../../../../editor/export/json-export';
import { useCursorCss } from '../../../design/cursors/cursor-vars';
import { skin } from '../../../design/window-skin';
import { roleFont } from '../../../design/text-weight';
import { ActionButton } from '../../../primitives/ActionButton';
import { Expand } from '../../../primitives/Expand';
import { LoadingDots } from '../../../primitives/LoadingDots';
import { ScrollArea } from '../../../primitives/ScrollArea';
import { SegmentedControl } from '../../../primitives/SegmentedControl';
import { Spinner } from '../../../primitives/Spinner';
import { Switch } from '../../../primitives/Switch';
import { CONTROL_CLEARANCE } from '../../../primitives/use-scroll-row';
import { WindowFooter } from '../../../primitives/Window';
import { HelpBubble } from './HelpBubble';
import { useAttribution } from './use-attribution';
import { MapReviewStatus } from './review/MapReviewStatus';
import { useExportNotice } from './review/ExportNotice';
import { useMapReview } from './review/use-map-review';
import { useTextReview } from './review/use-text-review';
import { REVIEW_FIELD_LABEL } from './review/review-fields';
import { AnimatedTotal, NotesFields, notesByteLen, rowDesc, SectionRow } from './json/JsonParts';
import type { I18nKey } from '../../../../i18n/keys';
import { useSettledValue } from '../../../primitives/use-settled-value';

interface RowSpec { key: SectionKey; label: I18nKey; desc: I18nKey; hint?: I18nKey }

/** The plain rows, in the panel's order; the hint is what a row says while the map cannot carry it. */
const PLAIN_ROWS: readonly RowSpec[] = [
  { key: 'generation', label: 'export.json_generation', desc: 'export.json_generation_desc', hint: 'export.json_no_generation' },
  { key: 'provenance', label: 'export.json_provenance', desc: 'export.json_provenance_desc', hint: 'export.json_no_provenance' },
];
const LATE_ROWS: readonly RowSpec[] = [
  { key: 'session', label: 'export.json_session', desc: 'export.json_session_desc' },
  { key: 'stats', label: 'export.json_stats', desc: 'export.json_stats_desc' },
  { key: 'catalog', label: 'export.json_catalog', desc: 'export.json_catalog_desc' },
];

/** The save-file panel. Expensive section measurement runs only while open. */
export function ExportJsonPanel({ open, onDone }: { open: boolean; onDone: () => void }) {
  const t = useT();
  const busy = useCursorCss('busy');
  const gridState = useEditorStore((s) => s.gridState);
  const commandExecutor = useEditorStore((s) => s.commandExecutor);
  const available = { generation: !!gridState?.generation, provenance: !!gridState?.provenance };
  const [chosen, dispatch] = useReducer(sectionsReducer, available, initialSections);

  const attribution = useAttribution(open);
  const sections = effectiveSections(chosen, attribution.locked);
  // The title and description are the map's own, shared with the image export and the share code.
  useEditorStore((s) => s.gridState?.notes);
  const setMapNotes = useEditorStore((s) => s.setMapNotes);
  const notesVal: MapNotes = useSettledValue(attribution.notes);
  const fileNotes = useMemo(() => clampNotes(notesVal), [notesVal]);

  const [sizes, setSizes] = useState<{ compact: SectionSizes; pretty: SectionSizes } | null>(null);
  const [historyCount, setHistoryCount] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [composing, setComposing] = useState(false);
  const cancelExportPaint = useRef<() => void>(() => {});
  const exportRevision = useRef(0);
  const reviewParts = useMemo(() => jsonReviewParts(notesVal, sections.notes), [sections.notes, notesVal]);
  const textReview = useTextReview(open, reviewParts, sections.notes && composing);
  const issue = textReview.issue;
  const refusedFields = issue && typeof issue === 'object' ? issue.fields : [];
  const checking = (field: keyof MapNotes) => textReview.pending && reviewParts.some(part => part.field === field);
  const mapReview = useMapReview(open, false, false, sections.annotations);
  const exportDisabled = exporting || mapReview.pending || !textReview.allowed || mapReview.result?.status === 'blocked';
  const noticeRevision = JSON.stringify([sections, notesVal, composing]);
  const notice = useExportNotice(open, noticeRevision, gridState, 'json');

  useEffect(() => {
    // The counter, not a node: the cleanup bumps the same box the effect did.
    const revision = exportRevision;
    revision.current++;
    setExporting(false);
    return () => { revision.current++; cancelExportPaint.current(); };
  }, [open, noticeRevision, gridState, mapReview.revision]);

  // Measured in both formats once, after the loader paints, so Pretty-print only changes which set is summed.
  useEffect(() => {
    setSizes(null);
    if (!open || !gridState || !commandExecutor) return undefined;
    return onAfterPaint(() => {
      const measured = measureJsonSections(chosen.historyDepth);
      if (!measured) return;
      setSizes(measured.sizes);
      setHistoryCount(measured.historySteps);
    });
  }, [open, gridState, commandExecutor, chosen.historyDepth]);

  const notesBytes = sections.notes ? notesByteLen(fileNotes, sections.pretty) : 0;
  const shown = sizes ? (sections.pretty ? sizes.pretty : sizes.compact) : null;
  const total = shown ? estimatedTotal(shown, sections, available, notesBytes) : null;

  async function handleExportClick() {
    if (!open || exportDisabled) return;
    const revision = exportRevision.current;
    const mapCheck = mapReview.check().catch(() => null);
    if (!await notice.request() || revision !== exportRevision.current) { mapReview.cancel(); return; }
    const mapResult = await mapCheck;
    if (!mapResult || mapResult.status === 'blocked' || revision !== exportRevision.current) return;
    const { gridState: state, commandExecutor: executor } = useEditorStore.getState();
    if (!state || !executor) return;
    // The busy state paints before a potentially large history is serialized.
    setExporting(true);
    cancelExportPaint.current = onAfterPaint(() => {
      if (revision !== exportRevision.current) return;
      const written = writeJsonExport(sections, available, fileNotes ?? null);
      setExporting(false);
      if (written) onDone();
    });
  }

  const row = ({ key, label, desc, hint }: RowSpec) => {
    const unavailable = (key === 'generation' && !available.generation) || (key === 'provenance' && !available.provenance);
    return (
      <SectionRow key={key} name={t(label)} desc={t(desc)} {...(hint ? { hint: t(hint) } : {})}
        checked={sections[key] && !unavailable} disabled={unavailable} onToggle={() => dispatch({ type: 'toggle', key })} bytes={shown?.[key]} />
    );
  };
  const textIssue = issue && (
    <div role="alert" style={rowDesc}>
      {issue === 'unavailable' ? t('export.review.unavailable') : issue === 'too-long' ? t('export.review.too_long') : t('export.review.content', { fields: issue.fields.map(field => t(REVIEW_FIELD_LABEL[field])).join(', ') })}
      {issue === 'unavailable' && <ActionButton appearance="secondary" onClick={textReview.retry} style={{ marginTop: 8 }}>{t('export.review.retry')}</ActionButton>}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
      {notice.notice}
      <ScrollArea gutter="stable" style={{ flex: '1 1 auto' }}
        contentStyle={{ display: 'flex', flexDirection: 'column', gap: 14, padding: CONTROL_CLEARANCE }}>
        <SectionRow name={t('export.json_core')} desc={t('export.json_core_desc')} checked disabled onToggle={() => {}} bytes={shown?.core} />
        {row({ key: 'annotations', label: 'export.json_annotations', desc: 'export.json_annotations_desc' })}
        {/* The expanding fields share the row's flex item, so a collapsed editor adds no gap. */}
        <div>
          <SectionRow name={t('export.json_notes')} desc={t('export.json_notes_desc')} checked={sections.notes} disabled={attribution.locked}
            onToggle={() => { dispatch({ type: 'toggle', key: 'notes' }); setComposing(false); }} bytes={shown ? notesBytes : undefined} />
          <Expand open={sections.notes}>
            <NotesFields notes={notesVal} onChange={setMapNotes} titleLocked={attribution.titleLocked} descriptionLocked={attribution.descriptionLocked}
              checking={checking} refused={refusedFields} issue={textIssue} onComposing={setComposing} />
          </Expand>
        </div>
        {PLAIN_ROWS.map(row)}
        <div>
          {row({ key: 'history', label: 'export.json_history', desc: 'export.json_history_desc' })}
          <Expand open={sections.history}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0 4px' }}>
              <SegmentedControl<HistoryDepth>
                idPrefix="history-depth"
                value={chosen.historyDepth}
                options={['all', 'recent']}
                render={(k) => (k === 'all' ? t('export.json_depth_all') : t('export.json_depth_last', { n: RECENT_HISTORY_STEPS }))}
                onChange={(depth) => dispatch({ type: 'depth', depth })}
              />
              <span style={rowDesc}>{t('units.steps', { n: historyCount })}</span>
            </div>
          </Expand>
        </div>
        {LATE_ROWS.map(row)}
      </ScrollArea>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 16, paddingTop: 12, borderTop: `1.5px solid ${skin.line}`, flex: '0 0 auto' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ ...roleFont('caption'), color: skin.ink }}>{t('export.json_pretty')}</span>
          <HelpBubble text={t('export.json_pretty_help')} />
        </span>
        <Switch on={sections.pretty} onClick={() => dispatch({ type: 'toggle', key: 'pretty' })} label={t('export.json_pretty')} />
        <span style={{ flex: 1 }} />
        {total == null
          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ ...roleFont('small'), color: skin.plateInk }}>{t('export.json_total')}:</span>
              <Spinner size={13} />
            </span>
          : <AnimatedTotal bytes={total} label={t('export.json_total')} />}
      </div>

      <MapReviewStatus result={mapReview.result} pending={mapReview.pending} onRetry={() => { mapReview.retry(); }} />
      <WindowFooter style={{ marginTop: 14, flex: '0 0 auto' }}
        cancel={<ActionButton appearance="secondary" onClick={() => { exportRevision.current++; cancelExportPaint.current(); textReview.cancel(); onDone(); }}>{t('export.json_btn_cancel')}</ActionButton>}
        primary={(
          <ActionButton appearance="primary" onClick={handleExportClick} disabled={exportDisabled && !exporting} aria-busy={exporting}
            style={exporting ? { cursor: busy, pointerEvents: 'none' } : undefined}>
            {exporting ? <span style={{ display: 'inline-flex', height: 15, alignItems: 'center' }}><LoadingDots color={skin.plate} /></span> : t('export.json_btn_export')}
          </ActionButton>
        )}
      />
    </div>
  );
}
