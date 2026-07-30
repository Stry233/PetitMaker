import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { motion, animate, useMotionValue, useTransform, useReducedMotionConfig } from 'framer-motion';
import { colors, font, modalTitle, radii, buttonMotion, footerPrimary, footerGhost, inkTint, cursors } from '../../styles';
import { useT, translate } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import type { GridState, MapNotes } from '../../../core/model/types';
import { serializeWithSections, sectionSizes, type ExportJsonOptions, type SectionSizes, type SessionSection } from '../../../io/export-json';
import { downloadJSON } from '../../../io/image-export';
import { petitWindow } from '../../../core/runtime/window-bridge';
import { ModalShell } from '../ModalShell';
import { Expand } from './Expand';
import { Switch } from '../Switch';
import { SegmentedControl } from '../SegmentedControl';
import { HelpBubble } from './HelpBubble';
import { Spinner } from '../../Spinner';
import { LoadingDots } from '../../menu/LoadingDots';
import { showToast } from '../Toast';
import { useCursorCss } from '../../cursors/cursor-vars';

const enc = new TextEncoder();
/** Cheap live byte size of the (tiny) notes object — computed on keystroke without touching the
 *  potentially-huge history, so typing never triggers the heavy per-section pass. Measured in the
 *  active format so it tracks the Pretty-print toggle like every other section. */
function notesByteLen(n: MapNotes | undefined, pretty: boolean): number {
  return n && (n.title || n.description || n.author) ? enc.encode(JSON.stringify(n, null, pretty ? 2 : undefined)).length : 0;
}

type HistoryDepthKey = 'all' | 'last100';

const EMPTY_NOTES: MapNotes = { title: '', description: '', author: '' };


/** Human-friendly byte size: B under 1 KB, KB under 1 MB, else MB (one decimal above B). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Muted directional tints — a hint of colour, not a flash: soft sage when the total grows,
// warm clay when it shrinks. Kept close to the base ink so the cue reads as a gentle glow.
const SIZE_UP = '#5FA046';
const SIZE_DOWN = '#CE9145';
// easeOutExpo — a decisive start that eases into a long, soft settle. The whole point of the
// "crafted" feel: the digits move quickly off the old value, then glide to rest.
const ROLL_EASE = [0.16, 1, 0.3, 1] as const;

/** The live total-size readout with a directional count animation: the digits roll from the
 *  previous value to the new one on an easeOutExpo curve, the colour eases up to a muted tint
 *  and back (green up / clay down), and the value glides a couple of px in the direction of
 *  change. Fully static under reduced motion — the value just snaps, honoring the app's
 *  Settings → Motion toggle (not only the OS setting). */
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

  const tint = dir === 1 ? SIZE_UP : dir === -1 ? SIZE_DOWN : colors.textSecondary;
  return (
    <span style={{ fontSize: 12.5, fontWeight: 800, color: colors.textSecondary, display: 'inline-flex', gap: 4, alignItems: 'baseline' }}>
      <span>{label}:</span>
      <motion.span
        // Colour eases INTO the tint (quick, ~30% of the curve) then drifts back over the rest,
        // so there is no hard first-frame flash. The glide is a subtle 3px in the change direction.
        animate={reduced ? {} : {
          color: dir === 0 ? colors.textSecondary : [colors.textSecondary, tint, colors.textSecondary],
          y: [dir === 1 ? 3 : dir === -1 ? -3 : 0, 0],
        }}
        transition={{
          color: { duration: 0.7, ease: 'easeInOut', times: [0, 0.3, 1] },
          y: { duration: 0.6, ease: ROLL_EASE },
        }}
        style={{ color: colors.textSecondary, fontVariantNumeric: 'tabular-nums', display: 'inline-block' }}
      >
        {bytes == null ? '…' : text}
      </motion.span>
    </span>
  );
}

function buildSession(state: GridState): SessionSection {
  return { v: 1, lockedLayers: [...state.lockedLayers], camera: petitWindow().__petitGetCamera?.() };
}

/** Trims blank fields out of the notes object typed in the modal; undefined when nothing typed. */
function trimNotes(n: MapNotes): MapNotes | undefined {
  const out: MapNotes = {};
  if (n.title?.trim()) out.title = n.title;
  if (n.description?.trim()) out.description = n.description;
  if (n.author?.trim()) out.author = n.author;
  return out.title || out.description || out.author ? out : undefined;
}

const rowLabel: CSSProperties = { fontSize: 14, fontWeight: 700, color: colors.frameDark };
const rowDesc: CSSProperties = { fontSize: 12, fontWeight: 600, color: colors.textSecondary, lineHeight: 1.35 };
const chipStyle: CSSProperties = { fontFamily: font.family, fontSize: 11.5, fontWeight: 800, color: colors.textSecondary, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const inputStyle: CSSProperties = { fontFamily: font.family, fontSize: 13, fontWeight: 600, color: colors.frameDark, background: colors.surfacePrimary, border: `1.5px solid ${colors.inkBorder}`, borderRadius: radii.md, padding: '8px 10px', resize: 'none', outline: 'none', width: '100%', boxSizing: 'border-box' };
const fieldCaption: CSSProperties = { fontSize: 11.5, fontWeight: 800, color: colors.textSecondary, marginBottom: 3, display: 'block' };
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

export function ExportJsonModal() {
  const t = useT();
  const busy = useCursorCss('busy');
  const open = useEditorStore((s) => s.exportJsonModalOpen);
  const close = useEditorStore((s) => s.setExportJsonModalOpen);
  const gridState = useEditorStore((s) => s.gridState);
  const commandExecutor = useEditorStore((s) => s.commandExecutor);

  const generationAvailable = !!gridState?.generation;
  const provenanceAvailable = !!gridState?.provenance;

  const [notesOn, setNotesOn] = useState(false);
  const [notesVal, setNotesVal] = useState<MapNotes>(EMPTY_NOTES);
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

  // Reset to defaults every time the modal opens (matches the ExportModal's per-open reset
  // pattern) — generation/provenance default ON only when the map actually has them.
  useEffect(() => {
    if (!open) return;
    setNotesOn(false);
    setNotesVal(EMPTY_NOTES);
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
      setSizes(sectionSizes(gridState, maximal, { withTotal: false }));
      setSizesPretty(sectionSizes(gridState, maximal, { withTotal: false, pretty: true }));
      setHistoryCount(entries.length);
      setComputing(false);
    }, 0);
    return () => { alive = false; clearTimeout(id); };
  }, [open, gridState, commandExecutor, historyDepthKey]);

  // Notes size is tiny and changes on every keystroke — compute it live, off the heavy path,
  // in the active format so it tracks Pretty-print too.
  const notesBytes = useMemo(() => (notesOn ? notesByteLen(trimNotes(notesVal), pretty) : 0), [notesOn, notesVal, pretty]);

  // Live total = sum of the currently-included sections, using the compact OR pretty measurements
  // per the Pretty-print toggle. Pure arithmetic, so every toggle (including Pretty-print) updates
  // instantly with no re-serialization. An estimate (per-section bytes; the real file adds a little
  // outer framing) — the exact bytes land in the downloaded file.
  const total = useMemo(() => {
    const s = pretty ? sizesPretty : sizes;
    if (!s) return null;
    return s.core + s.manifest + notesBytes
      + (generationOn && generationAvailable ? s.generation : 0)
      + (provenanceOn && provenanceAvailable ? s.provenance : 0)
      + (historyOn ? s.history : 0)
      + (sessionOn ? s.session : 0)
      + (statsOn ? s.stats : 0)
      + (catalogOn ? s.catalogInfo : 0);
  }, [pretty, sizes, sizesPretty, notesBytes, generationOn, generationAvailable, provenanceOn, provenanceAvailable, historyOn, sessionOn, statsOn, catalogOn]);

  // Per-row chips reflect the same active format as the total, so Pretty-print moves both together.
  const shown = pretty ? sizesPretty : sizes;

  function handleExportClick() {
    if (exporting) return;
    const state = useEditorStore.getState().gridState;
    const executor = useEditorStore.getState().commandExecutor;
    if (!state || !executor) return;
    // The final serialize (with a large history + integrity CRC) can block briefly. Flip the
    // button to a spinner, yield one frame so it paints, THEN serialize — so the click never
    // looks frozen.
    setExporting(true);
    setTimeout(() => {
      try {
        // Notes are written into the shared GridState object at export time only (so autosave
        // keeps them going forward) — never per keystroke.
        if (notesOn) state.notes = trimNotes(notesVal);

        const depth: 'all' | number = historyDepthKey === 'all' ? 'all' : 100;
        const opts: ExportJsonOptions = {
          notes: notesOn ? (state.notes ?? null) : null,
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
        showToast(translate('toast.exported_json'), 'info');
        setExporting(false);
        close(false);
      } catch (e) {
        showToast(translate('toast.export_failed', { detail: e instanceof Error ? e.message : translate('error.unknown') }), 'error');
        setExporting(false);
      }
    }, 0);
  }

  const setNoteField = (k: keyof MapNotes) => (v: string) => setNotesVal((n) => ({ ...n, [k]: v }));

  return (
    <ModalShell open={open} onClose={() => close(false)} width={540} maxVwPct={94} height={660} maxVhPct={90} cardStyle={{ padding: '24px 26px 20px', display: 'flex', flexDirection: 'column', minHeight: 0 }} ariaLabel={t('exportjson.title')}>
      <div style={{ ...modalTitle, marginBottom: 16, flex: '0 0 auto' }}>{t('exportjson.title')}</div>

      {/* The section toggles scroll; the pretty-print + button rows below the
          separator are flex:none so they always pin to the bottom of the card,
          even when a large UI scale would otherwise push them off-screen. */}
      {/* scrollbar-gutter: stable always reserves the scrollbar track, so rows
          don't jump sideways the moment expanding a sub-panel makes the list
          overflow (the scrollbar appears into reserved space, not into content). */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden', scrollbarGutter: 'stable', paddingRight: 4 }}>
        <SectionRow
          name={t('exportjson.core')}
          desc={t('exportjson.core_desc')}
          checked
          disabled
          onToggle={() => {}}
          bytes={shown?.core}
        />

        {/* Row + its expand panel are ONE flex child so the container's 14px gap
            never wraps the collapsible — a gap around it would appear/vanish in a
            single frame on toggle (the "space jump at the last frame"). The
            panel's own top padding gives the row→fields separation instead. */}
        <div>
        <SectionRow
          name={t('exportjson.notes')}
          desc={t('exportjson.notes_desc')}
          checked={notesOn}
          onToggle={() => setNotesOn((v) => !v)}
          bytes={shown ? notesBytes : undefined}
        />
        <Expand open={notesOn}>
          {/* The global :focus-visible ring is `outline: 3px` + `outline-offset: 2px` = ~5px
              reach beyond each input. Pad the container by MORE than that on every side so the
              ring stays inside this overflow:hidden expand wrapper instead of being clipped. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '8px 8px 2px' }}>
            <label style={fieldWrap}>
              <span style={fieldCaption}>{t('export.field_title')}</span>
              <input value={notesVal.title ?? ''} maxLength={80} onChange={(e) => setNoteField('title')(e.target.value)} style={inputStyle} placeholder={t('export.optional')} />
            </label>
            <label style={fieldWrap}>
              <span style={fieldCaption}>{t('export.field_desc')}</span>
              <textarea value={notesVal.description ?? ''} maxLength={400} onChange={(e) => setNoteField('description')(e.target.value)} style={{ ...inputStyle, minHeight: 44 }} placeholder={t('export.optional')} />
            </label>
            <label style={fieldWrap}>
              <span style={fieldCaption}>{t('exportjson.author')}</span>
              <input value={notesVal.author ?? ''} maxLength={80} onChange={(e) => setNoteField('author')(e.target.value)} style={inputStyle} placeholder={t('export.optional')} />
            </label>
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
              fontSize={12}
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

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 16, paddingTop: 12, borderTop: `1.5px solid ${inkTint(0.1)}`, flex: '0 0 auto' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: colors.frameDark }}>{t('exportjson.pretty')}</span>
          <HelpBubble text={t('exportjson.pretty_help')} />
        </span>
        <Switch on={pretty} onClick={() => setPretty((v) => !v)} label={t('exportjson.pretty')} />
        <span style={{ flex: 1 }} />
        {computing || total == null
          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: colors.textSecondary }}>{t('exportjson.total')}:</span>
              <Spinner size={13} />
            </span>
          : <AnimatedTotal bytes={total} label={t('exportjson.total')} />}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 14, flex: '0 0 auto' }}>
        <motion.button style={{ ...footerPrimary, opacity: exporting ? 0.85 : 1, cursor: exporting ? busy : cursors.clickable }} onClick={handleExportClick} disabled={exporting} {...(exporting ? {} : buttonMotion)} aria-busy={exporting}>
          {exporting ? <span style={{ display: 'inline-flex', height: 15, alignItems: 'center' }}><LoadingDots color={colors.panelCream} /></span> : t('exportjson.btn_export')}
        </motion.button>
        <motion.button style={footerGhost} onClick={() => close(false)} {...buttonMotion}>{t('exportjson.btn_cancel')}</motion.button>
      </div>
    </ModalShell>
  );
}
