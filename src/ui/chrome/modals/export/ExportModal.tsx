import { framerMotion } from '../../../design/motion';
import { afterPaint } from '../../../../platform/async/after-paint';
import { useAttribution } from './use-attribution';
import { useMapReview, useTextReview } from './edition-export';
import { MapReviewStatus } from './review/MapReviewStatus';
import { useExportNotice } from './review/ExportNotice';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { radii, font } from '../../../design/styles';
import { skin } from '../../../design/window-skin';
import { roleFont } from '../../../design/text-weight';
import { useCursorCss } from '../../../design/cursors/cursor-vars';
import { Spinner } from '../../../primitives/Spinner';
import { ActionButton } from '../../../primitives/ActionButton';
import { WindowFooter } from '../../../primitives/Window';
import { useLocale, useT } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { provenanceSummaryOf } from '../../../../state/executor';
import { RESOLUTION_WIDTHS, formatFooterDate, isImportable, type ExportOptions } from '../../../../io/export/facts';
import { ExportControls } from './ExportControls';
import { ExportPreview } from './ExportPreview';
import { footerTokenValues } from '../../../../editor/export/preview';
import {
  exportImage, exportReviewParts, openingExportOptions, previewSafeOptions, rememberExportOptions,
} from '../../../../editor/export/image-export';
import type { ReviewIssue, ReviewProgress } from '../../../../editor/review/text-review';
import { LEGAL } from '../../../../legal/config';
import { useShareCode } from './use-share-code';
import { Expand } from '../../../primitives/Expand';
import { REVIEW_FIELD_LABEL } from './review/review-fields';
import { VEIL } from '../../../design/tokens';
import { useSettledValue } from '../../../primitives/use-settled-value';

/** Illustrative dims for the footer editor's reference menu (the real footer is resolved at paint
 *  time from the actual composition). */
function footerDimsSample(res: ExportOptions['resolution']): string {
  if (res === 'original') return 'native';
  const w = RESOLUTION_WIDTHS[res];
  return `${w}×${Math.round(w / 1.2)}`;
}

interface ImageDelivery {
  id: string;
  label: string;
  available: boolean;
  send: (image: Blob) => Promise<void>;
}

/** The share-picture controls on their own, so the "save and share" window can carry them as one
 *  of its sections. Everything expensive here is gated on `open` — the provenance summary,
 *  the share-code build, the preview's captures — so a mounted-but-hidden section costs nothing.
 *  `entered` is the host shell's `useModalEntered` answer: the picture waits for the card to settle. */
export function ExportPanel(
  { open, entered, onDone, deliveries }: { open: boolean; entered: boolean; onDone: () => void; deliveries?: readonly ImageDelivery[] },
) {
  const t = useT();
  const busy = useCursorCss('busy');
  // Gated on `open`: this selector runs on every store update, and the provenance
  // summary re-derives a full cell-taint scan per edit — a closed, always-mounted
  // modal must cost nothing while the user paints.
  const summary = useEditorStore((s) => (open ? provenanceSummaryOf(s) : undefined));
  const gridState = useEditorStore((s) => s.gridState);
  const locale = useLocale();
  // The window opens the way it was left: every choice but the map's own words is remembered.
  const [remembered, setOptions] = useState<ExportOptions>(openingExportOptions);
  // The title and description are the map's own notes, shared with the JSON export and the share code.
  useEditorStore((s) => s.gridState?.notes);
  const setMapNotes = useEditorStore((s) => s.setMapNotes);
  const attribution = useAttribution(open);
  const notes = attribution.notes;
  const notesKey = JSON.stringify(notes);
  const settledNotes = useSettledValue(notes);
  const options = useMemo<ExportOptions>(
    () => ({ ...remembered, title: settledNotes.title ?? '', description: settledNotes.description ?? '' }),
    [remembered, settledNotes],
  );
  const [exporting, setExporting] = useState(false);
  /** How far a tiled export has come, or null while the export is not tiled. */
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [reviewProgress, setReviewProgress] = useState<ReviewProgress | null>(null);
  const [reviewIssue, setReviewIssue] = useState<ReviewIssue | null>(null);
  const notice = useExportNotice(open, options, gridState);
  const exportRun = useRef<AbortController | null>(null);
  function cancelExport() {
    exportRun.current?.abort(); exportRun.current = null;
    setExporting(false); setReviewProgress(null);
  }
  useEffect(() => {
    if (!open) cancelExport();
    return () => { exportRun.current?.abort(); exportRun.current = null; };
  }, [open]);
  useEffect(() => { setReviewIssue(null); }, [options]);

  // The entrance comes first. The preview's capture, its paint and the share-code encode are all
  // synchronous main-thread work that would land inside the card's opening spring and stall it, so
  // the picture starts once the host's shell reports the card has entered (at once under reduced motion).
  const settled = open && entered;
  const mapReview = useMapReview(open, settled, true);
  useEffect(() => { cancelExport(); }, [gridState, mapReview.revision]);
  const ready = open && settled && mapReview.previewReady;

  // One timestamp per modal session: it goes into the code's payload, so fixing it at open makes
  // the previewed band pixel-identical to the exported one (the export reuses the cached asset).
  const [createdAt, setCreatedAt] = useState('');
  useEffect(() => { if (open) setCreatedAt(new Date().toISOString()); }, [open]);

  const [composing, setComposing] = useState(false);
  useEffect(() => { if (!open) setComposing(false); }, [open]);
  const footerValues = open && gridState ? footerTokenValues(gridState, options, locale, summary ?? null) : {};
  const reviewParts = exportReviewParts(options, footerValues);
  const textReview = useTextReview(open, reviewParts, composing);
  const issue = reviewIssue ?? textReview.issue;
  const textlessExportDisabled = attribution.locked || exporting || mapReview.pending || mapReview.result?.status === 'blocked';
  const exportDisabled = composing || exporting || mapReview.pending || mapReview.result?.status === 'blocked' || (issue !== null && typeof issue === 'object');

  // The web edition waits for review; Lite uses the manual export acknowledgement.
  const safeOptions = previewSafeOptions(options, textReview.allowed, composing);
  const previewOptions = useSettledValue(safeOptions);
  const previewFooter = useSettledValue({ ...footerValues, title: previewOptions.title });
  const openedWith = useRef(remembered);
  useEffect(() => { rememberExportOptions(remembered, openedWith.current); }, [remembered]);

  // The real share-code band, built async + debounced — never on the open animation frame and
  // never per keystroke, because a synchronous build is heavy enough to freeze the modal's
  // entrance. While it builds, the preview keeps its last picture (or its loading state when
  // there is none yet — no placeholder band).
  const code = useShareCode(ready, gridState ?? null, {
    summary: summary ?? null, importable: isImportable(options), resolution: options.resolution, createdAt, notesKey,
  });
  const codeAsset = code.asset;
  const codeIssue = code.issue;

  async function handleExport(withoutText = false, delivery?: ImageDelivery) {
    if (delivery && !delivery.available) return;
    if (exportRun.current || !open || (withoutText ? textlessExportDisabled : exportDisabled)) return;
    const controller = new AbortController();
    exportRun.current = controller;
    const { signal } = controller;
    let begun = false;
    try {
      const outcome = await exportImage(
        { options, withoutText, createdAt, previewCode: codeAsset, site: LEGAL.canonicalOrigin },
        {
          signal,
          checkMap: () => mapReview.check(),
          checkText: (parts) => textReview.check(parts),
          begin: () => {
            begun = true;
            setReviewIssue(null);
            if (withoutText) textReview.cancel();
            signal.addEventListener('abort', textReview.cancel, { once: true });
            setExporting(true);
            return afterPaint(); // the loading overlay paints before the heavy synchronous work begins
          },
          reviewing: (checking) => setReviewProgress(checking ? { phase: 'checking' } : null),
          progress: setExportProgress,
          confirmNotice: (carriesCode) => notice.request(carriesCode),
          ...(delivery ? { deliver: delivery.send } : {}),
        },
      );
      if (outcome.status === 'held' && !signal.aborted) setReviewIssue(outcome.issue);
      if (outcome.status === 'done') onDone();
    } finally {
      if (begun) signal.removeEventListener('abort', textReview.cancel);
      if (exportRun.current === controller) {
        exportRun.current = null;
        if (begun) { setExporting(false); setReviewProgress(null); setExportProgress(null); }
      }
    }
  }

  // Current footer token values for the footer editor's reference menu (date/dims are illustrative).
  const footerSamples = open && gridState ? {
    ...footerTokenValues(gridState, options, locale, summary ?? null), date: formatFooterDate(), dims: footerDimsSample(options.resolution),
  } : {};

  const settingsRef = useRef<HTMLDivElement>(null);
  const activeProgress = textReview.progress ?? reviewProgress;

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
      {notice.notice}
      {/* Loading overlay — covers the panel while the (partly synchronous) export runs, so the
          modal reads as busy instead of frozen. */}
      <AnimatePresence>
        {exporting && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={framerMotion('control.detail')}
            style={{ position: 'absolute', inset: 0, zIndex: 1, background: VEIL, backdropFilter: 'blur(2px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, borderRadius: radii.lg }}
         >
            <Spinner size={38} thickness={4} />
            <div role="status" style={{ fontFamily: font.family, ...roleFont('label'), color: skin.ink }}>{activeProgress ? t('export.review.checking') : exportProgress !== null ? t('export.progress', { percent: Math.round(exportProgress * 100) }) : t('export.exporting')}</div>
            {activeProgress && <div style={{ ...roleFont('caption'), color: skin.muted, maxWidth: 320, textAlign: 'center' }}>{t('export.review.private')}</div>}
            <ActionButton appearance="secondary" autoFocus onClick={cancelExport}>{t('export.review.cancel')}</ActionButton>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Body: left column = settings (scroll) + buttons; right column = preview spanning the
          full height of the left column (so the buttons row never wastes the preview's space). */}
      <div {...(exporting ? { inert: '' } : {})} style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 24, flex: '1 1 auto', minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* The stable gutter keeps the column from shifting when it starts to scroll; the left padding
              keeps the fields' focus ring clear of the clip. No scroll fade: a mask would clip the
              fixed-position tag menu and help bubbles this column renders inline. */}
          <div ref={settingsRef} onCompositionStartCapture={() => setComposing(true)} onCompositionEndCapture={() => setComposing(false)} style={{ overflowY: 'auto', overflowX: 'hidden', minHeight: 0, scrollbarGutter: 'stable', paddingLeft: 6, paddingRight: 8, flex: '1 1 auto' }}>
            <ExportControls options={options} setOptions={setOptions} notes={notes} setNotes={setMapNotes} titleLocked={attribution.titleLocked} descriptionLocked={attribution.descriptionLocked} summary={summary ?? null} footerSamples={footerSamples} checkingFields={textReview.pending && !exporting ? reviewParts.map((part) => part.field) : []} refusedFields={issue && typeof issue === 'object' ? issue.fields : []} reviewLabel={t('export.review.checking')} />
          </div>
          {!mapReview.pending && <MapReviewStatus result={mapReview.result} pending={false} onRetry={mapReview.retry} />}
          {/* Keep hover and focus inside the collapsing clip without narrowing the controls. */}
          <div style={{ margin: '0 -12px' }}>
            <Expand open={!!issue || textReview.paused}>
              <div role={issue ? "alert" : undefined} style={{ padding: 12, color: skin.ink, ...roleFont('caption'), lineHeight: 1.5 }}>
                {issue === 'unavailable' ? t('export.review.unavailable') : issue === 'too-long' ? t('export.review.too_long') : issue ? t('export.review.content', { fields: issue.fields.map((field) => t(REVIEW_FIELD_LABEL[field])).join(', ') }) : ''}
                {(textReview.paused || issue === 'unavailable') && <ActionButton appearance="secondary" style={{ marginTop: 8, width: '100%' }} onClick={() => { setReviewIssue(null); textReview.retry(); }}>{t('export.review.retry')}</ActionButton>}
                {issue && !attribution.locked && <ActionButton appearance="secondary" disabled={textlessExportDisabled} style={{ marginTop: 8, width: '100%' }} onClick={() => void handleExport(true)}>{t('export.review.without_text')}</ActionButton>}
              </div>
            </Expand>
          </div>
          {deliveries ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14, flex: 'none' }}>
              {deliveries.map((delivery) => <ActionButton key={delivery.id} appearance="primary" onClick={() => void handleExport(false, delivery)} disabled={exportDisabled || !delivery.available} aria-busy={exporting}>{delivery.label}</ActionButton>)}
              <ActionButton appearance="secondary" onClick={onDone}>{t('export.btn_cancel')}</ActionButton>
            </div>
          ) : (
            // A render in flight is busy, not refused, so it wears the busy cursor; the overlay is its one loader.
            <WindowFooter style={{ marginTop: 14, flex: 'none' }}
              cancel={<ActionButton appearance="secondary" onClick={onDone}>{t('export.btn_cancel')}</ActionButton>}
              primary={<ActionButton appearance="primary" onClick={() => void handleExport()} disabled={exportDisabled} aria-busy={exporting} style={exporting ? { cursor: busy } : undefined}>{t('export.btn_export')}</ActionButton>}
            />
          )}
        </div>
        <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <ExportPreview
            key={mapReview.revision} open={ready} preparing={open && mapReview.previewReady} checkingMap={mapReview.pending}
            options={previewOptions} summary={summary ?? null} codeImg={codeAsset?.canvas ?? null} codePending={code.pending}
            codeIssue={codeIssue} footerTokens={previewFooter}
          />
        </div>
      </div>
    </div>
  );
}
