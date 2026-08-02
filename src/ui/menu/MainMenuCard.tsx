/*
 * MainMenuCard.tsx — the "phone" home screen, assembled 1:1 from the design
 * canvas: the load bar, settings/help buttons, the file row, the two build
 * buttons, and the placement + generate grid. Every element is positioned
 * absolutely against the card using the design coordinates in metrics.ts.
 *
 * This is the hub. Tapping a tile dispatches its TileSpec to onAction; the
 * parent decides what each action does (file ops, open build/placement/
 * generate submenu). Settings/help open their modals.
 */
import { useT } from '../../i18n/context';
import { PhoneCard } from './PhoneCard';
import { LoadBar } from './LoadBar';
import { UtilButton } from './UtilButton';
import { MenuTile } from './MenuTile';
import { usePx } from './scale';
import { tourTargetAttr } from '../chrome/tour/steps';
import {
  FILE_TILES,
  BUILD_TILES,
  BUILD_TILE_H,
  GRID_TILES,
  type TileSpec,
} from './metrics';

interface MainMenuCardProps {
  onCollapse: () => void;
  /** Only read while chunk-load enforcement is on; the meter shows N/A otherwise. */
  load?: number;
  loadMax?: number;
  onAction: (spec: TileSpec) => void;
  onSettings: () => void;
  onHelp: () => void;
  /** Background work (generation / agent run) — badges the Generate tile. */
  generateBusy?: boolean;
}

export function MainMenuCard({
  onCollapse,
  load,
  loadMax,
  onAction,
  onSettings,
  onHelp,
  generateBusy,
}: MainMenuCardProps) {
  const t = useT();
  const { px } = usePx();

  return (
    <PhoneCard onCollapse={onCollapse}>
      {/* An empty box over the build + placement tiles: the tour measures this to place its spotlight.
          aria-hidden and pointer-events none, so it is invisible to both the reader and the pointer. */}
      <div
        {...tourTargetAttr('menu-tiles')}
        aria-hidden
        style={{ position: 'absolute', left: px(50), top: px(320), width: px(546), height: px(555), pointerEvents: 'none' }}
      />
      <LoadBar value={load} max={loadMax} />
      <UtilButton kind="gear" onClick={onSettings} ariaLabel={t('menu.settings')} />
      <UtilButton kind="help" onClick={onHelp} ariaLabel={t('menu.help')} />

      {/* labelMaxH = the PSD vertical gap from each row's label to the next
          row/element, so a longer translation's label wraps up to that room
          before shrinking (see MenuTile.TileLabel) — never overlapping the
          next row. FILE_TILES: 340 (BUILD_TILES top) - 273 (labelY) = 67.
          BUILD_TILES: 569 (GRID_TILES top) - 514 (labelY) = 55. GRID_TILES:
          min(737 - 687, 904 [home pill] - 855) = 49, applied to both its rows. */}
      {FILE_TILES.map((spec) => (
        <MenuTile key={spec.id} spec={spec} labelMaxH={67} onSelect={onAction} />
      ))}

      {BUILD_TILES.map((spec) => (
        <MenuTile
          key={spec.id}
          spec={spec}
          height={BUILD_TILE_H}
          iconScale={0.82}
          labelMaxH={55}
          onSelect={onAction}
        />
      ))}

      {GRID_TILES.map((spec) => (
        <MenuTile key={spec.id} spec={spec} labelMaxH={49} onSelect={onAction} busy={spec.id === 'generate' && generateBusy} />
      ))}
    </PhoneCard>
  );
}
