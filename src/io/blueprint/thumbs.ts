/*
 * The two pictures a blueprint card shows: its body alone on an empty map of the template, flat from
 * above and lifted in 3D, both at the Generate card's picture slot so they fill it without bars. A
 * save taken through the map's own views hands each picture the crop or camera the person framed it
 * with (`ThumbView`); without one each picture frames the body by itself.
 */
import { isBuildableZone } from '../../core/game/zones';
import { footprintTerrain } from '../../core/grid/footprint';
import { cellsCapturing } from '../../core/grid/map-chunks';
import { getCell } from '../../core/model/grid-model';
import { bareGridState } from '../../core/model/template';
import type { BlueprintBody } from '../../core/model/blueprint';
import type { GridState, MapTemplate } from '../../core/model/types';
import { layBlueprintDetached } from '../../tools/blueprint';
import { renderThumbnail, type CellFrame } from '../../view/map2d/capture/thumbnail';
import { captureMapStills } from '../../view/map3d/capture/stills';
import type { SeenView } from '../../view/map3d/camera/camera-pose';
import type { CameraAngle } from '../../state/view-camera';
import { islandBounds } from '../../view/map3d/camera/controls';
import { BLUEPRINT_THUMB_MAX_CHARS } from './format';
import { THUMB_ASPECT } from './facts';
/** Long edges tried in device pixels, largest first: about twice the card's CSS size, then smaller until the file admits it. */
const THUMB_LONG_SIDES = [640, 480, 320, 200] as const;
/** The 3D camera's heading and tilt in degrees. */
const LIFT_AZIMUTH = 35, LIFT_ELEVATION = 38;
/** Cells across the lifted picture per unit of orbit distance, per cell of the template's longer
 *  side: the scene's unit is its resting view of the whole planet (measured on a 169 by 140 planet). */
const LIFT_CELLS_PER_DIST = 1.55;
/** The share of the lifted picture's width or height the body fills, and the closest orbit, the
 *  scene's own dolly floor (`view/map3d/camera/controls.ts`). */
const LIFT_FILL = 0.7, LIFT_DIST_MIN = 0.1;

/** The top-left terrain cell nearest the map's centre where the whole body stands on buildable zone, else the centre. */
function bodyOrigin(state: GridState, body: BlueprintBody): { x: number; y: number } {
  const { width, height } = state.template;
  const cx = Math.round((width - body.w) / 2), cy = Math.round((height - body.h) / 2);
  const fits = (x: number, y: number): boolean => {
    const area = footprintTerrain({ x, y, w: body.w, h: body.h });
    for (let j = 0; j < area.h; j++) for (let i = 0; i < area.w; i++) {
      if (!isBuildableZone(getCell(state.cells, area.x + i, area.y + j)?.zone)) return false;
    }
    return true;
  };
  const reach = Math.max(width, height);
  for (let r = 0; r <= reach; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = cx + dx, y = cy + dy;
      if (x >= 0 && y >= 0 && x + body.w <= width && y + body.h <= height && fits(x, y)) return { x, y };
    }
  }
  return { x: Math.max(0, cx), y: Math.max(0, cy) };
}

/** The body's rectangle plus a cell of air, grown to `aspect` and kept inside the template. */
function frameOf(at: { x: number; y: number }, body: BlueprintBody, template: MapTemplate): CellFrame {
  let width = body.w + 2, height = body.h + 2;
  if (width / height < THUMB_ASPECT) width = height * THUMB_ASPECT;
  else height = width / THUMB_ASPECT;
  width = Math.min(width, template.width);
  height = Math.min(height, template.height);
  const place = (mid: number, size: number, span: number): number => Math.min(span - size, Math.max(0, mid - size / 2));
  const x = place(at.x + body.w / 2, width, template.width), y = place(at.y + body.h / 2, height, template.height);
  return { x, y, width, height };
}

/** The orbit distance at which the body, seen from the lifted camera, fills `LIFT_FILL` of the
 *  picture's width or height, whichever it reaches first. */
function liftDistance(body: BlueprintBody, template: MapTemplate): number {
  const az = (LIFT_AZIMUTH * Math.PI) / 180, el = (LIFT_ELEVATION * Math.PI) / 180;
  const across = body.w * Math.cos(az) + body.h * Math.sin(az);
  const deep = (body.w * Math.sin(az) + body.h * Math.cos(az)) * Math.sin(el);
  const cells = Math.max(across, deep * THUMB_ASPECT) / LIFT_FILL;
  return Math.min(1, Math.max(LIFT_DIST_MIN, cells / (LIFT_CELLS_PER_DIST * Math.max(template.width, template.height))));
}

/** How the pictures look at the body, as framed on the live map: `at` is the body's frame top-left
 *  there, where it is laid on the empty map so the crop and camera keep their aim. */
export interface ThumbView {
  at: { x: number; y: number };
  /** The flat picture's crop in map cells, at `THUMB_ASPECT`, turned by `turn` radians about its
   *  centre as a turned 2D view showed it; the body's own frame where absent. */
  flat?: CellFrame & { turn?: number };
  /** The lifted picture's camera: the part of the live 3D view the person framed it in, or an angle
   *  in the scene's terms; the default aim at the body where absent. */
  lifted?: CameraAngle | SeenView;
}

/** The first long side whose picture fits a record's thumbnail cap; '' when none does or none could be drawn. */
async function smallestFitting(draw: (longSide: number) => Promise<string | null | undefined>, sides: readonly number[]): Promise<string> {
  for (const side of sides) {
    const url = await draw(side);
    if (!url) return '';
    if (url.length <= BLUEPRINT_THUMB_MAX_CHARS) return url;
  }
  return '';
}

/** The empty map of `template` with `body` laid at `at`, the default one near its centre. */
export function staged(body: BlueprintBody, template: MapTemplate, at?: { x: number; y: number }): Staged {
  const state = bareGridState(template);
  const where = at ?? bodyOrigin(state, body);
  layBlueprintDetached(state, body, { at: where, quarters: 0 });
  return { state, body, template, at: where };
}

/** The lifted camera's default aim at a body laid at `at`. */
function defaultAim(body: BlueprintBody, template: MapTemplate, at: { x: number; y: number }): CameraAngle {
  const island = islandBounds(template, 0);
  return {
    az: LIFT_AZIMUTH, el: LIFT_ELEVATION, dist: liftDistance(body, template),
    // The scene aims at its island's centre, which the target is offset from.
    tx: at.x + body.w / 2 - template.width / 2 - (island.centerX ?? 0),
    tz: at.y + body.h / 2 - template.height / 2 - (island.centerZ ?? 0),
  };
}

/** A body laid on the empty map of its template, at `at`: laid once, drawn as often as asked. */
export interface Staged { state: GridState; body: BlueprintBody; template: MapTemplate; at: { x: number; y: number } }

/** One picture of a staged body, `which` of the two, as `view` frames it, at the first of `sides`
 *  (device px) that fits a record. '' where it could not be drawn. */
async function picture({ state, body, template, at }: Staged, which: 'flat' | 'lifted', view: ThumbView | undefined, sides: readonly number[]): Promise<string> {
  if (which === 'flat') {
    // The 2D picture adds terrain's bleed above and left of a frame, so the frame leaves it out and
    // the picture shows the crop exactly, with no sea bars.
    const frame = cellsCapturing(view?.flat ?? frameOf(at, body, template));
    const turn = view?.flat?.turn ?? 0;
    return smallestFitting((side) => renderThumbnail(state, side, { aspect: THUMB_ASPECT, frame, turn }), sides);
  }
  const angle = view?.lifted ?? defaultAim(body, template, at);
  return smallestFitting(async (side) => (await captureMapStills(state, [angle], { maxPx: side, aspect: THUMB_ASPECT }))[0], sides);
}

/**
 * The flat and the lifted picture of `body` laid on the ground of an empty map of `template`, as
 * `view` frames them where given. An empty string stands for a picture that could not be drawn (no
 * renderer, no WebGL2), which a card shows as a blank face.
 */
export async function blueprintThumbs(body: BlueprintBody, template: MapTemplate, view?: ThumbView): Promise<{ flat: string; lifted: string }> {
  const stage = staged(body, template, view?.at);
  const flat = await picture(stage, 'flat', view, THUMB_LONG_SIDES);
  const lifted = await picture(stage, 'lifted', view, THUMB_LONG_SIDES);
  return { flat, lifted };
}

/** Long edges a live preview of one picture is drawn at: small, as it is drawn again while the view moves. */
const PREVIEW_LONG_SIDES = [200] as const;

/** One picture of a staged body, `which` of the two, as `view` frames it, drawn small for a live preview. */
export function blueprintThumbPreview(stage: Staged, view: ThumbView, which: 'flat' | 'lifted'): Promise<string> {
  return picture(stage, which, view, PREVIEW_LONG_SIDES);
}
