/*
 * RoadStyles.tsx — which surface the road brush lays: one swatch per Road item, above 路面's tools.
 *
 * The row is READ FROM THE CATALOG, never from a table here: a road item carries an `icon` of its
 * own plus the `color` derived from it, so a new surface joins this row by existing. The swatch
 * shows the icon where the catalog gives one and falls back to the flat colour where it does not.
 *
 * The chosen one is marked the way everything else in this frame marks a choice: its plate takes
 * the active yellow. There is no third idiom here and no drawn selected state to copy.
 *
 * THE ROW SCROLLS. 25 surfaces are wider than the terrain bar has room for beside its tool row, so
 * this is a native scroll container answering a wheel the way the object shelf's own rows do
 * (`row-scroll.ts`), rather than wrapping onto a second line that would push the tools under it
 * down the screen.
 *
 * The hovered swatch's NAME floats above the strip, the same component the object shelf draws its
 * card names with (`CardNameBubble`): a scroll container clips on both axes, so a label standing
 * over a tile inside it would be cut in half.
 *
 * `tileMaterial` is where the armed surface already lives — the tile brush reads it through
 * `paint-plan`, and it is not one of the four facts `resolveEditMode` derives, so this row writes
 * the store's own `setTileMaterial` rather than adding a second home for the same answer. A press
 * here is also the one thing that makes the choice a CHOICE (`tileMaterialPicked`): until then the
 * highlight stands on the catalog's first road because something has to be armed, and the road
 * macros take their surface from the map instead.
 */
import { motion, useReducedMotionConfig } from 'framer-motion';
import { useRef, useState, type CSSProperties, type RefObject, type WheelEvent } from 'react';
import { iconUrl } from '../../../assets/icon-urls';
import { localizedName, useT } from '../../../i18n/context';
import { getRoadMaterials } from '../../../state/catalog';
import { useEditorStore } from '../../../state/store';
import { useScrollFade } from '../../primitives/scroll-fade';
import { btnReset, cursors, pressable, z } from '../../design/styles';
import { ACTIVE, PLATE } from '../../design/tokens';
import { SCALE, SHELF_SCALE } from '../units';
import { ACTIVE_PLATE, ROAD_STYLE } from './terrain-cells';
import { CardNameBubble, type CardNameReach } from './CardNameBubble';
import { ROW } from './object-shelf';
import { useFrameZoom, wheelGlider, wheelPush } from './row-scroll';
import { useRailClearance } from '../frame-layout';
import { SWATCH_ROW_BOTTOM } from './ToolRow';
import { cssMotion } from '../motion/use-motion';

/** The tile as it lands on screen, and the air between two of them. */
const TILE = ROAD_STYLE.size * SCALE;
const GAP = (ROAD_STYLE.pitch - ROAD_STYLE.size) * SCALE;
const INNER = (ROAD_STYLE.size - 2 * ROAD_STYLE.inset) * SCALE;
/** The drawing's corner as a proportion of the square it turns, so the inner one is not rounded
 *  harder than the outer just because it is smaller. */
const ROUND = ROAD_STYLE.radius / ROAD_STYLE.size;
/** How far the chosen tile's plate grows past its box, the way a chosen tool cell's does. The
 *  swatch is nearly all colour, so recolouring the plate alone leaves a ring four pixels wide to
 *  carry the whole answer; the plate is drawn behind the box rather than in it, so the tile does
 *  not move and neither do its neighbours. */
const GROW = ACTIVE_PLATE.dy * SCALE;

/** Room for the hovered active plate, plus spring overshoot and pixel rounding. Negative margins
 *  retain tile alignment; tooltip coordinates subtract this same scroll-container overhang. */
const SLACK = Math.ceil((TILE / 2 + GROW) * pressable.whileHover.scale - TILE / 2) + 1;

/**
 * How far a swatch is softened at an end the row can still travel toward, in css px: ONE WHOLE
 * SWATCH.
 *
 * Wider than the 24 px the shelf rows take (`primitives/scroll-fade.ts:SCROLL_FADE`, and
 * `ShelfTabs`'s own), and deliberately so: those cover a 99 px card and a word standing on the map,
 * where a quarter of the thing is enough to read as dissolve. A swatch is 56 px of flat colour with
 * a hard rounded edge, so a quarter of it is a colour going slightly pale and then a straight cut —
 * the very thing the shade exists to stop. Over a whole swatch the row's last surface fades out
 * across its own width, which is also what keeps a tile from arriving at full strength immediately
 * under the chrome the strip runs beneath.
 */
const FADE = TILE;

/** The row's negative top margin collapses out of its wrapper. The name keeps the shelf's
 *  clearance above the hovered plate, including the additional overhang. */
const NAME_LIFT = ROW.pad * SHELF_SCALE + SLACK - GROW;

/** The fade is one width at both ends and at every offset: unlike the row of names, every swatch is
 *  the same size and sits at the same pitch, so there is no gutter for a fixed width to land in. */
const fadeAt = (): number => FADE;

/** Shared scrolling and hover clearance for road and annotation swatches. Only the tiles receive
 *  pointer input; padding and gaps leave the canvas reachable. */
export function useSwatchStripRow(): {
  rowRef: RefObject<HTMLDivElement>;
  rowProps: { className: string; onWheel: (e: WheelEvent<HTMLDivElement>) => void; style: CSSProperties };
} {
  const rowRef = useRef<HTMLDivElement>(null!);
  const zoom = useFrameZoom();
  const reducedMotion = useReducedMotionConfig() ?? false;
  const glide = useRef(wheelGlider()).current;
  // Only an end the row can still travel toward is shaded, so at either stop the outermost swatch —
  // grown plate, `SLACK` overhang and all — meets the edge at full strength.
  const rowFade = useScrollFade(rowRef, 'x', { fadeAt });
  return {
    rowRef,
    rowProps: {
      className: 'pw-noscroll',
      onWheel: (e) => {
        const row = e.currentTarget;
        // A row that fits its content has no room to give the wheel, same rule the shelf rows
        // answer it by.
        const room = row.scrollWidth - row.clientWidth;
        const push = room > 0 ? wheelPush(e, row.clientWidth, zoom) : null;
        if (push) glide.wheel(row, push.by, reducedMotion);
      },
      style: {
        position: 'relative', display: 'flex', alignItems: 'flex-end', flexWrap: 'nowrap',
        gap: GAP, overflowX: 'auto', overflowY: 'hidden',
        padding: SLACK, margin: -SLACK,
        // Hovered plates remain above the following tool row's transparent scroll padding.
        zIndex: z.panel,
        pointerEvents: 'none',
        ...rowFade,
      },
    },
  };
}

export function RoadStyles() {
  const t = useT();
  const clearance = useRailClearance(SWATCH_ROW_BOTTOM, TILE);
  const locale = useEditorStore((s) => s.locale);
  const tileMaterial = useEditorStore((s) => s.tileMaterial);
  const setTileMaterial = useEditorStore((s) => s.setTileMaterial);
  const [reached, setReached] = useState<CardNameReach | null>(null);
  const { rowRef, rowProps } = useSwatchStripRow();

  const reach = (el: HTMLButtonElement, name: string): void => {
    const scrollLeft = rowRef.current?.scrollLeft ?? 0;
    // `- SLACK` undoes the row's own negative-margin overhang (see SLACK above): without it the
    // bubble lands SLACK px right of the swatch it names, at every scroll offset.
    setReached({ name, centre: el.offsetLeft + el.offsetWidth / 2 - scrollLeft - SLACK });
  };

  return (
    <div style={{
      position: 'relative',
      marginRight: clearance,
      transition: cssMotion('frame.layout.adapt', 'margin-right'),
    }}>
      <div
        ref={rowRef}
        role="group"
        aria-label={t('design.road_surface')}
        {...rowProps}
      >
        {getRoadMaterials().map((item) => {
          const active = item.id === tileMaterial;
          const name = localizedName(item.name, locale);
          const icon = item.icon ? iconUrl(item.icon) : undefined;
          return (
            <motion.button
              key={item.id}
              type="button"
              {...pressable}
              aria-label={name}
              aria-pressed={active}
              onClick={() => setTileMaterial(item.id)}
              onPointerEnter={(e) => reach(e.currentTarget, name)}
              onPointerLeave={() => setReached(null)}
              onFocus={(e) => reach(e.currentTarget, name)}
              onBlur={() => setReached(null)}
              style={{
                ...btnReset, position: 'relative', flex: 'none', overflow: 'visible',
                pointerEvents: 'auto', cursor: cursors.clickable,
                width: TILE, height: TILE,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <span
                style={{
                  position: 'absolute', background: active ? ACTIVE : PLATE,
                  ...(active
                    ? { inset: -GROW, borderRadius: (TILE + 2 * GROW) * ROUND }
                    : { inset: 0, borderRadius: TILE * ROUND }),
                }}
              />
              {icon ? (
                <img
                  src={icon}
                  alt=""
                  draggable={false}
                  style={{
                    position: 'relative',
                    width: INNER, height: INNER, borderRadius: INNER * ROUND,
                    objectFit: 'cover',
                  }}
                />
              ) : (
                <span
                  style={{
                    position: 'relative',
                    width: INNER, height: INNER, borderRadius: INNER * ROUND,
                    background: item.color ?? PLATE,
                  }}
                />
              )}
            </motion.button>
          );
        })}
      </div>

      <CardNameBubble reached={reached} lift={NAME_LIFT} />
    </div>
  );
}
