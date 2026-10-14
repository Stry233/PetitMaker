/** Catalog swatches share native scrolling and portal tooltips, so hover art can extend beyond the row.
 * Picking a material marks tileMaterialPicked; until then road macros infer their material from the map. */
import { TILE, GAP, INNER, ROUND, GROW, SLACK, useSwatchStripRow } from '../swatch-strip';
import { ActionButton } from '../../../primitives/ActionButton';
import { useRef, useState, type ReactNode } from 'react';
import { ContentSwap } from './ContentSwap';
import { SwapIcon } from '../../../primitives/line-glyphs';
import { iconUrl } from '../../../../assets/icon-urls';
import { localizedName, useLocale, useT } from '../../../../i18n/context';
import { isSurfacePrint } from '../../../../core/model/traits';
import { getRoadMaterials, getCatalogItem } from '../../../../state/catalog';
import { useEditorStore } from '../../../../state/store';
import { btnReset, cursors, z } from '../../../design/styles';
import { ACTIVE, PLATE, DARK_PLATE, PLATE_INK } from '../../../design/tokens';
import { SHELF_SCALE } from '../../units';
import { CardNameBubble, type CardNameReach } from '../CardNameBubble';
import { ROW } from '../objects/object-shelf';
import { useRailClearance } from '../../frame-layout';
import { SWATCH_ROW_BOTTOM } from '../ToolRow';
import { cssMotion } from '../../../design/motion';

/** The row's negative top margin collapses out of its wrapper. The name keeps the shelf's
 *  clearance above the hovered plate, including the additional overhang. */
const NAME_LIFT = ROW.pad * SHELF_SCALE + SLACK - GROW;

/** One swatch of a material strip: its art where it has one, else its flat colour. */
export interface MaterialSwatch {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  art?: ReactNode;
  rotation?: number;
  transparent?: boolean;
}

export function RoadStyles() {
  const t = useT();
  const locale = useLocale();
  const tileMaterial = useEditorStore((s) => s.tileMaterial);
  const setTileMaterial = useEditorStore((s) => s.setTileMaterial);
  const rotation = useEditorStore(s => s.placementRotation);
  const prints = isSurfacePrint(getCatalogItem(tileMaterial));
  // Each family remembers the material last chosen in it, written as the switch leaves it.
  const remembered = useRef<[string | undefined, string | undefined]>([undefined, undefined]);
  const swatches = getRoadMaterials(prints).map((item): MaterialSwatch => ({
    id: item.id, name: localizedName(item.name, locale), icon: item.icon ? iconUrl(item.icon) : undefined, color: item.color,
    transparent: prints, rotation: prints && item.id === tileMaterial ? rotation : 0,
  }));
  const toggle = () => {
    remembered.current[prints ? 1 : 0] = tileMaterial;
    const next = remembered.current[prints ? 0 : 1] ?? getRoadMaterials(!prints)[0]?.id;
    if (next) setTileMaterial(next);
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: GAP, pointerEvents: 'auto' }}>
      <SurfaceSwitch prints={prints} onToggle={toggle} />
      <ContentSwap contentKey={prints ? 'prints' : 'roads'} travel style={{ flex: 1, minWidth: 0 }}>
        <MaterialStrip label={t(prints ? 'design.surface_prints' : 'design.road_surface')} swatches={swatches} active={tileMaterial} onPick={setTileMaterial} />
      </ContentSwap>
    </div>
  );
}

/** The swatch strip above a tool row: which material the brush lays. The road surfaces and the
 *  planet session's ground materials share it. */
export function MaterialStrip({ label, swatches, active: activeId, onPick }: {
  label: string;
  swatches: readonly MaterialSwatch[];
  active: string;
  onPick: (id: string) => void;
}) {
  const clearance = useRailClearance(SWATCH_ROW_BOTTOM, TILE);
  const [reached, setReached] = useState<CardNameReach | null>(null);
  const { rowRef, rowProps } = useSwatchStripRow('auto');

  const reach = (el: HTMLButtonElement, name: string): void => {
    const scrollLeft = rowRef.current?.scrollLeft ?? 0;
    // `- SLACK` undoes the row's own negative-margin overhang (see `SLACK` above): without it the
    // bubble lands `SLACK` px right of the swatch it names, at every scroll offset.
    setReached({ name, centre: el.offsetLeft + el.offsetWidth / 2 - scrollLeft - SLACK });
  };

  return (
    <div style={{
      position: 'relative',
      marginRight: clearance,
      transition: cssMotion('frame.layout.adapt', ['margin-right']),
    }}>
      <div
        ref={rowRef}
        role="group"
        aria-label={label}
        {...rowProps}
      >
        {swatches.map((item) => (
          <MaterialTile key={item.id} item={item} active={item.id === activeId}
            onPick={() => onPick(item.id)} onReach={reach} onLeave={() => setReached(null)} />
        ))}
      </div>

      <CardNameBubble reached={reached} lift={NAME_LIFT} />
    </div>
  );
}

function SurfaceSwitch({ prints, onToggle }: { prints: boolean; onToggle: () => void }) {
  const t = useT();
  const [hovered, setHovered] = useState(false);
  const item = { id: 'surface-switch', name: t(prints ? 'design.switch_to_roads' : 'design.switch_to_prints'), art: <SwapIcon size={INNER * 0.65} /> };
  return (
    <div style={{ position: 'relative', flex: 'none', zIndex: z.panel }}>
      <MaterialTile item={item} onPick={onToggle} onReach={() => setHovered(true)} onLeave={() => setHovered(false)} />
      <CardNameBubble reached={hovered ? { name: item.name, centre: TILE / 2 } : null} lift={NAME_LIFT} />
    </div>
  );
}

function MaterialTile({ item, active, onPick, onReach, onLeave }: {
  item: MaterialSwatch;
  active?: boolean;
  onPick: () => void;
  onReach: (el: HTMLButtonElement, name: string) => void;
  onLeave: () => void;
}) {
  const { name, icon } = item;
  return (
    <ActionButton
      interaction="tile"
      aria-label={name}
      aria-pressed={active}
      onClick={onPick}
      onPointerEnter={(e) => onReach(e.currentTarget, name)}
      onPointerLeave={onLeave}
      onFocus={(e) => onReach(e.currentTarget, name)}
      onBlur={onLeave}
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
      {item.art ? (
        <span aria-hidden="true" style={{ position: 'relative', display: 'flex', color: PLATE_INK }}>{item.art}</span>
      ) : icon ? (
        <img
          src={icon}
          alt=""
          draggable={false}
          style={{
            position: 'relative',
            width: INNER, height: INNER, borderRadius: INNER * ROUND,
            background: item.transparent ? DARK_PLATE : undefined,
            objectFit: 'cover', transform: `rotate(${item.rotation ?? 0}deg)`,
            transition: cssMotion('frame.layout.adapt', ['transform']),
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
    </ActionButton>
  );
}