import type * as THREE from 'three';
import type { GridState } from '../../../../core/model/types';
import type { GlQuality } from '../../../../platform/device/device-quality';
import type { BoxMaterials } from './paint';

/** What every 3D overlay part reads from the overlay that holds it. */
export interface OverlayHost3D {
  /** The one scene group every part adds its meshes to. */
  readonly group: THREE.Group;
  readonly mats: BoxMaterials;
  state(): GridState;
  requestRender(): void;
  nowMs(): number;
  modelQuality(): GlQuality;
  objectBox(id: string): THREE.Box3 | null;
  /** Whether a move preview is showing, which hides the selection shadows. */
  moving(): boolean;
}
