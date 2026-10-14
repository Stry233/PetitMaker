/**
 * The chunk coordinate legend (row letters A, B, C on the left, column numbers 1, 2, 3 along the
 * bottom), laid flat on the ground just outside the map edge: the 3D echo of the 2D legend. It is
 * shown with the chunk bounds, since it labels that same chunk grid.
 */
import * as THREE from 'three';
import { FontLoader, type Font } from 'three/examples/jsm/loaders/FontLoader.js';
// MgOpen Helvetiker bold, vendored unmodified from three.js r169 (the package stopped shipping example fonts); matches the 2D legend's bold sans-serif weight.
import helvetikerBold from '../../../assets/fonts/helvetiker_bold.typeface.json';
import type { MapTemplate } from '../../../core/model/types';
import { chunkColumnLabel, chunkRowLabel, mapChunkAxes, mapFrame } from '../../../core/grid/map-chunks';
import { CHUNK_SIZE } from '../../../core/game/profile';
import { mapCenterOffset } from '../geometry/coords';

/** The legend glyph font, parsed once. A typeface font gives real vector outlines, so the labels
 *  are built as flat filled ShapeGeometry (crisp at any zoom, never a magnified raster). */
let _legendFont: Font | null = null;
function legendFont(): Font {
  if (!_legendFont) _legendFont = new FontLoader().parse(helvetikerBold as unknown as Parameters<FontLoader['parse']>[0]);
  return _legendFont;
}

/** Flat (no-height) vector geometry for one legend label — filled glyph outlines, centred on the
 *  origin and scaled to a uniform `height` in world units (width follows naturally). Scaling by
 *  Height, not the max dimension, keeps every label the same visual size — a 2-char label like "10"
 *  is simply wider, not shorter. Being real geometry (not a texture) it stays sharp at any zoom. */
function labelGeometry(text: string, height: number): THREE.ShapeGeometry {
  const geo = new THREE.ShapeGeometry(legendFont().generateShapes(text, 1));
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const s = height / Math.max(bb.max.y - bb.min.y, 1e-3);
  geo.center();
  geo.scale(s, s, 1);
  return geo;
}

export class LabelLayer3D {
  private group: THREE.Group | null = null;
  private mat: THREE.MeshBasicMaterial | null = null;

  constructor(private readonly scene: THREE.Scene) {}

  /** Rebuilds the legend for `template`, or takes it down when the chunk bounds are hidden. */
  rebuild(template: MapTemplate, shown: boolean): void {
    if (this.group) {
      this.scene.remove(this.group);
      // Each label owns a unique ShapeGeometry; the material is shared and persistent (disposed
      // with the scene), so only the geometries are freed here.
      this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      this.group = null;
    }
    if (!shown) return;
    // Reference labels stay legible through fog but remain occluded by terrain in front of them.
    this.mat ??= new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, fog: false, side: THREE.DoubleSide });
    const mat = this.mat;
    const { width, height } = template;
    const off = mapCenterOffset(width, height);
    const { columns, rows } = mapChunkAxes(template);
    const frame = mapFrame(template);
    const LS = Math.min(CHUNK_SIZE * 0.7, 9); // label size (world units)
    const GAP = LS * 0.75;                    // distance from the map edge to the label centre
    const group = new THREE.Group();
    const addLabel = (text: string, wx: number, wz: number): void => {
      const mesh = new THREE.Mesh(labelGeometry(text, LS * 0.45), mat);
      mesh.rotation.x = -Math.PI / 2; // lie flat on the ground (XZ), reading from above
      mesh.position.set(wx, 0.12, wz);
      group.add(mesh);
    };
    for (let r = 0; r < rows.length; r++) {
      addLabel(chunkRowLabel(r), frame.x - off.x - GAP, rows[r]!.center - off.z);
    }
    for (let c = 0; c < columns.length; c++) {
      addLabel(chunkColumnLabel(c), columns[c]!.center - off.x, frame.y + frame.height - off.z + GAP);
    }
    this.scene.add(group);
    this.group = group;
  }

  dispose(): void {
    this.mat?.dispose();
  }
}
