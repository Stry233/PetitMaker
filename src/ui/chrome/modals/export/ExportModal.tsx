import { framerMotion } from '../../../design/motion';
import { afterPaint } from '../../../../platform/async/after-paint';
import { setMapNotes, useAttribution } from './use-attribution';
import { useMapReview } from './review/use-map-review';
import { useTextReview } from './review/use-text-review';
import { MapReviewStatus } from './review/MapReviewStatus';
import { useExportNotice } from './review/ExportNotice';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { radii, font } from '../../../design/styles';
import { skin } from '../../../design/window-skin';
import { roleFont } from '../../../design/text-weight';
import { Spinner } from '../../../primitives/Spinner';
import { ActionButton } from '../../../primitives/ActionButton';
import { WindowBody, WindowFooter } from '../../../primitives/Window';
import { useLocale, useT } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { provenanceSummaryOf } from '../../../../state/executor';
import { FALLBACK_MAP_ASPECT, RESOLUTION_WIDTHS, formatFooterDate, isImportable, type ExportOptions, type ResolutionKey } from '../../../../io/export/facts';
import { ExportControls } from './ExportControls';
import { ExportPreview } from './ExportPreview';
import { footerTokenValues } from '../../../../editor/export/preview';
import type { HostMark } from '../../../../editor/export/brand';
import {
  exportImage, exportReviewParts, openingExportOptions, previewWords, rememberExportOptions, shareMapLink, withWords,
} from '../../../../editor/export/image-export';
import { preparedExportRevision, subscribePreparedExport } from '../../../../editor/export/prepared';
import type { ReviewIssue, ReviewProgress } from '../../../../editor/review/text-review';
import { exportUnavailable, exportWords, type ExportStanding } from '../../../../editor/export/availability';
import { LEGAL } from '../../../../legal/config';
import { useShareCode } from './use-share-code';
import { Expand } from '../../../primitives/Expand';
import { REVIEW_FIELD_LABEL } from './review/review-fields';
import { VEIL } from '../../../design/tokens';
import { useSettledValue } from '../../../primitives/use-settled-value';
import { STACKED_PREVIEW_HEIGHT, useWindowColumns } from '../use-window-columns';

/** Illustrative dims for the footer editor's reference menu (the real footer is resolved at paint
 *  time from the actual composition). */
function footerDimsSample(res: ExportOptions['resolution']): string {
  if (res === 'original') return 'native';
  const w = RESOLUTION_WIDTHS[res];
  return `${w}×${Math.round(w / FALLBACK_MAP_ASPECT)}`;
}

interface ImageDelivery {
  id: string;
  label: string;
  available: boolean;
  send: (image: Blob) => Promise<void>;
}

/** A link that opens the map, which the host shares without a picture. */
interface MapLinkAction {
  label: string;
  share: () => Promise<void>;
}

/** The QR the deployment's host makes for the picture's footer at a size. */
type FooterMark = (resolution: ResolutionKey) => Promise<HostMark | null>;

/** The share-picture controls on their own, so the "save and share" window can carry them as one
 *  of its sections. Everything expensive here is gated on `open` — the provenance summary,
 *  the share-code build, the preview's captures — so a mounted-but-hidden section costs nothing.
 *  `entered` is the host shell's `useModalEntered` answer: the picture waits for the card to settle. */
export function ExportPanel(
  { open, entered, onDone, deliveries, link, mark, artStyle }: {
    open: boolean; entered: boolean; onDone: () => void; deliveries?: readonly ImageDelivery[];
    link?: MapLinkAction; mark?: FooterMark;
    /** The controls' Art style group (`ExportControls`). */
    artStyle?: ReactNode;
  },
) {
  const t = useT();
  // Gated on `open`: this selector runs on every store update, and the provenance
  // summary re-derives a full cell-taint scan per edit — a closed, always-mounted
  // modal must cost nothing while the user paints.
  const summary = useEditorStore((s) => (open ? provenanceSummaryOf(s) : undefined));
  const gridState = useEditorStore((s) => s.gridState);
  const locale = useLocale();
  // The window opens the way it was left: every choice but the map's own words is remembered.
  const [remembered, setOptions] = useState<ExportOptions>(openingExportOptions);
  // Choices prepared outside the window while this panel stands are read again as they arrive.
  const prepared = useSyncExternalStore(subscribePreparedExport, preparedExportRevision);
  const [shownPrepared, setShownPrepared] = useState(prepared);
  if (prepared !== shownPrepared) {
    setShownPrepared(prepared);
    setOptions(openingExportOptions());
  }
  // The title and description are the map's own notes, shared with the JSON export and the share code.
  useEditorStore((s) => s.gridState?.notes);
  const attribution = useAttribution(open);
  const notes = attribution.notes;
  const notesKey = JSON.stringify(notes);
  const settledNotes = useSettledValue(notes);
  // The choices with the map's words, for the words' check and the footer. The export takes the
  // choices alone and reads the words from the map; the preview takes the words once approved.
  const options = useMemo<ExportOptions>(() => withWords(remembered, settledNotes), [remembered, settledNotes]);
  const [exporting, setExporting] = useState(false);
  /** How far a tiled export has come, or null while the export is not tiled. */
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [reviewProgress, setReviewProgress] = useState<ReviewProgress | null>(null);
  const [reviewIssue, setReviewIssue] = useState<ReviewIssue | null>(null);
  /** A picture its delivery refused as too large, with the size expected to fit. */
  const [tooLarge, setTooLarge] = useState<{ fits: ResolutionKey | null; delivery: ImageDelivery } | null>(null);
  const [sharingLink, setSharingLink] = useState(false);
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
  useEffect(() => { setReviewIssue(null); setTooLarge(null); }, [options]);

  // The entrance comes first. The preview's capture, its paint and the share-code encode are all
  // synchronous main-thread work that would land inside the card's opening spring and stall it, so
  // the picture starts once the host's shell reports the card has entered (at once under reduced motion).
  const settled = open && entered;
  const mapReview = useMapReview(open, settled, true);
  useEffect(() => { cancelExport(); }, [gridState, mapReview.revision]);
  const ready = open && settled && mapReview.previewReady;

  const [composing, setComposing] = useState(false);
  useEffect(() => { if (!open) setComposing(false); }, [open]);
  const footerValues = open && gridState ? footerTokenValues(gridState, options, locale, summary ?? null) : {};
  const reviewParts = exportReviewParts(options, footerValues);
  const textReview = useTextReview(open, reviewParts, composing);
  const issue = reviewIssue ?? textReview.issue;
  // The picture's words are checked as it exports; without them, nothing of the words holds it.
  const standing: ExportStanding = {
    exporting, composing, map: { pending: mapReview.pending, blocked: mapReview.result?.status === 'blocked' },
    words: exportWords(issue, textReview.allowed),
  };
  const textlessExportDisabled = attribution.locked || exportUnavailable({ ...standing, composing: false, words: 'approved' }, true);
  const exportDisabled = exportUnavailable(standing, true);

  // The player's own preview shows words the check approved or that wait for the check the export runs;
  // a Lite build without the check uses the manual export acknowledgement.
  const shownWords = previewWords(settledNotes, textReview.ready, composing);
  const previewFooter = useSettledValue({ ...footerValues, title: shownWords?.title ?? '' });
  const openedWith = useRef(remembered);
  useEffect(() => { rememberExportOptions(remembered, openedWith.current); }, [remembered]);

  // The real share-code band, built async + debounced — never on the open animation frame and
  // never per keystroke, because a synchronous build is heavy enough to freeze the modal's
  // entrance. While it builds, the preview keeps its last picture (or its loading state when
  // there is none yet — no placeholder band).
  const code = useShareCode(ready, gridState ?? null, {
    summary: summary ?? null, importable: isImportable(options), resolution: options.resolution, notesKey,
  });
  const codeAsset = code.asset;
  const codeIssue = code.issue;

  // The host's footer QR, made once the picture starts and again for each size.
  const [previewMark, setPreviewMark] = useState<HostMark | null>(null);
  useEffect(() => {
    let live = true;
    if (ready && mark) void mark(options.resolution).then((made) => { if (live) setPreviewMark(made); });
    return () => { live = false; };
  }, [ready, mark, options.resolution]);

  async function handleExport(withoutText = false, delivery?: ImageDelivery, resolution?: ResolutionKey) {
    if (delivery && !delivery.available) return;
    if (exportRun.current || !open || (withoutText ? textlessExportDisabled : exportDisabled)) return;
    const controller = new AbortController();
    exportRun.current = controller;
    const { signal } = controller;
    let begun = false;
    try {
      const outcome = await exportImage(
        {
          options: resolution ? { ...remembered, resolution } : remembered, withoutText, previewCode: codeAsset,
          site: LEGAL.canonicalOrigin, ...(mark ? { mark } : {}),
        },
        {
          signal,
          checkMap: () => mapReview.check(),
          checkText: (parts) => textReview.check(parts),
          begin: () => {
            begun = true;
            setReviewIssue(null);
            setTooLarge(null);
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
      if (outcome.status === 'too-large' && delivery && !signal.aborted) setTooLarge({ fits: outcome.fits, delivery });
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

  const activeProgress = textReview.progress ?? reviewProgress;
  const [columns, bodyRef] = useWindowColumns();

  const controls = (
      <ExportControls artStyle={artStyle} options={options} setOptions={setOptions} notes={notes} setNotes={setMapNotes} titleLocked={attribution.titleLocked} descriptionLocked={attribution.descriptionLocked} summary={summary ?? null} footerSamples={footerSamples} checkingFields={textReview.pending && !exporting ? reviewParts.map((part) => part.field) : []} refusedFields={issue && typeof issue === 'object' ? issue.fields : []} reviewLabel={t('export.review.checking')} />
  );
  const composition = { onCompositionStartCapture: () => setComposing(true), onCompositionEndCapture: () => setComposing(false) };
  const settings = columns === 2
    ? <WindowBody {...composition}>{controls}</WindowBody>
    : <div {...composition}>{controls}</div>;

  const findings = (
    <>
      {!mapReview.pending && <MapReviewStatus result={mapReview.result} pending={false} onRetry={mapReview.retry} />}
      {/* Keep hover and focus inside the collapsing clip without narrowing the controls. */}
      <div style={{ margin: '0 -12px' }}>
        <Expand open={!!issue || textReview.paused}>
          <div role={issue ? "alert" : undefined} style={{ padding: 12, color: skin.ink, ...roleFont('note'), lineHeight: 1.5 }}>
            {issue === 'unavailable' ? t('export.review.unavailable') : issue === 'too-long' ? t('export.review.too_long') : issue ? t('export.review.content', { fields: issue.fields.map((field) => t(REVIEW_FIELD_LABEL[field])).join(', ') }) : ''}
            {(textReview.paused || issue === 'unavailable') && <ActionButton appearance="secondary" style={{ marginTop: 8, width: '100%' }} onClick={() => { setReviewIssue(null); textReview.retry(); }}>{t('export.review.retry')}</ActionButton>}
            {issue && !attribution.locked && <ActionButton appearance="secondary" disabled={textlessExportDisabled} style={{ marginTop: 8, width: '100%' }} onClick={() => void handleExport(true)}>{t('export.review.without_text')}</ActionButton>}
          </div>
        </Expand>
        <Expand open={!!tooLarge}>
          <div role={tooLarge ? 'alert' : undefined} style={{ padding: 12, color: skin.ink, ...roleFont('note'), lineHeight: 1.5 }}>
            {tooLarge?.fits ? t('export.too_large_fits', { size: t(`export.res_${tooLarge.fits}`) })
              : tooLarge ? t('export.too_large') : ''}
            {tooLarge?.fits && <ActionButton appearance="secondary" disabled={exportDisabled} style={{ marginTop: 8, width: '100%' }}
              onClick={() => {
                const { fits, delivery } = tooLarge;
                if (!fits) return;
                setOptions((o) => ({ ...o, resolution: fits }));
                void handleExport(false, delivery, fits);
              }}>
              {t('export.save_at', { size: t(`export.res_${tooLarge.fits}`) })}
            </ActionButton>}
          </div>
        </Expand>
      </div>
    </>
  );

  const actions = deliveries ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14, flex: 'none' }}>
      {deliveries.map((delivery) => <ActionButton key={delivery.id} appearance="primary" onClick={() => void handleExport(false, delivery)} disabled={exportDisabled || !delivery.available} aria-busy={exporting}>{delivery.label}</ActionButton>)}
      {link && <ActionButton appearance="primary" disabled={exporting || sharingLink} busy={sharingLink}
        onClick={() => {
          setSharingLink(true);
          setReviewIssue(null);
          void shareMapLink(options, link.share, (parts) => textReview.check(parts)).then((outcome) => {
            if (outcome.status === 'held') setReviewIssue(outcome.issue);
            setSharingLink(false);
          }, (error: unknown) => {
            // A refused share changed nothing, so it is only logged.
            console.error('[export] link share failed', error);
            setSharingLink(false);
          });
        }}>{link.label}</ActionButton>}
      <ActionButton appearance="secondary" onClick={onDone}>{t('export.btn_cancel')}</ActionButton>
    </div>
  ) : (
    <WindowFooter style={{ marginTop: 14, flex: 'none' }}
      cancel={<ActionButton appearance="secondary" onClick={onDone}>{t('export.btn_cancel')}</ActionButton>}
      primary={<ActionButton appearance="primary" onClick={() => void handleExport()} disabled={exportDisabled} busy={exporting}>{t('export.btn_export')}</ActionButton>}
    />
  );

  const preview = (
    <div key="preview" data-testid="export-preview" style={{ minHeight: 0, display: 'flex', flexDirection: 'column', ...(columns === 1 ? { flex: 'none', height: STACKED_PREVIEW_HEIGHT, marginBottom: 14 } : null) }}>
      <ExportPreview
        key={mapReview.revision} open={ready} preparing={open && mapReview.previewReady} checkingMap={mapReview.pending}
        options={remembered} words={shownWords} summary={summary ?? null} codeImg={codeAsset?.canvas ?? null} codePending={code.pending}
        codeIssue={codeIssue} footerTokens={previewFooter} mark={mark ? previewMark : null}
      />
    </div>
  );

  const form = (
    <div key="form" style={{ display: 'flex', flexDirection: 'column', ...(columns === 2 ? { minHeight: 0 } : { flex: 'none' }) }}>
      {settings}{findings}{columns === 2 && actions}
    </div>
  );

  // The panel's own width, which its column count does not change, decides that count.
  return (
    <div ref={bodyRef} data-testid="export-panel" data-columns={columns} style={{ position: 'relative', display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
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
            <Spinner />
            <div role="status" style={{ fontFamily: font.family, ...roleFont('label'), color: skin.ink }}>{activeProgress ? t('export.review.checking') : exportProgress !== null ? t('export.progress', { percent: Math.round(exportProgress * 100) }) : t('export.exporting')}</div>
            <ActionButton appearance="secondary" autoFocus onClick={cancelExport}>{t('export.review.cancel')}</ActionButton>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Two columns: the settings scroll above the buttons and the preview spans the column's
          full height. One column: the preview stands above the settings in the window's body and the
          buttons stay at the window's foot, so the window never scrolls as a whole. */}
      {columns === 2 ? (
        <div {...(exporting ? { inert: '' } : {})} style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 24, flex: '1 1 auto', minHeight: 0 }}>
          {form}{preview}
        </div>
      ) : (
        <WindowBody {...(exporting ? { inert: '' } : {})} contentStyle={{ display: 'flex', flexDirection: 'column' }}>
          {preview}{form}
        </WindowBody>
      )}
      {columns === 1 && <div {...(exporting ? { inert: '' } : {})} style={{ display: 'flex', flexDirection: 'column', flex: 'none' }}>{actions}</div>}
    </div>
  );
}
