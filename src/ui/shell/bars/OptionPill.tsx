import { helpAttributes, type HelpTarget } from '../../primitives/help-target';
import { ActionButton } from '../../primitives/ActionButton';
import { useNameReveal } from '../../primitives/use-name-reveal';
import { TouchReach } from '../../primitives/TouchReach';
import { useFrameZoom } from '../use-frame-zoom';
import { MapCaption } from './MapCaption';
import { CAPTION_TOP } from './ToolPill';
import { useRef, useState, type ReactNode } from 'react';
import { motion, useIsPresent } from 'framer-motion';
import { btnReset, cursors, UNAVAILABLE, radii } from '../../design/styles';
import { INK, INSET, PLATE } from '../../design/tokens';
import { useTransition } from '../../design/motion/use-motion';
import { SCALE } from '../units';
import { BarText, ShortcutBadge } from './bar-atoms';
import { PILL_H, CELL_BOX } from './terrain-cells';
import { useObservedSize } from '../../primitives/use-observed-size';

/** One option: `label` is what it shows while chosen, `name` what it is called where the label alone
 *  says too little; an option with no label shows its glyph alone, chosen or not, and is called by `name`. */
type Option<T> = { value: T; glyph: ReactNode; title?: string }
  & ({ label: string; name?: string } | { label?: undefined; name: string });
const ICON_WIDTH = 108 * SCALE;
/** The size, in local px, an option's glyph is drawn at inside its `ICON_WIDTH` slot. */
export const OPTION_GLYPH = 51 * SCALE;
const GAP = 2;
const PAD = 4;
const LABEL_PAD = 12;

/** A shared selection plate follows the expanding option in local, unzoomed units. */
export function OptionPill<T extends string>({ value, options, label, commandId, disabled = false, onChange, helpTarget }: {
  value: T; options: readonly Option<T>[]; label: string; commandId?: string;
  helpTarget?: HelpTarget; disabled?: boolean; onChange: (value: T) => void;
}) {
  const present = useIsPresent();
  const zoom = useFrameZoom();
  const inactive = disabled || !present;
  // The registry follows preference changes; Framer's positional gate is fixed at mount.
  const transition = { ...useTransition('tool.option.select'), reduceMotion: false };
  const words = useRef<(HTMLSpanElement | null)[]>([]);
  const [widths, setWidths] = useState<number[]>([]);
  const measured = widths.length === options.length;
  const labels = options.map(option => option.label ?? '').join('\0');
  useObservedSize(() => words.current, () => {
    const next = options.map((_, i) => words.current[i]?.offsetWidth ?? 0);
    setWidths(current => current.length === next.length && current.every((width, i) => width === next[i]) ? current : next);
  }, [labels, measured]);
  const selected = options.findIndex(option => option.value === value);
  // How much a chosen option grows past its glyph: nothing without a label, unknown until its label is measured.
  const growth = (index: number) => options[index]?.label === undefined ? 0
    : widths[index] === undefined ? undefined : widths[index] + LABEL_PAD;
  const chosenGrowth = selected >= 0 ? growth(selected) : undefined;

  return <div {...helpAttributes(helpTarget)} style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: 'none', height: CELL_BOX.h }}>
    <div role="group" aria-label={label} style={{ position: 'relative', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: GAP,
      padding: PAD, borderRadius: radii.pill, height: PILL_H, background: PLATE, opacity: disabled ? UNAVAILABLE : 1 }}>
      {chosenGrowth !== undefined && <motion.span data-option-plate aria-hidden initial={false}
        animate={{ left: PAD + selected * (ICON_WIDTH + GAP), width: ICON_WIDTH + chosenGrowth }} transition={transition}
        style={{ position: 'absolute', left: PAD, top: PAD, bottom: PAD, borderRadius: radii.pill, background: INSET, pointerEvents: 'none' }}/>}
      {options.map((option, index) => {
        const active = value === option.value;
        return <OptionButton key={option.value} option={option} active={active} inactive={inactive} onPress={() => { if (!inactive) onChange(option.value); }}>
          {/* Remount once after layout measurement so every animated width starts in pixels before paint. */}
          {option.label !== undefined && <motion.span key={measured ? 'measured' : 'measuring'} aria-hidden initial={false}
            animate={{ width: active ? growth(index) ?? 0 : 0, opacity: active ? 1 : 0 }} transition={transition}
            style={{ display: 'flex', overflow: 'hidden', flex: 'none' }}>
            <BarText role="chip" style={{ flex: 'none' }}><span ref={element => { words.current[index] = element; }}
              style={{ display: 'block', whiteSpace: 'nowrap' }}>{option.label}</span></BarText>
          </motion.span>}
          <TouchReach zoom={zoom} />
        </OptionButton>;
      })}
    </div>
    {commandId && <ShortcutBadge commandId={commandId} grown/>}
    <MapCaption data-option-caption top={CAPTION_TOP}>
      <BarText onMap role="chip">{label}</BarText>
    </MapCaption>
  </div>;
}

/** One option: its glyph, then `children` (its label, shown while it is the active one). An option
 *  that shows only its glyph, unchosen or with no label, names itself (`useNameReveal`). */
function OptionButton<T extends string>({ option, active, inactive, onPress, children }: {
  option: Option<T>; active: boolean; inactive: boolean; onPress: () => void; children: ReactNode;
}) {
  const called = option.label === undefined ? option.name : option.name ?? option.label;
  const name = useNameReveal(called, 'above', option.title ?? called);
  return <ActionButton interaction="action" dim="caller" disabled={inactive}
    {...name.bind} aria-label={called} aria-pressed={active} onClick={onPress}
    style={{ ...btnReset, position: 'relative', display: 'flex', alignItems: 'center', height: PILL_H - 2 * PAD,
      borderRadius: radii.pill, color: INK, pointerEvents: 'auto', cursor: inactive ? cursors.blocked : cursors.clickable }}>
    <span style={{ display: 'grid', placeItems: 'center', width: ICON_WIDTH, flex: 'none' }}>{option.glyph}</span>
    {children}
    {active && option.label !== undefined ? null : name.bubble}
  </ActionButton>;
}
