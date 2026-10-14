/** The save-file panel's parts: a section's row with its size and switch, the notes fields, and the live total. */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { motion, animate, useMotionValue, useTransform, useReducedMotionConfig } from 'framer-motion';
import { NOTE_LIMITS } from '../../../../../core/model/notes';
import type { MapNotes } from '../../../../../core/model/types';
import { useT } from '../../../../../i18n/context';
import { framerMotion, seconds } from '../../../../design/motion';
import { font, radii, UNAVAILABLE } from '../../../../design/styles';
import { skin } from '../../../../design/window-skin';
import { LINE_HEIGHT, roleFont } from '../../../../design/text-weight';
import { SIZE_GROWS, SIZE_SHRINKS } from '../../../../design/tokens';
import { Switch } from '../../../../primitives/Switch';
import { HelpBubble } from '../HelpBubble';
import { ReviewIndicator } from '../review/ReviewIndicator';

/** B under 1 KB, KB under 1 MB, else MB, with one decimal above bytes. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const enc = new TextEncoder();
/** The notes measured on their own, so typing never serializes the history. */
export function notesByteLen(n: MapNotes | undefined, pretty: boolean): number {
  return n ? enc.encode(JSON.stringify(n, null, pretty ? 2 : undefined)).length : 0;
}

const rowLabel: CSSProperties = { ...roleFont('label'), color: skin.ink };
export const rowDesc: CSSProperties = { ...roleFont('caption'), color: skin.plateInk, opacity: 0.8, lineHeight: LINE_HEIGHT.snug };
const chipStyle: CSSProperties = { fontFamily: font.family, ...roleFont('small'), color: skin.plateInk, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const inputStyle: CSSProperties = { fontFamily: font.family, ...roleFont('field'), color: skin.ink, background: skin.inset, border: `1.5px solid ${skin.line}`, borderRadius: radii.md, padding: '8px 32px 8px 10px', display: 'block', resize: 'none', outline: 'none', width: '100%', boxSizing: 'border-box' };
const fieldCaption: CSSProperties = { ...roleFont('caption'), color: skin.plateInk, marginBottom: 2, display: 'block' };

export function SectionRow({ name, desc, hint, checked, disabled, onToggle, bytes }: {
  name: string;
  desc: string;
  /** What the row says instead of `desc` while the map cannot carry the section. */
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

/** The map's title and description, edited in place, each with its check indicator and lock. */
export function NotesFields({ notes, onChange, titleLocked, descriptionLocked, checking, refused, issue, onComposing }: {
  notes: MapNotes;
  onChange: (notes: MapNotes) => void;
  titleLocked: boolean;
  descriptionLocked: boolean;
  checking: (field: keyof MapNotes) => boolean;
  refused: readonly string[];
  issue: ReactNode;
  onComposing: (composing: boolean) => void;
}) {
  const t = useT();
  const field = (key: 'title' | 'description', locked: boolean, label: string) => {
    const props = {
      disabled: locked, value: notes[key] ?? '', maxLength: NOTE_LIMITS[key], placeholder: t('export.optional'), 'aria-label': label,
      'aria-busy': checking(key), 'aria-invalid': refused.includes(key),
      onChange: (e: { target: { value: string } }) => onChange({ ...notes, [key]: e.target.value }),
    };
    const style: CSSProperties = { ...inputStyle, ...(key === 'description' ? { minHeight: 44 } : null), opacity: locked ? UNAVAILABLE : 1 };
    return (
      <div style={{ display: 'block' }}>
        <span style={fieldCaption}>{label} {locked && <HelpBubble text={t('export.attribution_locked')} />}</span>
        <span style={{ display: 'block', position: 'relative' }}>
          {key === 'title' ? <input {...props} style={style} /> : <textarea {...props} style={style} />}
          {checking(key) && <ReviewIndicator label={t('export.review.checking')} />}
        </span>
      </div>
    );
  };
  return (
    <div onCompositionStartCapture={() => onComposing(true)} onCompositionEndCapture={() => onComposing(false)} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '8px 0 2px' }}>
      {field('title', titleLocked, t('export.field_title'))}
      {field('description', descriptionLocked, t('export.field_desc'))}
      {issue}
    </div>
  );
}

/** The file's size, which glides to a new value and tints green as it grows and amber as it shrinks. */
export function AnimatedTotal({ bytes, label }: { bytes: number | null; label: string }) {
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
    const controls = animate(value, bytes, framerMotion('export.total'));
    const clear = setTimeout(() => setDir(0), seconds('export.tint') * 1000);
    return () => { controls.stop(); clearTimeout(clear); };
  }, [bytes, reduced, value]);

  const tint = dir === 1 ? SIZE_GROWS : dir === -1 ? SIZE_SHRINKS : skin.plateInk;
  return (
    <span style={{ ...roleFont('small'), color: skin.plateInk, display: 'inline-flex', gap: 4, alignItems: 'baseline' }}>
      <span>{label}:</span>
      <motion.span
        // The tint arrives over the first 30% of the curve and drifts back over the rest.
        animate={reduced ? {} : {
          color: dir === 0 ? skin.plateInk : [skin.plateInk, tint, skin.plateInk],
          y: [dir === 1 ? 3 : dir === -1 ? -3 : 0, 0],
        }}
        transition={{ color: { ...framerMotion('export.tint'), times: [0, 0.3, 1] }, y: framerMotion('export.total') }}
        style={{ color: skin.plateInk, fontVariantNumeric: 'tabular-nums', display: 'inline-block' }}
      >
        {bytes == null ? '…' : text}
      </motion.span>
    </span>
  );
}
