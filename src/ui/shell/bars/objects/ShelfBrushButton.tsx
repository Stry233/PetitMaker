/*
 * The object shelf's round brush button (EDIT-64, EDIT-68, EDIT-69): it opens the brush bar in the
 * shelf's place, armed or not, and wears the way to place it sets, Place's drawing, or with Paint
 * the active fill and the brush shape's drawing. With the planting card or an item placed one at a
 * time armed, or a row showing only such items, it is unavailable and its name says why. On the wide shelf a resting mouse or the
 * keyboard's focus grows it along the row into a pill naming that way.
 */
import { OPTION_GLYPH } from '../OptionPill';
import { useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { useT } from '../../../../i18n/context';
import type { I18nKey } from '../../../../i18n/keys';
import { brushBarRefusal, type BrushBarRefusal } from '../../../../state/object-shelf-view';
import { useEditorStore } from '../../../../state/store';
import { cssMotion, presence } from '../../../design/motion';
import { useTransition } from '../../../design/motion/use-motion';
import { radii, UNAVAILABLE } from '../../../design/styles';
import { ACTIVE, PLATE } from '../../../design/tokens';
import { useNameReveal } from '../../../primitives/use-name-reveal';
import { useObservedSize } from '../../../primitives/use-observed-size';
import { useReveal } from '../../../primitives/use-reveal';
import { helpTargetAttr } from '../../../session/help-targets';
import { useShelfBrushSource } from '../../../session/shelf-brush-standing';
import { useUiPreview } from '../../../design/preview';
import { tourTargetAttr } from '../../../chrome/tour/steps';
import { GlyphIcon } from '../../GlyphIcon';
import { useFrameReadableWeight } from '../../use-frame-zoom';
import { roleSize } from '../../../design/text-weight';
import { ShapeGlyph } from '../ShapeOptions';
import { BRUSH_GLYPHS } from './brush-glyphs';
import { RoundPlateButton } from '../RoundPlateButton';
import { pressCommand } from '../../../../editor/commands/run';

/** What the button's name says for each reason the bar is refused. */
const REFUSAL_WORDS: Record<BrushBarRefusal, I18nKey> = {
  planting: 'objects.patch_own', 'one-at-a-time': 'objects.one_at_a_time', row: 'objects.row_one_at_a_time',
};

/** How big the drawing reads on the button, as a share of its side. */
const GLYPH_SHARE = 0.5;

/** `size` is the button's side in the row's px; `paints` says whether the row shows any item a stroke
 *  can lay; `expands` lets it grow, by `room` px at most, into the pill naming the way to place. */
export function ShelfBrushButton({ size, paints, style, expands }: {
  size: number; paints: boolean; style?: CSSProperties; expands?: { room: number };
}) {
  const t = useT();
  const weightAt = useFrameReadableWeight();
  const reduced = useReducedMotionConfig();
  const refusal = useEditorStore((s) => brushBarRefusal(s, paints));
  const painting = useEditorStore((s) => s.objectBrush === 'paint');
  const shape = useEditorStore((s) => s.objectPaintShape);
  const fillMotion = useTransition('tool.plate.shape');
  const reason = refusal ? t(REFUSAL_WORDS[refusal]) : null;
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
    <RoundPlateButton
      {...helpTargetAttr('objects', 'objects-batch')}
      {...tourTargetAttr('shelf-brush')}
      {...name.bind}
      {...(grows ? reveal.bind : {})}
      data-testid="shell-shelf-brush"
      data-expanded={width > size || undefined}
      size={size}
      width={width}
      aria-label={label}
      aria-pressed={shows === 'shape'}
      unavailable={!!reason}
      dim="caller"
      fill={shows === 'shape' ? ACTIVE : PLATE}
      fillTransition={fillMotion}
      onClick={() => pressCommand('objects.brush_bar', { on: true })}
      style={{ transition: cssMotion('shelf.brush.expand', ['width'], reduced), ...style }}
    >
      {/* The pill clips its word while it grows; the reach below stands outside the clip. */}
      <span style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', alignItems: 'center', overflow: 'hidden', borderRadius: radii.pill }}>
        <span style={{ flex: 'none', width: size, height: size, display: 'grid', placeItems: 'center', opacity: reason ? UNAVAILABLE : 1 }}>
          <AnimatePresence initial={false}>
            <motion.span key={shows === 'shape' ? `shape-${shape}` : 'place'} {...fade}
              style={{ gridArea: '1 / 1', display: 'grid', placeItems: 'center' }}>
              {shows === 'shape'
                ? <ShapeGlyph shape={shape} scale={(size * GLYPH_SHARE) / OPTION_GLYPH} />
                : <GlyphIcon glyph={BRUSH_GLYPHS.place} size={size * GLYPH_SHARE} />}
            </motion.span>
          </AnimatePresence>
        </span>
        {expands ? (
          // Laid out at its own width whether shown or not, so the pill knows how far to grow.
          <span ref={wayRef} aria-hidden style={{
            flex: 'none', paddingRight: size * 0.4, whiteSpace: 'nowrap',
            fontSize: roleSize('label'), fontWeight: weightAt(800, roleSize('label')), lineHeight: 1,
          }}>{way}</span>
        ) : null}
      </span>
      {name.bubble}
    </RoundPlateButton>
  );
}
