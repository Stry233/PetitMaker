import { helpAttributes, type HelpTarget } from '../../primitives/help-target';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useIsPresent } from 'framer-motion';
import { btnReset, buttonMotion, cursors, UNAVAILABLE } from '../../design/styles';
import { INK, INSET, PLATE } from '../../design/tokens';
import { useMotion } from '../motion/use-motion';
import { SCALE, TEXT } from '../units';
import { BarText, ShortcutBadge } from './bar-atoms';
import { CELL_BOX } from './ToolCell';
import { PILL_H, PLATE_PAD } from './terrain-cells';

type Option<T> = { value: T; label: string; glyph: ReactNode; title?: string };
const ICON_WIDTH = 108 * SCALE;
const GAP = 2;
const PAD = 4;
const LABEL_PAD = 12;

/** A shared selection plate follows the expanding option in local, unzoomed units. */
export function OptionPill<T extends string>({ value, options, label, commandId, disabled = false, onChange, helpTarget }: {
  value: T; options: readonly Option<T>[]; label: string; commandId?: string;
  helpTarget?: HelpTarget; disabled?: boolean; onChange: (value: T) => void;
}) {
  const present = useIsPresent();
  const inactive = disabled || !present;
  // The registry follows preference changes; Framer's positional gate is fixed at mount.
  const transition = { ...useMotion('tool.option.select'), reduceMotion: false };
  const words = useRef<(HTMLSpanElement | null)[]>([]);
  const [widths, setWidths] = useState<number[]>([]);
  const measured = widths.length === options.length;
  const labels = options.map(option => option.label).join('\0');
  useLayoutEffect(() => {
    const measure = () => {
      const next = words.current.map(word => word?.offsetWidth ?? 0);
      setWidths(current => current.length === next.length && current.every((width, i) => width === next[i]) ? current : next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    words.current.forEach(word => { if (word) observer.observe(word); });
    return () => observer.disconnect();
  }, [labels, measured]);
  const selected = options.findIndex(option => option.value === value);

  return <div {...helpAttributes(helpTarget)} style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: 'none', height: CELL_BOX.h }}>
    <div role="group" aria-label={label} style={{ position: 'relative', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: GAP,
      padding: PAD, borderRadius: 999, height: PILL_H, background: PLATE, opacity: disabled ? UNAVAILABLE : 1 }}>
      {selected >= 0 && widths[selected] !== undefined && <motion.span data-option-plate aria-hidden initial={false}
        animate={{ left: PAD + selected * (ICON_WIDTH + GAP), width: ICON_WIDTH + (widths[selected] ?? 0) + LABEL_PAD }} transition={transition}
        style={{ position: 'absolute', left: PAD, top: PAD, bottom: PAD, borderRadius: 999, background: INSET, pointerEvents: 'none' }}/>}
      {options.map((option, index) => {
        const active = value === option.value;
        return <motion.button key={option.value} type="button" {...(inactive ? {} : buttonMotion)} disabled={inactive}
          aria-label={option.label} aria-pressed={active} title={option.title ?? option.label} onClick={() => { if (!inactive) onChange(option.value); }}
          style={{ ...btnReset, position: 'relative', display: 'flex', alignItems: 'center', height: PILL_H - 2 * PAD,
            borderRadius: 999, color: INK, pointerEvents: 'auto', cursor: inactive ? cursors.blocked : cursors.clickable }}>
          <span style={{ display: 'grid', placeItems: 'center', width: ICON_WIDTH, flex: 'none' }}>{option.glyph}</span>
          {/* Remount once after layout measurement so every animated width starts in pixels before paint. */}
          <motion.span key={measured ? 'measured' : 'measuring'} aria-hidden initial={false}
            animate={{ width: active ? (widths[index] ?? 0) + LABEL_PAD : 0, opacity: active ? 1 : 0 }} transition={transition}
            style={{ display: 'flex', overflow: 'hidden', flex: 'none' }}>
            <BarText size={TEXT.label} style={{ flex: 'none' }}><span ref={element => { words.current[index] = element; }}
              style={{ display: 'block', whiteSpace: 'nowrap' }}>{option.label}</span></BarText>
          </motion.span>
        </motion.button>;
      })}
    </div>
    {commandId && <ShortcutBadge commandId={commandId} grown/>}
    <span data-option-caption style={{ position: 'absolute', top: CELL_BOX.h + PLATE_PAD.y + 5,
      left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
      <BarText onMap size={TEXT.label}>{label}</BarText>
    </span>
  </div>;
}
