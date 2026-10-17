/**
 * One picture of a choice between maps, as a radio option: the picture over a caption with the radio
 * dot, the label and an optional count badge. The whole option presses as one control; a press on its
 * picture is a pan and chooses through the picture's own tap. Change Planet's carry step and the
 * landmark repair's choice both offer their maps this way.
 */
import { useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { motion } from 'framer-motion';
import { cssMotion } from '../../../design/motion';
import { cursors, font, interactionProfiles, radii } from '../../../design/styles';
import { roleFont } from '../../../design/text-weight';
import { skin, windowChip } from '../../../design/window-skin';

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
 *  take the plate chip, the bare plate takes the inset one. */
const badgeStyle = (lifted: boolean): CSSProperties => ({
  ...windowChip(lifted ? 'inset' : 'plate'), flex: 'none', marginInlineStart: 'auto',
  display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', pointerEvents: 'none',
  transition: cssMotion('planet.choice.select', ['background-color']),
});
const swatchStyle: CSSProperties = { width: 14, height: 14, borderRadius: radii.sm, flex: 'none' };
/** The whole option presses as one control; a press on its picture is a pan and does not. */
const press = interactionProfiles.row;

export function PictureOption({ checked, onSelect, onKeyDown, optionRef, testId, label, badge, children }: {
  checked: boolean;
  onSelect: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
  optionRef: (el: HTMLDivElement | null) => void;
  testId: string;
  label: string;
  /** A count beside the label, with the colour its cells wear in the picture where they show. */
  badge: { text: string; swatch?: string } | null;
  children: (onTap: () => void) => React.ReactNode;
}) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
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
      animate={pressed ? press.whileTap : hover ? press.whileHover : { scale: 1 }} transition={press.transition}
      style={{ ...optionStyle, background: fill, boxShadow: checked ? 'none' : `inset 0 0 0 2px ${skin.line}` }}>
      <div ref={stageRef} style={pictureStage}>
        {children(onSelect)}
      </div>
      <div style={captionStyle}>
        <span aria-hidden style={dotStyle(checked)}><span style={dotFill(checked)} /></span>
        <span id={labelId} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {badge && (
          <span id={badgeId} data-testid="planet-dropped" style={badgeStyle(checked || hover)}>
            {badge.swatch && <i aria-hidden style={{ ...swatchStyle, background: badge.swatch }} />}{badge.text}
          </span>
        )}
      </div>
    </motion.div>
  );
}
