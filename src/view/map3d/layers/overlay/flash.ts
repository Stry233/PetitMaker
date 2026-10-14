import * as THREE from 'three';
import type { MacroCoord, ValidationError } from '../../../../core/model/types';
import { cellDecals, rectDecals } from '../../geometry/overlay-decals';
import { FlashPolicy, flashDecay, type ErrorFlashRect, type FlashKind } from '../../../shared/overlay/error-flash';
import { groupByGrid } from '../../../../core/grid/cell-spans';
import { type CellSet, type GridId } from '../../../../core/grid/grids';
import { animConfig } from '../../../shared/motion/anim-config';
import type { OverlayHost3D } from './host';
import { makeMat, toGeo } from './paint';

interface Flash { kind: FlashKind; mesh: THREE.Mesh; geo: THREE.BufferGeometry; mat: THREE.MeshBasicMaterial; bornMs: number; lifeMs: number; peak: number }

/** Which of `spawnFlash`'s two shape forms it was handed: a body carries an extent, a cell does not. */
function isRectList(shapes: MacroCoord[] | readonly ErrorFlashRect[]): shapes is readonly ErrorFlashRect[] {
  return shapes.length > 0 && 'w' in shapes[0]!;
}

/** The refusal and commit flashes: draped decals decaying from a peak through `tick`. */
export class OverlayFlashes3D {
  constructor(private readonly host: OverlayHost3D) {}

  private flashes: Flash[] = [];
  private readonly policy = new FlashPolicy(() => this.host.nowMs());

  flashCommit(sets: readonly CellSet[], opts: { color?: number } = {}): void {
    const plan = this.policy.commit(sets);
    if (!plan) return;
    const { color } = animConfig.flash.commit;
    this.replace('commit');
    // One undo step can hold a terrain change and an object change, which drape on different grids,
    // so each grid gets its own decal.
    for (const [grid, part] of groupByGrid(plan.cells)) {
      this.spawnFlash('commit', part.map((c) => ({ x: c.x, y: c.y })), grid, opts.color ?? color);
    }
  }

  /** The evidence contract: flash the offending cells and bodies (`FlashPolicy`). */
  flashErrors(errors: ValidationError[]): void {
    const plan = this.policy.errors(errors);
    if (!plan) return;
    this.replace('error');
    // Evidence carries its own grid (an object blocking a terrain paint flashes on the placement
    // grid) — split and drape each set on its grid. A body (`rects`) is draped whole, the same exact
    // footprint the 2D overlay fills, rather than as the cells it touches.
    const err = animConfig.flash.error;
    const cellGroups = groupByGrid(plan.cells), bodyGroups = groupByGrid(plan.rects);
    for (const grid of new Set([...cellGroups.keys(), ...bodyGroups.keys()])) {
      const part = cellGroups.get(grid);
      if (part) this.spawnFlash('error', part.map((c) => ({ x: c.x, y: c.y })), grid, err.color);
      const bodies = bodyGroups.get(grid);
      if (bodies) this.spawnFlash('error', bodies, grid, err.color);
    }
  }

  /** Drop the `kind` flash still fading, the policy's latest-wins. */
  private replace(kind: FlashKind): void {
    this.flashes = this.flashes.filter((f) => {
      if (f.kind !== kind) return true;
      this.drop(f);
      return false;
    });
  }

  private drop(f: Flash): void {
    this.host.group.remove(f.mesh);
    f.geo.dispose();
    f.mat.dispose();
  }

  /** One decal of a `kind` flash, at that kind's peak and life (`animConfig.flash`). */
  private spawnFlash(kind: FlashKind, shapes: MacroCoord[] | readonly ErrorFlashRect[], grid: GridId, color: number): void {
    const { durationMs: lifeMs, peakAlpha: peak } = animConfig.flash[kind];
    const state = this.host.state();
    const data = isRectList(shapes)
      ? rectDecals(state, shapes, grid)
      : cellDecals(state, shapes, grid);
    if (!data.positions.length) return;
    const geo = toGeo(data);
    const mat = makeMat(color, peak);
    const mesh = new THREE.Mesh(geo, mat);
    this.host.group.add(mesh);
    this.flashes.push({ kind, mesh, geo, mat, bornMs: this.host.nowMs(), lifeMs, peak });
    this.host.requestRender();
  }

  /** Advance flash decay; true while any flash is alive. */
  tick(): boolean {
    if (this.flashes.length === 0) return false;
    const now = this.host.nowMs();
    this.flashes = this.flashes.filter((f) => {
      const age = (now - f.bornMs) / f.lifeMs;
      if (age >= 1) {
        this.drop(f);
        return false;
      }
      // The 2D flash curve exactly (shared flashDecay): one smooth beat, peak → 0 as (1 − t²).
      f.mat.opacity = flashDecay(f.peak, age);
      return true;
    });
    return this.flashes.length > 0;
  }

  dispose(): void {
    for (const f of this.flashes) this.drop(f);
    this.flashes = [];
  }
}
