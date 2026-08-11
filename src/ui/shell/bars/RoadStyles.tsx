/*
 * RoadStyles.tsx — which surface the road brush lays: one swatch per Road item, above 路面's tools.
 *
 * The row is READ FROM THE CATALOG, never from a table here: a road item carries a `color` where
 * every other item carries a sprite, and its name is its own `name` map, so a fifth surface joins
 * this row by existing. That is also why the swatches are drawn rather than taken from the design
 * source, which coloured all four the same brown as a placeholder.
 *
 * The chosen one is marked the way everything else in this frame marks a choice: its plate takes
 * the active yellow. There is no third idiom here and no drawn selected state to copy.
 *
 * `tileMaterial` is where the armed surface already lives — the tile brush reads it through
 * `paint-plan`, and it is not one of the four facts `resolveEditMode` derives, so this row writes
 * the store's own `setTileMaterial` rather than adding a second home for the same answer. A press
 * here is also the one thing that makes the choice a CHOICE (`tileMaterialPicked`): until then the
 * highlight stands on the catalog's first road because something has to be armed, and the road
 * macros take their surface from the map instead.
 */
import { motion } from 'framer-motion';
import { localizedName, useT } from '../../../i18n/context';
import { getRoadMaterials } from '../../../state/catalog';
import { useEditorStore } from '../../../state/store';
import { btnReset, cursors, pressable } from '../../design/styles';
import { ACTIVE, PLATE } from '../../design/tokens';
import { SCALE } from '../units';
import { ACTIVE_PLATE, ROAD_STYLE } from './terrain-cells';

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

export function RoadStyles() {
  const t = useT();
  const locale = useEditorStore((s) => s.locale);
  const tileMaterial = useEditorStore((s) => s.tileMaterial);
  const setTileMaterial = useEditorStore((s) => s.setTileMaterial);
  return (
    <div
      role="group"
      aria-label={t('design.road_surface')}
      style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: GAP }}
    >
      {getRoadMaterials().map((item) => {
        const active = item.id === tileMaterial;
        return (
          <motion.button
            key={item.id}
            type="button"
            {...pressable}
            aria-label={localizedName(item.name, locale)}
            title={localizedName(item.name, locale)}
            aria-pressed={active}
            onClick={() => setTileMaterial(item.id)}
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
            <span
              style={{
                position: 'relative',
                width: INNER, height: INNER, borderRadius: INNER * ROUND,
                background: item.color ?? PLATE,
              }}
            />
          </motion.button>
        );
      })}
    </div>
  );
}
