/*
 * ToolCell.tsx — one cell of a tool row: the plate, the drawing on it, its shortcut badge and, while
 * it is the chosen one, its name under it on the map.
 *
 * TWO ROWS ARE MADE OF THESE and they are the same row: the terrain bar's seven tools, and the
 * scope screen's six. The scope screen wears the terrain bar's layout exactly — same cell size, same
 * shortcut keys — so it is this component or it is a second drawing of one thing.
 *
 * THE CELL BOX IS WHAT THE ROW IS MADE OF, and the plate is a drawing on it.
 *
 * The wrapper below is the cell box and nothing else: fixed height, and as wide as the cell plus
 * whatever control it is holding. Everything the plate does past that box — the eight px it grows by
 * when chosen, the pill it opens into — is an ABSOLUTE span reaching outside it, so the row's own
 * height and line never move. Growth carried by the wrapper's own height cannot be fully pulled
 * back by a margin: the half above the line goes unaccounted and the whole row lifts with it.
 *
 * THE NAME AND THE BADGE BELONG TO THE CELL, NOT TO THE BUTTON. Hung off the button they would ride
 * its hover pop, and a key and a name are labels on the cell rather than the tool answering the
 * pointer. Where they sit differs, because they answer to different edges: the name is centred on
 * the cell's own box, and the badge rides the PLATE's right edge, which is the shape that grows.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { btnReset, cursors, pressable } from '../../design/styles';
import { MAP_LABEL } from '../../design/tokens';
import type { Glyph } from '../frame';
import { GlyphIcon } from '../GlyphIcon';
import { captionShift, MODE, SCALE, TEXT } from '../units';
import { STILL, useMotion } from '../motion/use-motion';
import { AutoTrim, CHIP_FOLDED_W, CHIP_INSET } from './AutoTrim';
import { EraserShapeChip } from './EraserShapeChip';
import { ShortcutBadge } from './bar-atoms';
import { CAPTION, CELL, GLYPH, plateShape } from './terrain-cells';

/** The cell as it lands on screen. */
export const CELL_BOX = { w: CELL.w * SCALE, h: CELL.h * SCALE } as const;

/** From the cell's own bottom edge to the top of its name, in css px. */
const CAPTION_GAP = Math.round((CAPTION.y - (CELL.y + CELL.h)) * SCALE);

/** The active cell's name, under it and on the map: the same treatment the mode row's caption wears
 *  at this control's own size, so one interface reads as one interface. A tool is not a mode, and
 *  the design source sizes the two captions apart. */
const caption: CSSProperties = {
  position: 'absolute', left: '50%', ...MAP_LABEL,
  fontSize: TEXT.label, fontWeight: MODE.label.weight,
  whiteSpace: 'nowrap', pointerEvents: 'none',
};

/**
 * How far a grown cell's centre stands right of its cell box's, at its NARROWEST, in css px.
 *
 * The name under a cell is centred on the cell's own box by css (`left: 50%` of it), so it follows
 * the pill's width for free. What css cannot do is the CLAMP that keeps a long name on screen, which
 * needs the centre as a number — so it is taken at the folded width, the one the pill spends most of
 * its time at. A name short enough not to clamp is centred exactly at every width; a name long
 * enough to clamp is held a little right of the frame's margin while the pill is open, never left.
 */
const PILL_CENTRE_SHIFT = (CHIP_FOLDED_W + CHIP_INSET) / 2;

/** The auto-trim chip, which is the only control a cell carries today. Named here so a row asks for
 *  it by what it is rather than by building it. */
export const AUTO_TRIM = <AutoTrim />;
/** The eraser's shape chip, the second of the settings a cell can carry. */
export const ERASER_SHAPE = <EraserShapeChip />;

export function ToolCell({ glyph, label, commandId, active, centre, onSelect, carries }: {
  glyph: Glyph;
  /** Accessible name, and the name shown under the cell while it is the active one. */
  label: string;
  /** The keyboard command that does the same thing. Its LIVE binding is the cell's badge, so a
   *  rebind shows on the row without the row knowing what the keys are. */
  commandId: string;
  active: boolean;
  /** Where this cell's own centre stands from the frame's left edge, which is what the name under
   *  it is kept on screen by. */
  centre: number;
  onSelect: () => void;
  /** A control the cell's plate grows into a pill to hold, while this cell is the active one. */
  carries?: ReactNode;
}) {
  const shape = useMotion('tool.plate.shape');
  const grown = active && carries != null;

  /*
   * HOW WIDE THE CARRIED CONTROL IS, in css px, and how the clip around it should get there.
   *
   * MEASURED, never `width: 'auto'`: Framer resolves `auto` with a client rect, and the frame is
   * drawn under a page zoom — measured in the browser, the pill opened 13 px past its own edge and
   * snapped back, which is that zoom exactly. `offsetWidth` is in the css px the width is set in.
   *
   * It OPENS on the plate's motion and then simply follows: the chip inside folds its own word away
   * on its own clock, and a second spring chasing that trails it by its own response time, which
   * shows as the pill gaping or the word arriving clipped. The seed is the folded chip in its
   * inset, which is the width the pill opens at, so the first open has a real target before
   * anything has been measured.
   */
  const [carryW, setCarryW] = useState(CHIP_FOLDED_W + 2 * CHIP_INSET);
  const carryRef = useRef<HTMLSpanElement>(null);
  const wasGrown = useRef(grown);
  const opening = useRef(false);
  if (wasGrown.current !== grown) {
    wasGrown.current = grown;
    opening.current = grown;
  }
  useLayoutEffect(() => {
    const el = carryRef.current;
    if (!el) return;
    const measure = () => setCarryW(el.offsetWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [grown]);

  return (
    <div
      style={{
        position: 'relative', flex: 'none', display: 'flex', alignItems: 'center',
        height: CELL_BOX.h,
      }}
    >
      {/* Before the button and absolutely placed, so it paints under the glyph and takes no room. */}
      <motion.span
        aria-hidden
        initial={false}
        animate={plateShape(active, grown)}
        transition={shape}
        style={{ position: 'absolute', borderRadius: 999 }}
      />
      <motion.button
        type="button"
        {...pressable}
        aria-label={label}
        aria-pressed={active}
        onClick={onSelect}
        style={{
          ...btnReset, position: 'relative', flex: 'none', overflow: 'visible',
          pointerEvents: 'auto', cursor: cursors.clickable,
          width: CELL_BOX.w, height: CELL_BOX.h,
          // The plate under it is a pill, and a focus ring follows its own element's corner: on a
          // square box the ring cut straight through the shape the eye reads as the button.
          borderRadius: 999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <GlyphIcon glyph={glyph} size={GLYPH * SCALE} />
      </motion.button>
      {/*
        THE CONTROL OPENS THE PILL AND THE ROW FOLLOWS. The clip box is what the cell's layout width
        grows by, so the cells after it slide rather than jump — that is the whole of the width
        transition, since flex reads the animated number every frame.

        `alignSelf: stretch` gives the clip the cell's full height, so the chip's hover pop is not
        shaved by a box drawn to the chip's own size.

        THE INSET IS ON BOTH SIDES OF THE CLIP, and the box is pulled back left by the one it gained:
        the chip stands where it stood and the cell grows by what it grew by, but the pop now has the
        same room to grow into on the left as on the right. With the padding on the right only, the
        hover pop's left half had nowhere to go and was shaved off — measured at 1.9 px against 8 of
        slack on the other side. The width the fold closes to is that inset rather than zero, which
        is what keeps the cell's own contribution at zero once the negative margin is counted.

        AND THE CONTROL IS HELD AT THE CLOSING EDGE, which is what decides WHERE it is cut. Held at
        the opening edge it stayed put while the box's right edge swept across it, so the box cut it
        on the side it shares with the plate's own end — and a box narrower than it is tall has its
        corner radius clamped to half its width, which is a smaller curve than the plate's, so the
        cut left square ears standing outside the pill with nothing behind them. That is what a
        closing pill looked like. Held at the closing edge instead, the chip travels with that edge,
        keeps its inset from it, and is cut on the LEFT — a line inside the plate, over the plate,
        which is the one place a cut can be made without a shape to hide it. The rounded clip is what
        makes that line a curve rather than a chord.
      */}
      <AnimatePresence initial={false}>
        {grown ? (
          <motion.span
            key="carry"
            initial={{ width: CHIP_INSET }}
            animate={{ width: carryW }}
            exit={{ width: CHIP_INSET, transition: shape }}
            transition={opening.current ? shape : STILL}
            onAnimationComplete={() => { opening.current = false; }}
            style={{
              position: 'relative', alignSelf: 'stretch', flex: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden',
              marginLeft: -CHIP_INSET, borderRadius: 999,
            }}
          >
            <span ref={carryRef} style={{ display: 'flex', flex: 'none', padding: `0 ${CHIP_INSET}px` }}>
              {carries}
            </span>
          </motion.span>
        ) : null}
      </AnimatePresence>
      <ShortcutBadge commandId={commandId} active={active} grown={grown} />
      {active ? (
        <span style={{
          ...caption,
          transform: captionShift(grown ? centre + PILL_CENTRE_SHIFT : centre),
          top: `calc(100% + ${CAPTION_GAP}px)`,
        }}>
          {label}
        </span>
      ) : null}
    </div>
  );
}
