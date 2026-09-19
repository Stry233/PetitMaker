import { useAttribution } from './use-attribution';
import { useMapReview } from './review/use-map-review';
import { MapReviewStatus } from './review/MapReviewStatus';
import { useExportNotice } from './review/ExportNotice';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { motion, animate, useMotionValue, useTransform, useReducedMotionConfig } from 'framer-motion';
import { font, radii, buttonMotion, cursors } from '../../../design/styles';
import { skin, windowCard, windowFooterGhost, windowFooterPrimary, windowTitle } from '../../../design/window-skin';
import { roleFont } from '../../../design/text-weight';
import { useT, translate } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { clampNotes, NOTE_LIMITS } from '../../../../core/model/notes';
import type { GridState, MapNotes } from '../../../../core/model/types';
import { serializeWithSections, sectionSizeFormats, type ExportJsonOptions, type SectionSizes, type SessionSection } from '../../../../io/export-json';
import { downloadJSON } from '../../../../io/image-export';
import { host } from '../../../../kit/host';
import { ModalShell } from '../../../primitives/ModalShell';
import { Expand } from '../../../primitives/Expand';
import { Switch } from '../../../primitives/Switch';
import { SegmentedControl } from '../../../primitives/SegmentedControl';
import { HelpBubble } from './HelpBubble';
import { ReviewIndicator } from './review/ReviewIndicator';
import { useTextReview } from './review/use-text-review';
import { needsTextReview, type TextPart } from '../../../../io/moderation/text/policy';
import { Spinner } from '../../../primitives/Spinner';
import { LoadingDots } from '../../../primitives/LoadingDots';
import { useScrollFade } from '../../../primitives/scroll-fade';
import { showToast } from '../../floating/Toast';
import { useCursorCss } from '../../../design/cursors/cursor-vars';

const enc = new TextEncoder();
/** Measure notes separately so typing does not serialize the history. */
function notesByteLen(n: MapNotes | undefined, pretty: boolean): number {
  return n ? enc.encode(JSON.stringify(n, null, pretty ? 2 : undefined)).length : 0;
}

type HistoryDepthKey = 'all' | 'last100';


/** Human-friendly byte size: B under 1 KB, KB under 1 MB, else MB (one decimal above B). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Directional size feedback uses green for increases and amber for decreases.
const SIZE_UP = '#5FA046';
const SIZE_DOWN = '#CE9145';
// easeOutExpo.
const ROLL_EASE = [0.16, 1, 0.3, 1] as const;

/** Size changes animate direction and magnitude; reduced motion updates immediately. */
function AnimatedTotal({ bytes, label }: { bytes: number | null; label: string }) {
  const reduced = useReducedMotionConfig();
  const value = useMotionValue(bytes ?? 0);
  const prev = useRef<number | null>(bytes);
  const [dir, setDir] = useState<-1 | 0 | 1>(0);
  const text = useTransform(value, (v) => formatBytes(Math.max(0, Math.round(v))));

  useEffect(() => {
    if (bytes == null) return;
    const from = prev.current;
    prev.current = bytes;
    if (from == null || reduced) { value.set(bytes); setDir(0); return; }
    if (bytes === from) return;
    setDir(bytes > from ? 1 : -1);
    const controls = animate(value, bytes, { duration: 0.6, ease: ROLL_EASE });
    const clear = setTimeout(() => setDir(0), 720);
    return () => { controls.stop(); clearTimeout(clear); };
  }, [bytes, reduced, value]);

  const tint = dir === 1 ? SIZE_UP : dir === -1 ? SIZE_DOWN : skin.plateInk;
  return (
    <span style={{ ...roleFont('small'), color: skin.plateInk, display: 'inline-flex', gap: 4, alignItems: 'baseline' }}>
      <span>{label}:</span>
      <motion.span
        // Colour eases INTO the tint (quick, ~30% of the curve) then drifts back over the rest,
        // so there is no hard first-frame flash. The glide is a subtle 3px in the change direction.
        animate={reduced ? {} : {
          color: dir === 0 ? skin.plateInk : [skin.plateInk, tint, skin.plateInk],
          y: [dir === 1 ? 3 : dir === -1 ? -3 : 0, 0],
        }}
        transition={{
          color: { duration: 0.7, ease: 'easeInOut', times: [0, 0.3, 1] },
          y: { duration: 0.6, ease: ROLL_EASE },
        }}
        style={{ color: skin.plateInk, fontVariantNumeric: 'tabular-nums', display: 'inline-block' }}
      >
        {bytes == null ? '…' : text}
      </motion.span>
    </span>
  );
}

function buildSession(state: GridState): SessionSection {
  return { v: 1, lockedLayers: [...state.lockedLayers], camera: host.camera.get2d() };
}

const rowLabel: CSSProperties = { ...roleFont('label'), color: skin.ink };
const rowDesc: CSSProperties = { ...roleFont('caption'), color: skin.plateInk, opacity: 0.8, lineHeight: 1.35 };
const chipStyle: CSSProperties = { fontFamily: font.family, ...roleFont('small'), color: skin.plateInk, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const inputStyle: CSSProperties = { fontFamily: font.family, ...roleFont('field'), color: skin.ink, background: skin.inset, border: `1.5px solid ${skin.line}`, borderRadius: radii.md, padding: '8px 34px 8px 10px', display: 'block', resize: 'none', outline: 'none', width: '100%', boxSizing: 'border-box' };
const fieldCaption: CSSProperties = { ...roleFont('caption'), color: skin.plateInk, marginBottom: 3, display: 'block' };
const fieldWrap: CSSProperties = { display: 'block' };

function SectionRow({ name, desc, hint, checked, disabled, onToggle, bytes }: {
  name: string;
  desc: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  bytes?: number;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '2px 0' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={rowLabel}>{name}</span>
        <span style={rowDesc}>{disabled && hint ? hint : desc}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
        {bytes != null && <span style={chipStyle}>{formatBytes(bytes)}</span>}
        <Switch on={checked} onClick={onToggle} label={name} disabled={disabled} />
      </div>
    </div>
  );
}

/** Shared JSON export panel. Expensive section measurement runs only while open. */
export function ExportJsonPanel({ open, onDone }: { open: boolean; onDone: () => void }) {
  const t = useT();
  const busy = useCursorCss('busy');
  const gridState = useEditorStore((s) => s.gridState);
  const commandExecutor = useEditorStore((s) => s.commandExecutor);

  const generationAvailable = !!gridState?.generation;
  const provenanceAvailable = !!gridState?.provenance;

  const [annotationsOn, setAnnotationsOn] = useState(true);
  const [notesChosen, setNotesOn] = useState(false);
  const attribution = useAttribution(open);
  const notesOn = notesChosen || attribution.locked;
  // The title and description are the map's own, shared with the image export and the share code.
  useEditorStore((s) => s.notesEpoch);
  const setMapNotes = useEditorStore((s) => s.setMapNotes);
  const notesVal: MapNotes = attribution.notes;
  const notesKey = JSON.stringify(notesVal);
  const fileNotes = useMemo(() => clampNotes(notesVal), [notesKey]); // eslint-disable-line react-hooks/exhaustive-deps -- content key
  const [generationOn, setGenerationOn] = useState(false);
  const [provenanceOn, setProvenanceOn] = useState(false);
  const [historyOn, setHistoryOn] = useState(false);
  const [historyDepthKey, setHistoryDepthKey] = useState<HistoryDepthKey>('all');
  const [sessionOn, setSessionOn] = useState(false);
  const [statsOn, setStatsOn] = useState(false);
  const [catalogOn, setCatalogOn] = useState(false);
  const [pretty, setPretty] = useState(false);

  const [sizes, setSizes] = useState<SectionSizes | null>(null);
  const [sizesPretty, setSizesPretty] = useState<SectionSizes | null>(null);
  const [historyCount, setHistoryCount] = useState(0);
  const [computing, setComputing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [composing, setComposing] = useState(false);
  const exportTimer = useRef<ReturnType<typeof setTimeout>>();
  const exportRevision = useRef(0);
  const reviewParts = useMemo<TextPart[]>(() => notesOn
    ? (['title', 'description'] as const).map(field => ({ field, text: notesVal[field] ?? '' })).filter(part => needsTextReview(part.text))
    : [], [notesOn, notesKey]); // eslint-disable-line react-hooks/exhaustive-deps -- content key
  const textReview = useTextReview(open, reviewParts, notesOn && composing);
  const issue = textReview.issue;
  const refusedFields = issue && typeof issue === 'object' ? issue.fields : [];
  const checking = (field: keyof MapNotes) => textReview.pending && reviewParts.some(part => part.field === field);
  const mapReview = useMapReview(open, false, false, annotationsOn);
  const exportDisabled = exporting || mapReview.pending || !textReview.allowed || mapReview.result?.status === 'blocked';
  const noticeRevision = JSON.stringify([annotationsOn, notesOn, notesVal, composing, generationOn, provenanceOn, historyOn, historyDepthKey, sessionOn, statsOn, catalogOn, pretty]);
  const notice = useExportNotice(open, noticeRevision, gridState, 'json');

  useEffect(() => {
    exportRevision.current++;
    setExporting(false);
    return () => { exportRevision.current++; clearTimeout(exportTimer.current); };
  }, [open, noticeRevision, gridState, mapReview.revision]);

  const sectionsRef = useRef<HTMLDivElement>(null);
  const sectionsFade = useScrollFade(sectionsRef, 'y');

  // Generation and provenance default on only when the map contains them.
  useEffect(() => {
    if (!open) return;
    setAnnotationsOn(true);
    setNotesOn(false);
    setComposing(false);
    setGenerationOn(generationAvailable);
    setProvenanceOn(provenanceAvailable);
    setHistoryOn(false);
    setHistoryDepthKey('all');
    setSessionOn(false);
    setStatsOn(false);
    setCatalogOn(false);
    setPretty(false);
    setSizes(null);
    setSizesPretty(null);
    setHistoryCount(0);
    setExporting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Per-section sizes are computed ONCE per open (and when the history-depth choice changes),
  // NOT per toggle: for a large undo history the serialization is heavy, and doing it on every
  // switch froze the modal. `withTotal:false` skips the full-file re-serialize. We yield first
  // (setComputing → paint the loader) so the block never freezes the UI without feedback, then
  // read the (possibly huge) entries and measure. Toggles below derive the total by summation.
  useEffect(() => {
    if (!open || !gridState || !commandExecutor) { setSizes(null); setSizesPretty(null); return; }
    setComputing(true);
    setSizes(null);
    setSizesPretty(null);
    let alive = true;
    const id = setTimeout(() => {
      if (!alive) return;
      const entries = commandExecutor.getUndoEntries();
      const depth: 'all' | number = historyDepthKey === 'all' ? 'all' : 100;
      const maximal: ExportJsonOptions = {
        notes: null,               // notes are measured live (notesByteLen); ignore here
        includeGeneration: true,
        includeProvenance: true,
        history: { entries, depth },
        session: buildSession(gridState),
        includeStats: true,
        includeCatalogInfo: true,
        pretty: false,
      };
      // Measure each section in BOTH formats once, so the live total can track the Pretty-print
      // toggle by summing the matching set — no per-toggle re-serialize, which would freeze the modal.
      const measured = sectionSizeFormats(gridState, maximal);
      setSizes(measured.compact);
      setSizesPretty(measured.pretty);
      setHistoryCount(entries.length);
      setComputing(false);
    }, 0);
    return () => { alive = false; clearTimeout(id); };
  }, [open, gridState, commandExecutor, historyDepthKey]);

  // Notes size is tiny and changes on every keystroke — compute it live, off the heavy path,
  // in the active format so it tracks Pretty-print too.
  const notesBytes = useMemo(() => (notesOn ? notesByteLen(fileNotes, pretty) : 0), [notesOn, fileNotes, pretty]);

  // Live total = sum of the currently-included sections, using the compact OR pretty measurements
  // per the Pretty-print toggle. Pure arithmetic, so every toggle (including Pretty-print) updates
  // instantly with no re-serialization. An estimate (per-section bytes; the real file adds a little
  // outer framing) — the exact bytes land in the downloaded file.
  const total = useMemo(() => {
    const s = pretty ? sizesPretty : sizes;
    if (!s) return null;
    return s.core + s.manifest + notesBytes
      + (annotationsOn ? s.annotations : 0)
      + (generationOn && generationAvailable ? s.generation : 0)
      + (provenanceOn && provenanceAvailable ? s.provenance : 0)
      + (historyOn ? s.history : 0)
      + (sessionOn ? s.session : 0)
      + (statsOn ? s.stats : 0)
      + (catalogOn ? s.catalogInfo : 0);
  }, [pretty, sizes, sizesPretty, notesBytes, annotationsOn, generationOn, generationAvailable, provenanceOn, provenanceAvailable, historyOn, sessionOn, statsOn, catalogOn]);

  // Per-row chips reflect the same active format as the total, so Pretty-print moves both together.
  const shown = pretty ? sizesPretty : sizes;

  async function handleExportClick() {
    if (!open || exportDisabled) return;
    const revision = exportRevision.current;
    const mapCheck = mapReview.check().catch(() => null);
    if (!await notice.request() || revision !== exportRevision.current) { mapReview.cancel(); return; }
    const mapResult = await mapCheck;
    if (!mapResult || mapResult.status === 'blocked' || revision !== exportRevision.current) return;
    const state = useEditorStore.getState().gridState;
    const executor = useEditorStore.getState().commandExecutor;
    if (!state || !executor) return;
    // Let the busy state paint before serializing a potentially large history.
    setExporting(true);
    const selectedNotes = notesOn ? fileNotes : undefined;
    exportTimer.current = setTimeout(() => {
      try {
        if (revision !== exportRevision.current) return;
        const depth: 'all' | number = historyDepthKey === 'all' ? 'all' : 100;
        const opts: ExportJsonOptions = {
          notes: selectedNotes ?? null,
          includeAnnotations: annotationsOn,
          includeGeneration: generationOn && generationAvailable,
          includeProvenance: provenanceOn && provenanceAvailable,
          history: historyOn ? { entries: executor.getUndoEntries(), depth } : null,
          session: sessionOn ? buildSession(state) : null,
          includeStats: statsOn,
          includeCatalogInfo: catalogOn,
          pretty,
        };

        const json = serializeWithSections(state, opts);
        downloadJSON(json, `petit-planet-${state.template.id}-${Date.now()}.json`);
        useEditorStore.getState().markExported();   // this map has now left the browser
        showToast(translate('toast.exported_json'), 'info');
        setExporting(false);
        onDone();
      } catch (e) {
        showToast(translate('toast.export_failed', { detail: e instanceof Error ? e.message : translate('error.unknown') }), 'error');
        setExporting(false);
      }
    }, 0);
  }

  const setNoteField = (k: keyof MapNotes) => (v: string) => setMapNotes({ ...notesVal, [k]: v });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
      {notice.notice}
      {/* The section toggles scroll; the pretty-print + button rows below the
          separator are flex:none so they always pin to the bottom of the card,
          even when a large UI scale would otherwise push them off-screen. */}
      {/* scrollbar-gutter: stable always reserves the scrollbar track, so rows
          don't jump sideways the moment expanding a sub-panel makes the list
          overflow (the scrollbar appears into reserved space, not into content). */}
      <div ref={sectionsRef} style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden', scrollbarGutter: 'stable', paddingRight: 4, ...sectionsFade }}>
        <SectionRow
          name={t('exportjson.core')}
          desc={t('exportjson.core_desc')}
          checked
          disabled
          onToggle={() => {}}
          bytes={shown?.core}
        />

        <SectionRow
          name={t('exportjson.annotations')}
          desc={t('exportjson.annotations_desc')}
          checked={annotationsOn}
          onToggle={() => setAnnotationsOn((value) => !value)}
          bytes={shown?.annotations}
        />

        {/* Keep the expandable fields in the row's flex item so collapsed content adds no gap. */}
        <div>
        <SectionRow
          name={t('exportjson.notes')}
          desc={t('exportjson.notes_desc')}
          checked={notesOn}
          disabled={attribution.locked}
          onToggle={() => { setNotesOn((v) => !v); setComposing(false); }}
          bytes={shown ? notesBytes : undefined}
        />
        <Expand open={notesOn}>
          {/* Padding contains the five-pixel focus ring inside the expand clip. */}
          <div onCompositionStartCapture={() => setComposing(true)} onCompositionEndCapture={() => setComposing(false)} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '8px 8px 2px' }}>
            <div style={fieldWrap}>
              <span style={fieldCaption}>{t('export.field_title')} {attribution.titleLocked && <HelpBubble text={t('export.attribution_locked')} />}</span>
              <span style={{ display: 'block', position: 'relative' }}>
                <input disabled={attribution.titleLocked} value={notesVal.title ?? ''} maxLength={NOTE_LIMITS.title} onChange={(e) => setNoteField('title')(e.target.value)} style={{ ...inputStyle, opacity: attribution.titleLocked ? 0.65 : 1 }} placeholder={t('export.optional')} aria-label={t('export.field_title')} aria-busy={checking('title')} aria-invalid={refusedFields.includes('title')} />
                {checking('title') && <ReviewIndicator label={t('export.review.checking')} />}
              </span>
            </div>
            <div style={fieldWrap}>
              <span style={fieldCaption}>{t('export.field_desc')} {attribution.descriptionLocked && <HelpBubble text={t('export.attribution_locked')} />}</span>
              <span style={{ display: 'block', position: 'relative' }}>
                <textarea disabled={attribution.descriptionLocked} value={notesVal.description ?? ''} maxLength={NOTE_LIMITS.description} onChange={(e) => setNoteField('description')(e.target.value)} style={{ ...inputStyle, minHeight: 44, opacity: attribution.descriptionLocked ? 0.65 : 1 }} placeholder={t('export.optional')} aria-label={t('export.field_desc')} aria-busy={checking('description')} aria-invalid={refusedFields.includes('description')} />
                {checking('description') && <ReviewIndicator label={t('export.review.checking')} />}
              </span>
            </div>
            {issue && <div role="alert" style={rowDesc}>
              {issue === 'unavailable' ? t('export.review.unavailable') : issue === 'too-long' ? t('export.review.too_long') : t('export.review.content', { fields: issue.fields.map(field => t(field === 'title' ? 'export.field_title' : field === 'description' ? 'export.field_desc' : 'exportjson.author')).join(', ') })}
              {issue === 'unavailable' && <button type="button" onClick={textReview.retry} style={{ ...windowFooterGhost, marginTop: 8 }}>{t('export.review.retry')}</button>}
            </div>}
          </div>
        </Expand>
        </div>

        <SectionRow
          name={t('exportjson.generation')}
          desc={t('exportjson.generation_desc')}
          hint={t('exportjson.no_generation')}
          checked={generationOn && generationAvailable}
          disabled={!generationAvailable}
          onToggle={() => setGenerationOn((v) => !v)}
          bytes={shown?.generation}
        />

        <SectionRow
          name={t('exportjson.provenance')}
          desc={t('exportjson.provenance_desc')}
          hint={t('exportjson.no_provenance')}
          checked={provenanceOn && provenanceAvailable}
          disabled={!provenanceAvailable}
          onToggle={() => setProvenanceOn((v) => !v)}
          bytes={shown?.provenance}
        />

        <div>
        <SectionRow
          name={t('exportjson.history')}
          desc={t('exportjson.history_desc')}
          checked={historyOn}
          onToggle={() => setHistoryOn((v) => !v)}
          bytes={shown?.history}
        />
        <Expand open={historyOn}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0 4px' }}>
            <SegmentedControl<HistoryDepthKey>
              idPrefix="history-depth"
              value={historyDepthKey}
              options={['all', 'last100']}
              render={(k) => (k === 'all' ? t('exportjson.depth_all') : t('exportjson.depth_last'))}
              onChange={setHistoryDepthKey}
            />
            <span style={rowDesc}>{t('exportjson.steps', { n: historyCount })}</span>
          </div>
        </Expand>
        </div>

        <SectionRow
          name={t('exportjson.session')}
          desc={t('exportjson.session_desc')}
          checked={sessionOn}
          onToggle={() => setSessionOn((v) => !v)}
          bytes={shown?.session}
        />

        <SectionRow
          name={t('exportjson.stats')}
          desc={t('exportjson.stats_desc')}
          checked={statsOn}
          onToggle={() => setStatsOn((v) => !v)}
          bytes={shown?.stats}
        />

        <SectionRow
          name={t('exportjson.catalog')}
          desc={t('exportjson.catalog_desc')}
          checked={catalogOn}
          onToggle={() => setCatalogOn((v) => !v)}
          bytes={shown?.catalogInfo}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 16, paddingTop: 12, borderTop: `1.5px solid ${skin.line}`, flex: '0 0 auto' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ ...roleFont('caption'), color: skin.ink }}>{t('exportjson.pretty')}</span>
          <HelpBubble text={t('exportjson.pretty_help')} />
        </span>
        <Switch on={pretty} onClick={() => setPretty((v) => !v)} label={t('exportjson.pretty')} />
        <span style={{ flex: 1 }} />
        {computing || total == null
          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <span style={{ ...roleFont('small'), color: skin.plateInk }}>{t('exportjson.total')}:</span>
              <Spinner size={13} />
            </span>
          : <AnimatedTotal bytes={total} label={t('exportjson.total')} />}
      </div>

      <MapReviewStatus result={mapReview.result} pending={mapReview.pending} onRetry={() => { mapReview.retry(); }} />
      <div style={{ display: 'flex', gap: 10, marginTop: 14, flex: '0 0 auto' }}>
        <motion.button style={{ ...windowFooterPrimary, opacity: exportDisabled ? 0.65 : 1, cursor: exporting ? busy : exportDisabled ? cursors.default : cursors.clickable }} onClick={handleExportClick} disabled={exportDisabled} {...(exportDisabled ? {} : buttonMotion)} aria-busy={exporting}>
          {exporting ? <span style={{ display: 'inline-flex', height: 15, alignItems: 'center' }}><LoadingDots color={skin.plate} /></span> : t('exportjson.btn_export')}
        </motion.button>
        <motion.button style={windowFooterGhost} onClick={() => { exportRevision.current++; clearTimeout(exportTimer.current); textReview.cancel(); onDone(); }} {...buttonMotion}>{t('exportjson.btn_cancel')}</motion.button>
      </div>
    </div>
  );
}

/** The save file as its own window. The shell reaches the
 *  same panel through the save-and-share window instead. */
export function ExportJsonModal() {
  const t = useT();
  const open = useEditorStore((s) => s.modals.exportJson);
  const setModal = useEditorStore((s) => s.setModal);
  const close = () => setModal('exportJson', false);
  return (
    <ModalShell helpTarget={{ page: 'json' }}
      open={open}
      onClose={close}
      width={540}
      maxVwPct={94}
      height={660}
      maxVhPct={90}
      cardStyle={{ ...windowCard, padding: '24px 26px 20px', display: 'flex', flexDirection: 'column', minHeight: 0 }}
      ariaLabel={t('exportjson.title')}
    >
      <div style={{ ...windowTitle, marginBottom: 16, flex: '0 0 auto' }}>{t('exportjson.title')}</div>
      <ExportJsonPanel open={open} onDone={close} />
    </ModalShell>
  );
}
