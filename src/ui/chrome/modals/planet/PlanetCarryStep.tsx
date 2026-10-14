/**
 * Change Planet's second step: the build laid onto the destination, with every cell that does not
 * fit in red, beside the destination as it opens empty. The two are radio options; a tap on either
 * picture chooses it and a drag pans it.
 */
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { motion } from 'framer-motion';
import { LOSS_COLOR } from '../../../../view/shared/viewport/view-constants';
import type { GridState, MapTemplate } from '../../../../core/model/types';
import { useT } from '../../../../i18n/context';
import { requestTransferPreview } from '../../../../editor/operations';
import { cachedTransferPreview, rememberTransferPreview, transferPreviewKey } from '../../../../editor/operations/transfer-map';
import type { TransferPreview } from '../../../../tools/generation/run';
import { cssMotion } from '../../../design/motion';
import { cursors, font, interactionProfiles, radii } from '../../../design/styles';
import { roleFont } from '../../../design/text-weight';
import { skin, windowChip } from '../../../design/window-skin';
import { planetBounds } from '../../../../view/map2d/capture/planet-painter';
import { PlanetPreview } from './PlanetPreview';
import { onAfterPaint } from '../../../../platform/async/after-paint';

export type Carry = 'carry' | 'fresh';

/**
 * The build as it would arrive on `target`, or null while it is being worked out. The transfer
 * replays the whole build, far longer than a frame, so it runs in a worker; where none runs it waits
 * `settleMs` for the step's own motion to land and then runs after the next painted frame. A request
 * whose target, map version or step has moved on is cancelled and its answer is never shown.
 */
export function useCarryPreview(state: GridState | null, target: MapTemplate, active: boolean, settleMs = 0): TransferPreview | null {
  const [, setDone] = useState(0);
  const key = state ? transferPreviewKey(state) : '';
  const ready = active && state ? cachedTransferPreview(state, target) : null;
  useEffect(() => {
    if (!active || !state || cachedTransferPreview(state, target)) return undefined;
    const controller = new AbortController();
    const { signal } = controller;
    let settle: ReturnType<typeof setTimeout> | undefined;
    let cancelPaint = () => {};
    const whenIdle = () => new Promise<void>((resolve) => {
      settle = setTimeout(() => { cancelPaint = onAfterPaint(resolve); }, settleMs);
    });
    void requestTransferPreview(state, target, { signal, whenIdle }).then((preview) => {
      // An edit since the request is a newer map than the one the answer was worked out from.
      if (!preview || signal.aborted) return;
      if (transferPreviewKey(state) !== key) return;
      rememberTransferPreview(state, target, preview);
      setDone((n) => n + 1);
    });
    return () => {
      controller.abort();
      if (settle !== undefined) clearTimeout(settle);
      cancelPaint();
    };
  }, [active, state, key, target, settleMs]);
  return ready;
}

const optionsStyle: CSSProperties = { display: 'flex', gap: 16 };
const optionStyle: CSSProperties = {
  position: 'relative', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: 10,
  borderRadius: radii.lg, outlineOffset: 2, color: skin.ink, fontFamily: font.family, cursor: cursors.clickable,
  transition: cssMotion('planet.choice.select', ['background-color', 'box-shadow']),
};
const stageBox: CSSProperties = { position: 'relative', display: 'flex', height: 330 };
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
  ...windowChip(lifted ? 'inset' : 'plate'), flex: 'none', marginInlineStart: 'auto', paddingInlineStart: 8,
  display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', pointerEvents: 'none',
  transition: cssMotion('planet.choice.select', ['background-color']),
});
const lossSwatch: CSSProperties = { width: 14, height: 14, borderRadius: radii.sm, background: LOSS_COLOR, flex: 'none' };
/** The whole option presses as one control; a press on its picture is a pan and does not. */
const press = interactionProfiles.row;

interface PlanetCarryStepProps {
  target: MapTemplate;
  /** Null while the transfer is being worked out. */
  preview: TransferPreview | null;
  carry: Carry;
  onCarry: (carry: Carry) => void;
  /** The element naming the choice: the step's title. */
  labelledBy: string;
}

export function PlanetCarryStep({ target, preview, carry, onCarry, labelledBy }: PlanetCarryStepProps) {
  const t = useT();
  const refs = useRef<Record<Carry, HTMLDivElement | null>>({ carry: null, fresh: null });
  const lost = preview?.dropped.length ?? 0;
  // One box for both pictures, so the choice is between two planets at the same scale and centre.
  // The box needs the dropped cells, so both pictures wait for the transfer and neither rescales.
  const fit = useMemo(() => (preview ? planetBounds({ template: target, dropped: preview.dropped }) : undefined), [target, preview]);
  // Arrow keys move the choice, as in any radio group; the chosen option is the one tab stop.
  const keys = (value: Carry) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCarry(value); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const other: Carry = value === 'carry' ? 'fresh' : 'carry';
    onCarry(other);
    refs.current[other]?.focus();
  };
  const option = (value: Carry) => ({
    checked: carry === value,
    onSelect: () => onCarry(value),
    onKeyDown: keys(value),
    optionRef: (el: HTMLDivElement | null) => { refs.current[value] = el; },
  });
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} style={optionsStyle}>
      <Option {...option('carry')} testId="planet-carry-option" label={t('planet.carry_option')}
        badge={lost > 0 ? t('planet.cells_dropped', { n: lost }) : null}>
        {(onTap) => (
          <PlanetPreview template={target} fit={fit} pending={!preview} onTap={onTap}
            {...(preview ? { state: preview.state, dropped: preview.dropped } : {})} />
        )}
      </Option>
      <Option {...option('fresh')} testId="planet-fresh-option" label={t('planet.carry_fresh')} badge={null}>
        {(onTap) => <PlanetPreview template={target} fit={fit} pending={!preview} onTap={onTap} />}
      </Option>
    </div>
  );
}

function Option({ checked, onSelect, onKeyDown, optionRef, testId, label, badge, children }: {
  checked: boolean;
  onSelect: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
  optionRef: (el: HTMLDivElement | null) => void;
  testId: string;
  label: string;
  badge: string | null;
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
      <div ref={stageRef} style={stageBox}>
        {children(onSelect)}
      </div>
      <div style={captionStyle}>
        <span aria-hidden style={dotStyle(checked)}><span style={dotFill(checked)} /></span>
        <span id={labelId} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {badge && (
          <span id={badgeId} data-testid="planet-dropped" style={badgeStyle(checked || hover)}>
            <i aria-hidden style={lossSwatch} />{badge}
          </span>
        )}
      </div>
    </motion.div>
  );
}
