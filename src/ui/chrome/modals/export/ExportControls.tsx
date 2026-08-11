import { useState, type CSSProperties } from 'react';
import { font, radii, cursors } from '../../../design/styles';
import { skin } from '../../../design/window-skin';
import { useT } from '../../../../i18n/context';
import { applyPreset, hasShareCode, type ExportOptions, type ExportPreset, type ResolutionKey } from '../../../../io/export/types';
import { RESOLUTION_WIDTHS } from '../../../../io/export/compose';
import { moduleBaseFor } from '../../../../io/share';
import type { MapProvenanceSummary } from '../../../../core/provenance/types';
import { HelpBubble } from './HelpBubble';
import { SegmentedControl } from '../../../primitives/SegmentedControl';
import { Switch } from '../../../primitives/Switch';
import { Expand } from './Expand';
import { FooterEditor } from './FooterEditor';
import { Shot3dStrip } from './Shot3dStrip';

const RES_KEYS: ResolutionKey[] = ['compact', 'standard', 'high', 'original'];
const PRESETS: ExportPreset[] = ['share', 'plain'];
const hasCurrentProv = (s: MapProvenanceSummary | null) => !!s && (s.containsAi || s.containsProcedural);

/** Settings only — the modal renders the fixed footer (Cancel / Export) outside the scroll region. */
export function ExportControls({ options, setOptions, summary, footerSamples }: {
  options: ExportOptions; setOptions: (o: ExportOptions) => void; summary: MapProvenanceSummary | null;
  /** Current value of each footer token (date/dims/name/…), shown in the footer editor's menu. */
  footerSamples: Record<string, string>;
}) {
  const t = useT();
  const [details, setDetails] = useState(false);
  const set = <K extends keyof ExportOptions>(k: K, v: ExportOptions[K]) => setOptions({ ...options, [k]: v });

  // The share code needs a minimum composition width; the Compact size is below it, so an
  // importable export silently loses its code there. Surface that instead of dropping it silently.
  const codeDropped = hasShareCode(options) && moduleBaseFor(RESOLUTION_WIDTHS[options.resolution]) === null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Preset */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={capStyle}>{t('export.preset')}</div>
        <SegmentedControl idPrefix="preset" value={options.preset} options={PRESETS} render={(p) => t(`export.preset_${p}`)} onChange={(p) => setOptions(applyPreset(options, p))} />
        <div style={{ fontSize: 12, fontWeight: 600, color: skin.muted, lineHeight: 1.4 }}>{t(`export.preset_${options.preset}_desc`)}</div>
      </div>

      {/* Title + description */}
      <Field label={t('export.field_title')}>
        <input value={options.title} maxLength={48} onChange={(e) => set('title', e.target.value)} style={inputStyle} placeholder={t('export.optional')} />
      </Field>
      <Field label={t('export.field_desc')}>
        <textarea value={options.description} maxLength={120} onChange={(e) => set('description', e.target.value)} style={{ ...inputStyle, minHeight: 44 }} placeholder={t('export.optional')} />
      </Field>

      {/* Size */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={capStyle}>{t('export.sec_size')}</div>
        <SegmentedControl idPrefix="size" value={options.resolution} options={RES_KEYS} fontSize={12} render={(k) => t(`export.res_${k}`)} onChange={(k) => set('resolution', k)} />
      </div>

      {/* Importability — labels + help bubbles, no paragraphs */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={capStyle}>{t('export.importability')}</div>
        {/* Row + its warning are ONE flex child so the column gap never wraps the collapsible. The
            note explains here, at the toggle it defeats, why an importable export loses its code. */}
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

      {/* Provenance badge toggle — always shown, but DISABLED (with a why) for human-made maps, so
          its absence never looks like a bug. Enabled only for AI/procedural/mixed content. */}
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
            {/* Footer first: its editor is the tallest control, so it sits at the top of the
                section with room rather than jammed against the buttons at the bottom. Row + its
                editor are ONE flex child so the column's 10px gap never wraps the collapsible —
                otherwise the collapsed editor still reserves a gap on each side, leaving a
                double-height space above the layer row. The editor's own top padding spaces it. */}
            <div>
              <Row><Label text={t('export.opt_footer')} /><Switch on={options.footer} onClick={() => set('footer', !options.footer)} label={t('export.opt_footer')} /></Row>
              <Expand open={options.footer}>
                <div style={{ paddingTop: 10 }}>
                  <FooterEditor value={options.footerTemplate} onChange={(tpl) => set('footerTemplate', tpl)} samples={footerSamples} t={t} />
                </div>
              </Expand>
            </div>
            <Row><span style={rowLabel}>{t('export.opt_layer')}</span><Switch on={options.layerPreview} onClick={() => set('layerPreview', !options.layerPreview)} label={t('export.opt_layer')} /></Row>
            <div>
              <Row><span style={rowLabel}>{t('export.opt_3d')}</span><Switch on={options.card3d} onClick={() => set('card3d', !options.card3d)} label={t('export.opt_3d')} /></Row>
              <Expand open={options.card3d}><div style={{ paddingTop: 10 }}><Shot3dStrip open={options.card3d} /></div></Expand>
            </div>
            <Row><span style={rowLabel}>{t('export.opt_grid')}</span><Switch on={options.grid} onClick={() => set('grid', !options.grid)} label={t('export.opt_grid')} /></Row>
          </div>
        </Expand>
      </div>
    </div>
  );
}

const inputStyle: CSSProperties = { fontFamily: font.family, fontSize: 13.5, fontWeight: 600, color: skin.ink, background: skin.inset, border: `1.5px solid ${skin.line}`, borderRadius: radii.md, padding: '9px 11px', resize: 'none', outline: 'none', width: '100%', boxSizing: 'border-box' };
const capStyle: CSSProperties = { fontSize: 12.5, fontWeight: 800, color: skin.muted };
// Attention note (amber, calm — not an error): the chosen size can't carry the share code.
/** The amber note this modal says share-code trouble with. Shared with the preview, which reports
 *  the other way a code goes missing (the encoder refused the map). */
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
  display: 'flex', gap: 7, alignItems: 'flex-start', fontSize: 12, fontWeight: 600, lineHeight: 1.4,
  color: skin.ink, background: 'rgba(255,179,71,0.26)',
  borderRadius: radii.sm, padding: '7px 9px',
};
const detailsBtn: CSSProperties = { alignSelf: 'flex-start', background: 'transparent', border: 'none', cursor: cursors.clickable, fontFamily: font.family, fontSize: 12.5, fontWeight: 800, color: skin.muted, padding: 0 };
const rowLabel: CSSProperties = { fontSize: 14, fontWeight: 700, color: skin.ink };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span style={{ fontSize: 12.5, fontWeight: 700, color: skin.ink }}>{label}</span>{children}</label>;
}
function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>{children}</div>;
}
function Label({ text, help }: { text: string; help?: string }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 700, color: skin.ink }}>{text}{help && <HelpBubble text={help} />}</span>;
}
