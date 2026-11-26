import { CAUTION_INK, ACCENT, rgbaOf } from '../../../design/tokens';
import { ActionButton } from '../../../primitives/ActionButton';
import { helpTargetAttr } from '../../../session/help-targets';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { font, radii, cursors } from '../../../design/styles';
import { skin } from '../../../design/window-skin';
import { roleFont } from '../../../design/text-weight';
import { useT } from '../../../../i18n/context';
import { EXPORT_PRESETS, RESOLUTION_KEYS, hasProvenanceBadge, isImportable, type ExportOptions } from '../../../../io/export/facts';
import { codeFitsSize } from '../../../../editor/export/share-code';
import type { MapProvenanceSummary } from '../../../../core/provenance/types';
import type { MapNotes } from '../../../../core/model/types';
import { NOTE_LIMITS } from '../../../../core/model/notes';
import { HelpBubble } from './HelpBubble';
import { SegmentedControl } from '../../../primitives/SegmentedControl';
import { Switch } from '../../../primitives/Switch';
import { Expand } from '../../../primitives/Expand';
import { FooterEditor } from './FooterEditor';
import { Shot3dStrip } from './Shot3dStrip';
import { applyExportPreset, exportPresetDescriptions } from '../../../../editor/review/edition-review';
import { WRAPS_EXPORT_OPTION_LABELS } from '../../../../platform/build/edition';
import type { TextField as CheckedField } from '../../../../pipelines/moderation';
import { ReviewSlot } from './review/ReviewIndicator';
import { TextField } from '../../../primitives/TextField';
import { ChevronIcon, WarningIcon } from '../../../primitives/line-glyphs';
import { cssMotion } from '../../../design/motion';
import { pressCommand } from '../../../../editor/commands/run';
import { useEditorStore } from '../../../../state/store';
import { notesOpenable } from '../../../../state/slices/shell';

/** Settings only — the modal renders the fixed footer (Cancel / Export) outside the scroll region. */
export function ExportControls({ options, setOptions, notes, setNotes, summary, footerSamples, artStyle, initialOpen = false, checkingFields = [], refusedFields = [], reviewLabel = '', titleLocked = false, descriptionLocked = false }: {
  options: ExportOptions; setOptions: (o: ExportOptions) => void; summary: MapProvenanceSummary | null;
  /** The map's own title and description, shared with the JSON export and the share code. */
  notes: MapNotes; setNotes: (n: MapNotes) => void;
  /** Current value of each footer token (date/dims/name/…), shown in the footer editor's menu. */
  footerSamples: Record<string, string>;
  /** The Art style group, where the edition has an illustration studio; its surface hands it down. */
  artStyle?: ReactNode;
  /** Initial expanded state for embedded previews. */
  initialOpen?: boolean;
  checkingFields?: CheckedField[];
  refusedFields?: CheckedField[];
  reviewLabel?: string;
  titleLocked?: boolean;
  descriptionLocked?: boolean;
}) {
  const t = useT();
  const notesOpen = useEditorStore(notesOpenable);
  const [details, setDetails] = useState(initialOpen);
  const set = <K extends Exclude<keyof ExportOptions, 'preset'>>(k: K, v: ExportOptions[K]) => setOptions({ ...options, [k]: v });
  // The preset is the edition's to apply, since an edition's preset may set the picture's parts too.
  const setPreset = (preset: ExportOptions['preset']) => setOptions(applyExportPreset(options, preset));

  // Compact output is narrower than the share-code minimum.
  const codeDropped = isImportable(options) && !codeFitsSize(options.resolution);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Preset */}
      <div {...helpTargetAttr('share', 'share-preset')} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={capStyle}>{t('export.preset')}</div>
        <SegmentedControl wrapLabels={WRAPS_EXPORT_OPTION_LABELS} idPrefix="preset" value={options.preset} options={EXPORT_PRESETS} render={(p) => t(`export.preset_${p}`)} onChange={setPreset} />
        <div style={{ ...roleFont('note'), color: skin.muted, lineHeight: 1.4 }}>{t(exportPresetDescriptions[options.preset])}</div>
      </div>

      {/* Title + description */}
      <Field label={t('export.field_title')} help={titleLocked ? t('export.attribution_locked') : undefined}>
        <div {...helpTargetAttr('share', 'share-header')}>
          <TextField disabled={titleLocked} value={notes.title ?? ''} maxLength={NOTE_LIMITS.title} onChange={(title) => setNotes({ ...notes, title })}
            placeholder={t('export.optional')} label={t('export.field_title')} aria-busy={checkingFields.includes('title')} aria-invalid={refusedFields.includes('title')}
            trailing={<ReviewSlot label={reviewLabel} checking={checkingFields.includes('title')} />} />
        </div>
      </Field>
      <Field label={t('export.field_desc')} help={descriptionLocked ? t('export.attribution_locked') : undefined}>
        <div {...helpTargetAttr('share', 'share-header')}>
          <TextField rows={2} disabled={descriptionLocked} value={notes.description ?? ''} maxLength={NOTE_LIMITS.description} onChange={(description) => setNotes({ ...notes, description })}
            placeholder={t('export.optional')} label={t('export.field_desc')} aria-busy={checkingFields.includes('description')} aria-invalid={refusedFields.includes('description')}
            trailing={<ReviewSlot label={reviewLabel} checking={checkingFields.includes('description')} />} />
        </div>
      </Field>

      {/* Size */}
      <div {...helpTargetAttr('share', 'share-size')} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={capStyle}>{t('export.sec_size')}</div>
        <SegmentedControl wrapLabels={WRAPS_EXPORT_OPTION_LABELS} idPrefix="size" value={options.resolution} options={RESOLUTION_KEYS} render={(k) => t(`export.res_${k}`)} onChange={(k) => set('resolution', k)} />
      </div>

      {artStyle}

      {/* Importability — labels + help bubbles, no paragraphs */}
      <div {...helpTargetAttr('share', 'share-glyph')} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={capStyle}>{t('export.importability')}</div>
        {/* The warning shares its row's flex item to avoid a gap while collapsed. */}
        <div>
          <Row>
            <Label text={t('export.importable')} help={t('export.importable_sub')} />
            <Switch on={isImportable(options)} onClick={() => setPreset(isImportable(options) ? 'plain' : 'share')} label={t('export.importable')} />
          </Row>
          <Expand open={codeDropped}>
            <div style={{ paddingTop: 8 }}><CodeWarn text={t('export.code_size_warn')} /></div>
          </Expand>
        </div>
      </div>

      {/* Human-only maps retain a disabled badge control with an explanation. */}
      {(() => { const can = hasProvenanceBadge(summary); return (
        <Row>
          <Label text={t('export.opt_badge')} help={can ? t('export.badge_help') : t('export.badge_why')} />
          <Switch on={can && options.showBadge} disabled={!can} onClick={() => set('showBadge', !options.showBadge)} label={t('export.opt_badge')} />
        </Row>
      ); })()}

      {/* Appearance — always available (the share-code band is part of the composed image, so these still apply). */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <ActionButton interaction="quietLink" aria-expanded={details} onClick={() => setDetails((d) => !d)} style={detailsBtn}><span aria-hidden style={{ display: 'flex', transform: details ? undefined : 'rotate(-90deg)', transition: cssMotion('section.expand', ['transform']) }}><ChevronIcon size={14} /></span>{t('export.appearance')}</ActionButton>
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
                <ActionButton interaction="pill" {...helpTargetAttr('notes')} unavailable={!notesOpen} onClick={() => pressCommand('notes.edit')} style={{ ...editNotesBtn, cursor: notesOpen ? cursors.clickable : cursors.blocked }}>{t('annot.export_edit')}</ActionButton>
                <Switch on={options.annotations} onClick={() => set('annotations', !options.annotations)} label={t('annot.export_include')} />
              </span>
            </Row>
          </div>
        </Expand>
      </div>
    </div>
  );
}

const capStyle: CSSProperties = { ...roleFont('subhead'), color: skin.muted };
/** Shared warning treatment for unavailable share codes. */
export function CodeWarn({ text }: { text: string }) {
  return (
    <div style={codeWarn}>
      <span style={{ display: 'flex', flex: 'none', marginTop: 2, color: CAUTION_INK }}><WarningIcon size={15} /></span>
      <span>{text}</span>
    </div>
  );
}

const codeWarn: CSSProperties = {
  display: 'flex', gap: 6, alignItems: 'flex-start', ...roleFont('note'), lineHeight: 1.4,
  color: skin.ink, background: rgbaOf(ACCENT, 0.26),
  borderRadius: radii.sm, padding: '6px 8px',
};
const detailsBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start', background: 'transparent', border: 'none', cursor: cursors.clickable, fontFamily: font.family, ...roleFont('chip'), color: skin.muted, padding: 0 };

const editNotesBtn: CSSProperties = {
  background: 'transparent', border: `1.5px dashed ${skin.muted}`, borderRadius: radii.pill,
  padding: '2px 10px', fontFamily: font.family,
  ...roleFont('caption'), color: skin.ink,
};
const rowLabel: CSSProperties = { ...roleFont('label'), color: skin.ink };

/** A labelled field of a window's form: the caption over its control. */
/** A field's caption over its control, `FIELD_CAPTION_GAP` above it. */
export const fieldCaption: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, ...roleFont('label'), color: skin.ink };
export const FIELD_CAPTION_GAP = 4;

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: FIELD_CAPTION_GAP }}><span style={fieldCaption}>{label}{help && <HelpBubble text={help} />}</span>{children}</div>;
}
/** A label and its control on one line, the control at the end. */
function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>{children}</div>;
}
/** A row's label, with its help bubble when it has one. */
export function Label({ text, help }: { text: string; help?: string }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ...roleFont('label'), color: skin.ink }}>{text}{help && <HelpBubble text={help} />}</span>;
}
