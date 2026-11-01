/** The marks a Help scene shows through the app's own overlay, object and annotation layers: ghosts,
 *  selections, bands, regions, routes, plops and spins, so a pictured mark is the real one. */
import type { MapRenderer } from '../../../view/map2d/scene/map-renderer';
import { annotationInkScale } from '../../../core/model/annotation/text-metrics';
import { cellSet } from '../../../core/grid/grids';
import { PLACEMENT_GRID, TERRAIN_GRID } from '../../../core/game/profile';
import { noteTagLabel } from '../../../view/shared/annotation/draw-options';
import type { SandboxWorld } from '../../../editor/sandbox/demo-world';
import type { Furniture } from './demo-player';
import type { DemoView } from './scenes';

interface DemoViewHost {
  renderer: MapRenderer;
  world: SandboxWorld;
  /** Whether the figure stands still under reduced motion, where plops and spins do not play. */
  still: () => boolean;
  holdGhost: (on: boolean) => void;
  furniture: (patch: Partial<Furniture>) => void;
}

export function createDemoView({ renderer, world, still, holdGhost, furniture }: DemoViewHost): DemoView {
  const view = renderer.asEditorView();
  const overlay = () => view.overlay;
  const notes = () => {
    renderer.drawAnnotations(world.state.annotations ?? null, {
      draft: world.annotationDraft, selectionIds: world.annotationSelection, inkScale: annotationInkScale(world.state.template),
      tagLabel: noteTagLabel(world.state),
    });
    renderer.requestRender();
  };
  world.watchNotes(notes);
  return {
    clearGhost: () => { overlay().clearGhost(); holdGhost(false); },
    groupGhost: (members) => { overlay().showGroupPlacementGhost(members, true); holdGhost(true); },
    paintGhost: (cells, icon = 'mountain') => {
      if (cells) { overlay().showGhost(cellSet(icon === 'ground' ? PLACEMENT_GRID : TERRAIN_GRID, cells), { icon, valid: true }); holdGhost(true); }
      else { overlay().clearGhost(); holdGhost(false); }
    },
    region: (cells) => {
      if (cells) overlay().showBuildableRegion(cellSet(TERRAIN_GRID, cells));
      else overlay().clearBuildableRegion();
    },
    route: (cells) => {
      if (cells) overlay().showPath(cellSet(TERRAIN_GRID, cells));
      else overlay().clearPath();
    },
    marks: (ends) => { furniture({ marks: ends }); },
    loadMeter: (on) => { furniture({ loadMeter: on }); },
    // An info notice reads as the app's plain toast; a warning as the toast a refusal shows.
    notice: (n) => {
      furniture({
        toast: !n ? null : n.tone === 'info'
          ? { kind: 'key', key: n.key, ...(n.params ? { params: n.params } : {}) }
          : { kind: 'refusal', message: n.key, ...(n.params ? { params: n.params } : {}), tone: 'warning' },
      });
    },
    plop: (id) => { if (!still()) view.plopObject(id); },
    poof: (id) => { if (!still()) view.animateRemove?.(id); },
    spin: (id, fromDeg, toDeg) => { if (!still()) view.animateRotation(id, fromDeg, toDeg); },
    groupSpin: (turn) => { if (!still()) view.animateGroupRotation(turn); },
    annotations: notes,
  };
}
