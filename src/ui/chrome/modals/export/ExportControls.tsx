import { helpTargetAttr } from '../help/targets';
import { useState, type CSSProperties } from 'react';
import { font, radii, cursors } from '../../../design/styles';
import { skin } from '../../../design/window-skin';
import { roleFont } from '../../../design/text-weight';
import { useT } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { hasShareCode, type ExportOptions, type ExportPreset, type ResolutionKey } from '../../../../io/export/types';
import { RESOLUTION_WIDTHS } from '../../../../io/export/compose';
import { moduleBaseFor } from '../../../../io/share/glyph/geometry';
import type { MapProvenanceSummary } from '../../../../core/provenance/types';
import type { MapNotes } from '../../../../core/model/types';
import { NOTE_LIMITS } from '../../../../core/model/notes';
import { HelpBubble } from './HelpBubble';
import { SegmentedControl } from '../../../primitives/SegmentedControl';
import { Switch } from '../../../primitives/Switch';
import { Expand } from '../../../primitives/Expand';
import { FooterEditor } from './FooterEditor';
import { Shot3dStrip } from './Shot3dStrip';
import { StylizeEntry, applyExportPreset, exportPresetDescriptions } from './edition-export';
import { IS_LITE } from '../../../../core/runtime/edition';
import type { TextField } from '../../../../io/moderation/text/policy';
import { ReviewIndicator } from './review/ReviewIndicator';

const RES_KEYS: ResolutionKey[] = ['compact', 'standard', 'high', 'original'];
const PRESETS: ExportPreset[] = ['share', 'plain'];
const hasCurrentProv = (s: MapProvenanceSummary | null) => !!s && (s.containsAi || s.containsProcedural);

/** Settings only — the modal renders the fixed footer (Cancel / Export) outside the scroll region. */
export function ExportControls({ options, setOptions, notes, setNotes, summary, footerSamples, initialOpen = false, checkingFields = [], refusedFields = [], reviewLabel = '', titleLocked = false, descriptionLocked = false }: {
  options: ExportOptions; setOptions: (o: ExportOptions) => void; summary: MapProvenanceSummary | null;
  /** The map's own title and description, shared with the JSON export and the share code. */
  notes: MapNotes; setNotes: (n: MapNotes) => void;
  /** Current value of each footer token (date/dims/name/…), shown in the footer editor's menu. */
  footerSamples: Record<string, string>;
  /** Initial expanded state for embedded previews. */
  initialOpen?: boolean;
  checkingFields?: TextField[];
  refusedFields?: TextField[];
  reviewLabel?: string;
  titleLocked?: boolean;
  descriptionLocked?: boolean;
}) {
  const t = useT();
  const [details, setDetails] = useState(initialOpen);
  const set = <K extends keyof ExportOptions>(k: K, v: ExportOptions[K]) => setOptions({ ...options, [k]: v });

  // Compact output is narrower than the share-code minimum.
  const codeDropped = hasShareCode(options) && moduleBaseFor(RESOLUTION_WIDTHS[options.resolution]) === null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Preset */}
      <div {...helpTargetAttr('share', 'share-preset')} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={capStyle}>{t('export.preset')}</div>
        <SegmentedControl wrapLabels={IS_LITE} idPrefix="preset" value={options.preset} options={PRESETS} render={(p) => t(`export.preset_${p}`)} onChange={(p) => setOptions(applyExportPreset(options, p))} />
        <div style={{ ...roleFont('caption'), color: skin.muted, lineHeight: 1.4 }}>{t(exportPresetDescriptions[options.preset])}</div>
      </div>

      {/* Title + description */}
      <Field label={t('export.field_title')} help={titleLocked ? t('export.attribution_locked') : undefined}>
        <div {...helpTargetAttr('share', 'share-header')} style={{ position: 'relative' }}>
          <input disabled={titleLocked} value={notes.title ?? ''} maxLength={NOTE_LIMITS.title} onChange={(e) => setNotes({ ...notes, title: e.target.value })} style={{ ...inputStyle, opacity: titleLocked ? 0.65 : 1 }} placeholder={t('export.optional')} aria-label={t('export.field_title')} aria-busy={checkingFields.includes('title')} aria-invalid={refusedFields.includes('title')} />
          {checkingFields.includes('title') && <ReviewIndicator label={reviewLabel} />}
        </div>
      </Field>
      <Field label={t('export.field_desc')} help={descriptionLocked ? t('export.attribution_locked') : undefined}>
        <div {...helpTargetAttr('share', 'share-header')} style={{ position: 'relative' }}>
          <textarea disabled={descriptionLocked} value={notes.description ?? ''} maxLength={NOTE_LIMITS.description} onChange={(e) => setNotes({ ...notes, description: e.target.value })} style={{ ...inputStyle, display: 'block', minHeight: 44, opacity: descriptionLocked ? 0.65 : 1 }} placeholder={t('export.optional')} aria-label={t('export.field_desc')} aria-busy={checkingFields.includes('description')} aria-invalid={refusedFields.includes('description')} />
          {checkingFields.includes('description') && <ReviewIndicator label={reviewLabel} />}
        </div>
      </Field>

      {/* Size */}
      <div {...helpTargetAttr('share', 'share-size')} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={capStyle}>{t('export.sec_size')}</div>
        <SegmentedControl wrapLabels={IS_LITE} idPrefix="size" value={options.resolution} options={RES_KEYS} render={(k) => t(`export.res_${k}`)} onChange={(k) => set('resolution', k)} />
      </div>

      <StylizeEntry />

      {/* Importability — labels + help bubbles, no paragraphs */}
      <div {...helpTargetAttr('share', 'share-glyph')} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={capStyle}>{t('export.importability')}</div>
        {/* The warning shares its row's flex item to avoid a gap while collapsed. */}
        <div>
          <Row>
            <Label text={t('export.importable')} help={t('export.importable_sub')} />
            <Switch on={options.importable} onClick={() => set('importable', !options.importable)} label={t('export.importable')} />
          </Row>
          <Expand open={codeDropped}>
            <div style={{ paddingTop: 8 }}><CodeWarn text={t('export.code_size_warn')} /></div>
          </Expand>
        </div>
      </div>

      {/* Human-only maps retain a disabled badge control with an explanation. */}
      {(() => { const can = hasCurrentProv(summary); return (
        <Row>
          <Label text={t('export.opt_badge')} help={can ? t('export.badge_help') : t('export.badge_why')} />
          <Switch on={can && options.showBadge} disabled={!can} onClick={() => set('showBadge', !options.showBadge)} label={t('export.opt_badge')} />
        </Row>
      ); })()}

      {/* Appearance — always available (the share-code band is part of the composed image, so these still apply). */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button onClick={() => setDetails((d) => !d)} style={detailsBtn}>{details ? '▾ ' : '▸ '}{t('export.appearance')}</button>
        <Expand open={details}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 2 }}>
            {/* Keep the row and expandable editor in one flex item so collapsed content adds no gap. */}
            <div>
              <Row><Label text={t('export.opt_footer')} /><Switch on={options.footer} onClick={() => set('footer', !options.footer)} label={t('export.opt_footer')} /></Row>
              <Expand open={options.footer}>
                <div style={{ paddingTop: 10 }}>
                  <FooterEditor value={options.footerTemplate} onChange={(tpl) => set('footerTemplate', tpl)} samples={footerSamples} t={t} checking={checkingFields.includes('footer')} refused={refusedFields.includes('footer')} reviewLabel={reviewLabel} />
                </div>
              </Expand>
            </div>
            <Row><span style={rowLabel}>{t('export.opt_layer')}</span><Switch on={options.layerPreview} onClick={() => set('layerPreview', !options.layerPreview)} label={t('export.opt_layer')} /></Row>
            <div>
              <Row><span style={rowLabel}>{t('export.opt_3d')}</span><Switch on={options.card3d} onClick={() => set('card3d', !options.card3d)} label={t('export.opt_3d')} /></Row>
              <Expand open={options.card3d}><div style={{ paddingTop: 10 }}><Shot3dStrip open={options.card3d} /></div></Expand>
            </div>
            <Row><span style={rowLabel}>{t('export.opt_grid')}</span><Switch on={options.grid} onClick={() => set('grid', !options.grid)} label={t('export.opt_grid')} /></Row>
            {/* Editing annotations is available independently of their inclusion in the export. */}
            <Row>
              <span style={rowLabel}>{t('annot.export_include')}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                <button {...helpTargetAttr('notes')} type="button" onClick={editAnnotations} style={editNotesBtn}>{t('annot.export_edit')}</button>
                <Switch on={options.annotations} onClick={() => set('annotations', !options.annotations)} label={t('annot.export_include')} />
              </span>
            </Row>
          </div>
        </Expand>
      </div>
    </div>
  );
}

const inputStyle: CSSProperties = { fontFamily: font.family, ...roleFont('field'), color: skin.ink, background: skin.inset, border: `1.5px solid ${skin.line}`, borderRadius: radii.md, padding: '9px 34px 9px 11px', resize: 'none', outline: 'none', width: '100%', boxSizing: 'border-box' };
const capStyle: CSSProperties = { ...roleFont('subhead'), color: skin.muted };
/** Shared warning treatment for unavailable share codes. */
export function CodeWarn({ text }: { text: string }) {
  return (
    <div style={codeWarn}>
      <svg width="15" height="15" viewBox="0 0 24 24" style={{ flex: 'none', marginTop: 1 }} aria-hidden="true">
        <path d="M12 3.2 1.8 21h20.4z" fill="none" stroke={WARN_INK} strokeWidth="2" strokeLinejoin="round" />
        <path d="M12 9.5v4.6" stroke={WARN_INK} strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="12" cy="17.7" r="1.15" fill={WARN_INK} />
      </svg>
      <span>{text}</span>
    </div>
  );
}

const WARN_INK = '#B5701F';
const codeWarn: CSSProperties = {
  display: 'flex', gap: 7, alignItems: 'flex-start', ...roleFont('caption'), lineHeight: 1.4,
  color: skin.ink, background: 'rgba(255,179,71,0.26)',
  borderRadius: radii.sm, padding: '7px 9px',
};
const detailsBtn: CSSProperties = { alignSelf: 'flex-start', background: 'transparent', border: 'none', cursor: cursors.clickable, fontFamily: font.family, ...roleFont('chip'), color: skin.muted, padding: 0 };

/** Closes export surfaces and opens the annotation tools. */
function editAnnotations(): void {
  const s = useEditorStore.getState();
  s.setModal('share', false);
  s.setModal('export', false);
  s.setModal('exportJson', false);
  const data = s.gridState?.annotations;
  if (data && !data.visible) s.setAnnotationsVisible(true);
  s.setEditMode({ mode: 'annotate' });
}

const editNotesBtn: CSSProperties = {
  background: 'transparent', border: `1.5px dashed ${skin.muted}`, borderRadius: 999,
  padding: '3px 11px', cursor: cursors.clickable, fontFamily: font.family,
  ...roleFont('caption'), color: skin.ink,
};
const rowLabel: CSSProperties = { ...roleFont('label'), color: skin.ink };

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ...roleFont('caption'), color: skin.ink }}>{label}{help && <HelpBubble text={help} />}</span>{children}</div>;
}
function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>{children}</div>;
}
function Label({ text, help }: { text: string; help?: string }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ...roleFont('label'), color: skin.ink }}>{text}{help && <HelpBubble text={help} />}</span>;
}
