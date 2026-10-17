import * as THREE from 'three';
import type { PlacedObject } from '../../../../core/model/types';
import { flatOutline, footprintMark, isFlatBody, underLandmark } from '../../geometry/object-marks';
import { ribbonStrips } from '../../geometry/ink-path';
import { FLAG_MARK, GHOST_LOSS } from '../../../shared/viewport/view-constants';
import { BodyOutlines3D, type BodyOutlineLook } from '../body-outlines';
import { footprintShadow } from './boxes';
import type { OverlayHost3D } from './host';

/** The flagged body's outline: the move origin's contour, solid, in the loss red at the 2D edge's
 *  width. The body itself keeps its colours, as the 2D sprite does over its wash. */
const FLAG_OUTLINE: BodyOutlineLook = {
  stroke: GHOST_LOSS, opacity: 1, width: FLAG_MARK.edgePx, dash: null, fill: GHOST_LOSS, fillOpacity: 0, name: 'flagged',
};
/** The shadows' place in the overlay, which draws after every scene body: over the other decals and
 *  under the outlines (`body-outlines.ts` fills at 3, strokes at 4). */
const SHADOW_ORDER = 2;

/** A flat body's outline, in cells across: the 2D edge's weight at the zoom a repair is worked at. */
const FLAT_EDGE = 0.06;

/** A flag's paint: `xray` ignores depth, so the flag stands over whatever stands over the object;
 *  otherwise it is seated, hidden where the ground or a body stands in front of it, and wins the
 *  depth tie with the face it lies flush on. */
function flagMaterial<T extends THREE.MeshBasicMaterial | THREE.LineBasicMaterial>(mat: T, xray: boolean): T {
  mat.depthTest = !xray;
  mat.depthWrite = false;
  mat.transparent = true;
  if (!xray) { mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -1; }
  mat.color.setHex(GHOST_LOSS).convertSRGBToLinear();
  return mat;
}

const washOf = (xray: boolean) => flagMaterial(new THREE.MeshBasicMaterial({ opacity: FLAG_MARK.wash, side: THREE.DoubleSide }), xray);
const edgeOf = (xray: boolean) => flagMaterial(new THREE.LineBasicMaterial({ opacity: 1 }), xray);
const lineOf = (xray: boolean) => flagMaterial(new THREE.MeshBasicMaterial({ opacity: 1, side: THREE.DoubleSide }), xray);

/**
 * Objects flagged as standing where they may not, as the 2D overlay draws them, each mark where the
 * object's visible geometry is: the footprint's ground mark (the selection shadow's,
 * `boxes.ts:footprintShadow` over `geometry/object-marks.ts:footprintMark`) washed and edged in the
 * loss red, and the outline in it: a body's screen-space outline (the move origin's,
 * `body-outlines.ts`), or a flat coating's face edge, a ribbon on the face. The ground marks are
 * seated in the scene, except under a landmark, whose model would hide them; there they and every
 * body outline are drawn over the scene, so an object under a landmark shows whole.
 */
export class OverlayFlagged3D {
  private readonly outlines: BodyOutlines3D;

  constructor(
    private readonly host: OverlayHost3D, camera?: THREE.Camera, viewport?: () => { width: number; height: number },
  ) {
    this.outlines = new BodyOutlines3D(host.group, { camera, viewport, nowMs: () => host.nowMs(), modelQuality: () => host.modelQuality() }, FLAG_OUTLINE);
  }

  private readonly mats = {
    seated: { wash: washOf(false), edge: edgeOf(false), line: lineOf(false) },
    xray: { wash: washOf(true), edge: edgeOf(true), line: lineOf(true) },
  };
  private flagged: readonly PlacedObject[] = [];
  private pending = false;
  private drawn: (THREE.Mesh | THREE.LineSegments)[] = [];

  /** Deferred to `flush`, which runs once the scene has remeshed the ground the shadows drape on. */
  show(objects: readonly PlacedObject[] | null): void {
    this.flagged = objects ?? [];
    this.pending = true;
    this.host.requestRender();
  }

  flush(): void {
    if (this.pending) {
      this.pending = false;
      this.clear();
      const s = this.host.state();
      this.outlines.show(s, this.flagged.filter((o) => !isFlatBody(o)).map((o) => o.id));
      for (const o of this.flagged) {
        const paint = underLandmark(s, o) ? this.mats.xray : this.mats.seated;
        const { fill, rim } = footprintShadow(footprintMark(s, o), 0);
        const parts: (THREE.Mesh | THREE.LineSegments)[] = [new THREE.Mesh(fill, paint.wash), new THREE.LineSegments(rim, paint.edge)];
        const ribbon = isFlatBody(o) ? ribbonStrips([flatOutline(s, o)], FLAT_EDGE) : null;
        if (ribbon) {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(ribbon.positions, 3));
          geo.setIndex(ribbon.index);
          parts.push(new THREE.Mesh(geo, paint.line));
        }
        for (const part of parts) part.renderOrder = SHADOW_ORDER;
        this.host.group.add(...parts);
        this.drawn.push(...parts);
      }
      this.host.requestRender();
    }
    this.outlines.update();
  }

  /** Advances the outlines' fade; true while one runs. */
  tick(): boolean {
    return this.outlines.tick();
  }

  private clear(): void {
    for (const d of this.drawn) {
      this.host.group.remove(d);
      d.geometry.dispose();
    }
    this.drawn = [];
  }

  dispose(): void {
    this.clear();
    this.outlines.dispose();
    for (const set of Object.values(this.mats)) for (const m of Object.values(set)) m.dispose();
  }
}
