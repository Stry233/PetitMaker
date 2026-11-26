/**
 * A choice between maps as a radio group of pictures (`PictureChoices`): each option the picture over
 * a caption with the radio dot, the label and an optional count badge, in the danger pair where it
 * counts what the choice loses. The whole option presses as one control; a press on its picture is a
 * pan and chooses through the picture's own tap. Change Planet's carry step and the landmark repair's
 * choice both offer their maps this way.
 */
import { useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useWindowColumns } from '../use-window-columns';
import { stepIn, type CycleStep } from '../../../../core/base/cycle';
import { motion } from 'framer-motion';
import { cssMotion } from '../../../design/motion';
import { cursors, font, radii } from '../../../design/styles';
import { roleFont } from '../../../design/text-weight';
import { skin, windowChip } from '../../../design/window-skin';
import { useInteractionProfiles } from '../../../design/input-mode';

const optionStyle: CSSProperties = {
  position: 'relative', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: 10,
  borderRadius: radii.lg, outlineOffset: 2, color: skin.ink, fontFamily: font.family, cursor: cursors.clickable,
  transition: cssMotion('planet.choice.select', ['background-color', 'box-shadow']),
};
/** A picture's stage, the height every option's picture takes. */
export const pictureStage: CSSProperties = { position: 'relative', display: 'flex', height: 330 };
const captionStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '12px 8px 4px', cursor: cursors.clickable, ...roleFont('head'),
};
const dotStyle = (on: boolean): CSSProperties => ({
  flex: 'none', width: 20, height: 20, borderRadius: '50%', background: skin.plate, display: 'grid', placeItems: 'center',
  boxShadow: `inset 0 0 0 2px ${on ? skin.ink : skin.track}`,
  transition: cssMotion('planet.choice.select', ['box-shadow']),
});
const dotFill = (on: boolean): CSSProperties => ({
  width: 10, height: 10, borderRadius: '50%', background: skin.ink, opacity: on ? 1 : 0,
  transition: cssMotion('planet.choice.select', ['opacity']),
});
/** The option's fill is the surface the chip stands on: the chosen yellow and the hover inset both
 *  take the plate chip, the bare plate takes the inset one; a loss keeps its danger pair on either. */
const badgeStyle = (lifted: boolean, loss: boolean): CSSProperties => ({
  ...windowChip(lifted ? 'inset' : 'plate', loss ? 'danger' : 'plain'), flex: 'none', marginInlineStart: 'auto',
  whiteSpace: 'nowrap', pointerEvents: 'none',
  transition: cssMotion('planet.choice.select', ['background-color']),
});
/* The whole option presses as one control; a press on its picture is a pan and does not. */

function PictureOption({ checked, onSelect, onKeyDown, optionRef, testId, label, badge, children }: {
  checked: boolean;
  onSelect: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
  optionRef: (el: HTMLDivElement | null) => void;
  testId: string;
  label: string;
  /** A count beside the label; `loss` marks a count of what the choice leaves behind or takes away. */
  badge: { text: string; loss?: boolean } | null;
  children: (onTap: () => void) => React.ReactNode;
}) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const press = useInteractionProfiles().row;
  const labelId = useId();
  const badgeId = useId();
  const stageRef = useRef<HTMLDivElement>(null);
  const fill = checked ? skin.active : hover ? skin.inset : 'transparent';
  // The picture answers through its tap, so a press that panned it chooses nothing.
  const click = (e: React.MouseEvent) => { if (!stageRef.current?.contains(e.target as Node)) onSelect(); };
  return (
    <motion.div ref={optionRef} role="radio" aria-checked={checked} tabIndex={checked ? 0 : -1} data-testid={testId}
      aria-labelledby={labelId} {...(badge ? { 'aria-describedby': badgeId } : {})}
      onClick={click} onKeyDown={onKeyDown}
      onPointerEnter={() => setHover(true)} onPointerLeave={() => { setHover(false); setPressed(false); }}
      onPointerDown={(e: PointerEvent) => { if (!stageRef.current?.contains(e.target as Node)) setPressed(true); }}
      onPointerUp={() => setPressed(false)} onPointerCancel={() => setPressed(false)}
      animate={pressed ? press.whileTap : hover && press.whileHover ? press.whileHover : { scale: 1 }} transition={press.transition}
      style={{ ...optionStyle, background: fill, boxShadow: checked ? 'none' : `inset 0 0 0 2px ${skin.line}` }}>
      <div ref={stageRef} style={pictureStage}>
        {children(onSelect)}
      </div>
      <div style={captionStyle}>
        <span aria-hidden style={dotStyle(checked)}><span style={dotFill(checked)} /></span>
        <span id={labelId} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {badge && (
          <span id={badgeId} data-testid="planet-dropped" style={badgeStyle(checked || hover, !!badge.loss)}>{badge.text}</span>
        )}
      </div>
    </motion.div>
  );
}

/** One option of a `PictureChoices` group. */
export interface PictureChoice<T extends string> {
  value: T;
  testId: string;
  label: string;
  badge: { text: string; loss?: boolean } | null;
  /** The picture, which chooses this option through `onTap`. */
  picture: (onTap: () => void) => ReactNode;
}

/** The options side by side, stacked where the window body is too narrow for two columns. Arrow keys
 *  move the choice as in any radio group, and the chosen option is the one tab stop. `columns` is the
 *  owner's reading where its footer follows the same switch. */
export function PictureChoices<T extends string>({ choices, value, onChange, labelledBy, columns: owned }: {
  choices: readonly PictureChoice<T>[];
  value: T;
  onChange: (value: T) => void;
  /** The element naming the choice. */
  labelledBy: string;
  columns?: 1 | 2;
}) {
  const [measured, bodyRef] = useWindowColumns();
  const columns = owned ?? measured;
  const refs = useRef(new Map<T, HTMLDivElement>());
  const keys = (at: number) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(choices[at]!.value); return; }
    const step: CycleStep | 0 = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = stepIn(choices.map((c) => c.value), choices[at]!.value, step);
    onChange(next);
    refs.current.get(next)?.focus();
  };
  return (
    <div ref={bodyRef} role="radiogroup" aria-labelledby={labelledBy} data-columns={columns}
      style={{ display: 'flex', gap: 16, ...(columns === 1 ? { flexDirection: 'column' } : null) }}>
      {choices.map((choice, i) => (
        <PictureOption key={choice.value} checked={choice.value === value} onSelect={() => onChange(choice.value)} onKeyDown={keys(i)}
          optionRef={(el) => { if (el) refs.current.set(choice.value, el); else refs.current.delete(choice.value); }}
          testId={choice.testId} label={choice.label} badge={choice.badge}>
          {choice.picture}
        </PictureOption>
      ))}
    </div>
  );
}
