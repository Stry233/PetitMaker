/*
 * The object shelf's round brush button (EDIT-64, EDIT-68, EDIT-69): it opens the brush bar in the
 * shelf's place, armed or not, and wears the way to place it sets, Place's drawing, or with Paint
 * the active fill and the brush shape's drawing. With the planting card or an item placed one at a
 * time armed, or a row showing only such items, it is unavailable and its name says why. On the wide shelf a resting mouse or the
 * keyboard's focus grows it along the row into a pill naming that way.
 */
import { useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { useT } from '../../../../i18n/context';
import { getCatalogItem } from '../../../../state/catalog';
import { armedMacroOf, armedPicksOf } from '../../../../state/editing/edit-mode';
import { placesOneAtATime } from '../../../../state/object-geometry';
import { useEditorStore } from '../../../../state/store';
import { cssMotion, presence } from '../../../design/motion';
import { useTransition } from '../../../design/motion/use-motion';
import { btnReset, cursors, radii, UNAVAILABLE } from '../../../design/styles';
import { ACTIVE, INK, PLATE, plateShapeEdge } from '../../../design/tokens';
import { ActionButton } from '../../../primitives/ActionButton';
import { TouchReach } from '../../../primitives/TouchReach';
import { useNameReveal } from '../../../primitives/use-name-reveal';
import { useObservedSize } from '../../../primitives/use-observed-size';
import { useReveal } from '../../../primitives/use-reveal';
import { helpTargetAttr } from '../../../session/help-targets';
import { useShelfBrushSource } from '../../../session/shelf-brush-standing';
import { useUiPreview } from '../../../design/preview';
import { tourTargetAttr } from '../../../chrome/tour/steps';
import { GlyphIcon } from '../../GlyphIcon';
import { useFrameReadableWeight, useFrameZoom } from '../../use-frame-zoom';
import { SCALE, TEXT } from '../../units';
import { ShapeGlyph } from '../ShapeOptions';
import { BRUSH_GLYPHS } from './brush-glyphs';

/** How big the drawing reads on the button, as a share of its side. */
const GLYPH_SHARE = 0.5;

/** `size` is the button's side in the row's px; `paints` says whether the row shows any item a stroke
 *  can lay; `expands` lets it grow, by `room` px at most, into the pill naming the way to place. */
export function ShelfBrushButton({ size, paints, style, expands }: {
  size: number; paints: boolean; style?: CSSProperties; expands?: { room: number };
}) {
  const t = useT();
  const zoom = useFrameZoom();
  const weightAt = useFrameReadableWeight();
  const reduced = useReducedMotionConfig();
  const picks = useEditorStore(armedPicksOf);
  const planting = useEditorStore((s) => armedMacroOf(s) !== null);
  const painting = useEditorStore((s) => s.objectBrush === 'paint');
  const shape = useEditorStore((s) => s.objectPaintShape);
  const open = useEditorStore((s) => s.setObjectBrushBar);
  const fillMotion = useTransition('tool.plate.shape');
  const reason = planting ? t('objects.patch_own')
    : picks.some((id) => placesOneAtATime(getCatalogItem(id))) ? t('objects.one_at_a_time')
    : paints ? null : t('objects.row_one_at_a_time');
  const shows = painting && !reason ? 'shape' : 'place';
  const label = reason ?? t('objects.brush');
  const way = t(painting ? 'objects.paint' : 'objects.place');
  // Usable, it stands ready for the speech bubble that points it out (UI-57).
  useShelfBrushSource(useUiPreview() ? null : !reason);
  const reveal = useReveal();
  const grows = !!expands && !reveal.touch && !reason;
  // Grown, the pill names itself; a hover title would only repeat it.
  const name = useNameReveal(label, 'above', grows ? '' : label);
  const wayRef = useRef<HTMLSpanElement>(null);
  const [wayW, setWayW] = useState(0);
  // The word's own box in the row's px, so the frame's zoom never enters it; a font landing late re-measures.
  useObservedSize(() => wayRef.current, ([el]) => {
    const w = el?.offsetWidth ?? 0;
    setWayW((was) => (was === w ? was : w));
  }, [way, !!expands]);
  const width = grows && reveal.shown ? size + Math.min(wayW, expands?.room ?? 0) : size;
  const fade = presence('control.fade', { opacity: 0 }, { reduced });
  return (
    <ActionButton
      {...helpTargetAttr('objects', 'objects-batch')}
      {...tourTargetAttr('shelf-brush')}
      {...name.bind}
      {...(grows ? reveal.bind : {})}
      data-testid="shell-shelf-brush"
      data-expanded={width > size || undefined}
      interaction="action"
      aria-label={label}
      aria-pressed={shows === 'shape'}
      unavailable={!!reason}
      dim="caller"
      fill={shows === 'shape' ? ACTIVE : PLATE}
      fillTransition={fillMotion}
      onClick={() => open(true)}
      style={{
        ...btnReset, position: 'relative', flex: 'none', width, height: size, borderRadius: radii.pill,
        boxShadow: plateShapeEdge(), color: INK, pointerEvents: 'auto',
        cursor: reason ? cursors.blocked : cursors.clickable,
        display: 'flex',
        transition: cssMotion('shelf.brush.expand', ['width'], reduced), ...style,
      }}
    >
      {/* The pill clips its word while it grows; the reach below stands outside the clip. */}
      <span style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', alignItems: 'center', overflow: 'hidden', borderRadius: radii.pill }}>
        <span style={{ flex: 'none', width: size, height: size, display: 'grid', placeItems: 'center', opacity: reason ? UNAVAILABLE : 1 }}>
          <AnimatePresence initial={false}>
            <motion.span key={shows === 'shape' ? `shape-${shape}` : 'place'} {...fade}
              style={{ gridArea: '1 / 1', display: 'grid', placeItems: 'center' }}>
              {shows === 'shape'
                ? <ShapeGlyph shape={shape} scale={(size * GLYPH_SHARE) / (51 * SCALE)} />
                : <GlyphIcon glyph={BRUSH_GLYPHS.place} size={size * GLYPH_SHARE} />}
            </motion.span>
          </AnimatePresence>
        </span>
        {expands ? (
          // Laid out at its own width whether shown or not, so the pill knows how far to grow.
          <span ref={wayRef} aria-hidden style={{
            flex: 'none', paddingRight: size * 0.4, whiteSpace: 'nowrap',
            fontSize: TEXT.tab, fontWeight: weightAt(800, TEXT.tab), lineHeight: 1,
          }}>{way}</span>
        ) : null}
      </span>
      {name.bubble}
      <TouchReach w={size} h={size} zoom={zoom} />
    </ActionButton>
  );
}
