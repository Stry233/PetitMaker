/**
 * The layer panel's head, standing outside the scrolling floors: the layer numbers switch at the
 * left (a fact about the map) and the size arrows at the right (the way back walks toward the edge
 * the plate hangs from). The head and its pills take layout projection so the plate's resize moves
 * rather than squashes them.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { useTransition } from '../../design/motion/use-motion';
import { btnReset, cursors, radii, UNAVAILABLE } from '../../design/styles';
import { ACTIVE, INK, INSET, PLATE_INK } from '../../design/tokens';
import { ActionButton } from '../../primitives/ActionButton';
import { useNameReveal } from '../../primitives/use-name-reveal';
import { useReveal } from '../../primitives/use-reveal';
import { ChevronLeftIcon, ChevronRightIcon } from '../../primitives/line-glyphs';
import { stepLayerMode, type LayerMode } from '../frame';
import { TEXT } from '../units';
import { useFrameReadableWeight, useFrameZoom, useZoomedLayoutTransform } from '../use-frame-zoom';
import { LEAD_X, PANEL, tileOf } from './layer-plate';
import { TouchReach } from '../../primitives/TouchReach';

/**
 * One step of the size ladder. The plate grows leftward into the map, so the arrow pointing left
 * opens it and the one pointing right, which wears the count's yellow, puts it away; a spent arrow
 * dims so both directions always show.
 */
function SizeArrow({ dir, mode, onMode }: { dir: -1 | 1; mode: LayerMode; onMode: (mode: LayerMode) => void }) {
  const t = useT();
  const zoom = useFrameZoom();
  const next = stepLayerMode(mode, dir);
  const spent = next === mode;
  const label = t(dir < 0 ? 'a11y.layer_smaller' : 'a11y.layer_bigger');
  const name = useNameReveal(label);
  return (
    <ActionButton
      interaction="tile"
      {...name.bind}
      aria-label={label}
      data-testid={dir < 0 ? 'shell-layer-smaller' : 'shell-layer-bigger'}
      disabled={spent}
      onClick={() => onMode(next)}
      style={{
        ...btnReset, position: 'relative', display: 'flex', alignItems: 'center',
        padding: `${PANEL.headPadY}px ${PANEL.headPadX}px`, borderRadius: radii.pill,
        background: ACTIVE, color: INK,
        opacity: spent ? UNAVAILABLE : 1,
        cursor: spent ? cursors.blocked : cursors.clickable,
        // As tall as the head declares, so the plate is as deep as `plateDepth` says.
        lineHeight: 1, height: TEXT.head, boxSizing: 'content-box',
      }}
    >
      {dir < 0 ? <ChevronRightIcon size={PANEL.headGlyph} /> : <ChevronLeftIcon size={PANEL.headGlyph} />}
      {/* The pair touch, so each grows away from the other. */}
      <TouchReach h={2 * PANEL.headPadY + TEXT.head} zoom={zoom} sides={dir > 0 ? { right: false } : { left: false }} />
      {name.bubble}
    </ActionButton>
  );
}

/** The layer numbers switch; its name opens rightward when reached for (`useReveal`), into the row's free space, without moving the arrows. */
function NumbersToggle({ mode }: { mode: LayerMode }) {
  const t = useT();
  const fw = useFrameReadableWeight();
  const zoomed = useZoomedLayoutTransform();
  const reachName = useTransition('rail.name.reach');
  const showLayerNumbers = useEditorStore((s) => s.showLayerNumbers);
  const setShowLayerNumbers = useEditorStore((s) => s.setShowLayerNumbers);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  const { shown: reached, bind: reach } = useReveal();
  const zoom = useFrameZoom();
  const [numbers, setNumbers] = useState({ box: 0, name: 0 });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- measures after every render; the setter keeps an equal reading
  useLayoutEffect(() => {
    const box = buttonRef.current?.offsetWidth ?? 0;
    const name = nameRef.current?.scrollWidth ?? 0;
    // Under a fractional ancestor zoom (a Help figure shrunk to its column) a reading can step a px
    // back and forth between renders; a px either way is the same reading, so the loop settles.
    setNumbers((was) => (Math.abs(was.box - box) <= 1 && Math.abs(was.name - name) <= 1 ? was : { box, name }));
  });
  return (
    <ActionButton
      ref={buttonRef}
      interaction="tap"
      layout="position"
      layoutDependency={mode}
      transformTemplate={zoomed}
      aria-label={t('a11y.toggle_layer_numbers')}
      aria-pressed={showLayerNumbers}
      data-testid="shell-layer-numbers"
      onClick={() => setShowLayerNumbers(!showLayerNumbers)}
      {...reach}
      style={{
        ...btnReset, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: `${PANEL.headPadY}px ${PANEL.headPadX}px`, borderRadius: radii.pill, minWidth: PANEL.headGlyph,
        fontSize: TEXT.small, fontWeight: fw(900, TEXT.small), color: showLayerNumbers ? INK : PLATE_INK,
        lineHeight: 1, height: TEXT.head, boxSizing: 'content-box', transformOrigin: 'left center', cursor: cursors.clickable,
      }}
    >
      {/* The mark in flow sizes the button; the one seen rides the plate over it. */}
      <span style={{ visibility: 'hidden' }}>#</span>
      <motion.span
        aria-hidden
        initial={false}
        animate={{ width: numbers.box + (reached ? numbers.name + PANEL.headPadX : 0) }}
        transition={reachName}
        style={{
          position: 'absolute', left: 0, top: 0, height: '100%', borderRadius: radii.pill,
          background: showLayerNumbers ? ACTIVE : INSET, display: 'flex', alignItems: 'center', overflow: 'hidden',
        }}
      >
        <span style={{ width: numbers.box, flex: 'none', textAlign: 'center' }}>#</span>
        <span ref={nameRef} style={{ flex: 'none', whiteSpace: 'nowrap', fontWeight: fw(800, TEXT.small), paddingRight: PANEL.headPadX }}>
          {t('a11y.toggle_layer_numbers')}
        </span>
      </motion.span>
      <TouchReach zoom={zoom} />
    </ActionButton>
  );
}

export function LayerHead({ mode, onMode }: { mode: LayerMode; onMode: (mode: LayerMode) => void }) {
  const resize = useTransition('layer.mode.resize');
  const zoomed = useZoomedLayoutTransform();
  return (
    <motion.div
      data-testid="shell-layer-head"
      layout
      layoutDependency={mode}
      transition={resize}
      transformTemplate={zoomed}
      style={{
        flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: PANEL.headSplitGap,
        // The left pill stands on the leading column at both sizes; the height is declared for `plateDepth`.
        padding: `0 ${tileOf(mode).padX}px ${PANEL.headGap}px ${LEAD_X}px`,
        height: 2 * PANEL.headPadY + TEXT.head, boxSizing: 'content-box',
      }}
    >
      <NumbersToggle mode={mode} />
      <motion.div
        layout="position"
        layoutDependency={mode}
        transition={resize}
        transformTemplate={zoomed}
        style={{ display: 'flex', alignItems: 'center', gap: PANEL.arrowGap }}
      >
        <SizeArrow dir={1} mode={mode} onMode={onMode} />
        <SizeArrow dir={-1} mode={mode} onMode={onMode} />
      </motion.div>
    </motion.div>
  );
}
