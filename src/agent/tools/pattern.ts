/** copy_area and replace_objects: repeat, mirror and turn a built motif, then give each copy its own planting. */
import { footprintTerrain } from '../../core/grid/footprint';
import { cellSet } from '../../core/grid/grids';
import { PLACEMENT_GRID } from '../../core/game/profile';
import { placeObjectCommand, removeObjectCommand } from '../../core/model/command-build';
import type { MacroCoord } from '../../core/model/types';
import { getCatalogItem, getOfferedItem } from '../../state/catalog';
import { BLUEPRINT_MAX_SIDE, captureBlueprint, layBlueprintWith, type CaptureRefusal } from '../../tools/blueprint';
import { argError, capLines, dedupe, formatErrors } from './feedback';
import { corners } from './geometry';
import { buildPlaceCmd } from './objects';
import { int, list, num, obj, oneOf, req, str } from './schema';
import { defineTool } from './spec';
import { runStrokeBody } from './stroke';

/** The most copies one call lays: enough for a row of plots or the three mirrors of a quadrant. */
const COPY_LIMIT = 12;

const FLIPS = ['none', 'horizontal', 'vertical'] as const;

/** One laid copy, for the result text. */
interface CopyTally { at: MacroCoord; objects: number; cells: number; skipped: number }

/**
 * Lays the terrain and objects of a source rectangle again at each listed place, optionally mirrored
 * or turned, as one undo step. It lays as a blueprint does: existing work wins, terrain is only
 * raised, and each part lands only where the rules accept it.
 */
/** Why a rectangle could not be taken up to copy or mirror, and what to do instead. */
function captureRefusalText(refusal: CaptureRefusal, act: 'copy' | 'mirror'): string {
  const what = act === 'copy' ? 'source' : 'side';
  return {
    'too-big': `the ${what} is larger than ${BLUEPRINT_MAX_SIDE} cells a side; ${act} it in parts.`,
    'too-small': `the ${what} rectangle is empty.`,
    landmark: `the ${what} overlaps a fixed landmark, which cannot be ${act === 'copy' ? 'copied' : 'mirrored'}; move the rectangle off it.`,
    empty: `the ${what} holds no terrain and no whole object; build it first, then ${act} it.`,
  }[refusal];
}

export const copyAreaTool = defineTool({
  description: 'Repeat a finished motif: copy the terrain and objects inside the source rectangle x1,y1,x2,y2 '
    + `(at most ${BLUEPRINT_MAX_SIDE} cells a side) to each place in copies, in one step. Build one unit well `
    + '(a framed bed, a house with its yard, an orchard block, a pool court), then lay it in a row, a grid or mirrored pairs. '
    + 'Each copy gives x,y, the top-left cell its frame lands on. flip "horizontal" mirrors it left to right and "vertical" top to bottom; '
    + 'turns rotates it clockwise by quarter turns after the flip. '
    + 'For left-right symmetry about a vertical axis with the source spanning x1..x2 and the axis lying between columns a and a+1, '
    + 'the mirrored copy has x = 2a + 1 - x2, the same y and flip "horizontal". '
    + 'Copies land on open ground: what already stands at a target is kept, and the result names what each copy could not lay.',
  input: obj({
    ...corners,
    copies: req(list(obj({
      x: req(int()), y: req(int()),
      flip: oneOf([...FLIPS], { description: 'Mirror before turning (default none).' }),
      turns: int({ min: 0, max: 3, description: 'Clockwise quarter turns (default 0).' }),
    }), { description: `Where each copy lands, at most ${COPY_LIMIT}.` })),
  }),
  access: 'write',
  example: 'x1: 20, y1: 30, x2: 27, y2: 35, copies: [{ x: 30, y: 30 }, { x: 40, y: 30 }, { x: 50, y: 30, flip: "horizontal" }]',
  async run(deps, input) {
    const { copies } = input;
    if (copies.length === 0) return argError('copies must list at least one place.', 'copies: [{ x: 30, y: 30 }]');
    if (copies.length > COPY_LIMIT) return argError(`one call lays at most ${COPY_LIMIT} copies; split the rest into another call.`);
    const frame = {
      x: Math.min(input.x1, input.x2), y: Math.min(input.y1, input.y2),
      w: Math.abs(input.x2 - input.x1) + 1, h: Math.abs(input.y2 - input.y1) + 1,
    };
    const captured = captureBlueprint(deps.getState(), frame);
    if ('refusal' in captured) return argError(captureRefusalText(captured.refusal, 'copy'));
    const { body } = captured;
    const exec = deps.getExecutor();
    const laid: CopyTally[] = [];
    const flash: MacroCoord[] = [];
    const stroke = await runStrokeBody(deps, 'the copies', () => {
      for (const copy of copies) {
        const vertical = copy.flip === 'vertical';
        const quarters = ((copy.turns ?? 0) + (vertical ? 2 : 0)) % 4;
        const mirror = copy.flip === 'horizontal' || vertical;
        const at = { x: copy.x, y: copy.y };
        // Read at each laying: every copy changes the map the next one lands on.
        const result = layBlueprintWith(exec, deps.getState(), body, { at, quarters, ...(mirror ? { mirror } : null) });
        const skips = Object.values(result.skips).reduce<number>((sum, n) => sum + (typeof n === 'number' ? n : 0), 0);
        laid.push({ at, objects: result.placed.length, cells: result.cells.length, skipped: skips });
        const turned = quarters % 2 === 1;
        const area = footprintTerrain({ x: at.x, y: at.y, w: turned ? frame.h : frame.w, h: turned ? frame.w : frame.h });
        for (let y = area.y; y < area.y + area.h; y++) for (let x = area.x; x < area.x + area.w; x++) flash.push({ x, y });
      }
    });
    if ('refusal' in stroke) return stroke.refusal;
    const landed = laid.filter((c) => c.objects + c.cells > 0);
    if (landed.length === 0) {
      return { isError: true, content: 'No copy landed: every target is occupied, off the buildable ground or outside the selection. Choose open ground the size of the source.' };
    }
    if (flash.length > 0) deps.onFlash?.([cellSet(PLACEMENT_GRID, flash)]);
    const lines = laid.map((c) => `(${c.at.x},${c.at.y}): ${c.objects} objects, ${c.cells} terrain cells`
      + (c.skipped > 0 ? `, ${c.skipped} parts left out where the ground was taken or the rules refused` : ''));
    return {
      isError: false,
      content: `Copied the ${frame.w}x${frame.h} source at (${frame.x},${frame.y}) to ${landed.length} of ${copies.length} places.\n${lines.join('\n')}`,
      ...(stroke.detail ? { detail: stroke.detail } : {}),
    };
  },
});

/**
 * Swaps one catalog item for another across a rectangle, each replacement standing where and as the
 * original stood, as one undo step: a copied plot keeps its layout and takes its own species.
 */
export const replaceObjectsTool = defineTool({
  description: 'Replace every object of one catalog id inside the rectangle x1,y1,x2,y2 with another id of the same footprint, '
    + 'each at the same cell and rotation, in one step. Use it after copy_area so that copies of one layout differ in species or colour, '
    + 'or to change the planting of a bed without rebuilding it.',
  input: obj({ ...corners, from: req(str({ description: 'Catalog id to replace.' })), to: req(str({ description: 'Catalog id to put in its place.' })) }),
  access: 'write',
  example: 'x1: 30, y1: 30, x2: 37, y2: 35, from: "flower-rose", to: "flower-daisy"',
  async run(deps, input) {
    const { from, to } = input;
    const fromItem = getCatalogItem(from), toItem = getOfferedItem(to);
    if (!toItem) return argError(`unknown catalog id "${to}", use an id from the CATALOG section.`);
    if (!fromItem) return argError(`unknown catalog id "${from}", use get_objects to read what stands there.`);
    if (fromItem.width !== toItem.width || fromItem.height !== toItem.height) {
      return argError(`${to} is ${toItem.width}x${toItem.height} and ${from} is ${fromItem.width}x${fromItem.height}; replace with an item of the same footprint.`);
    }
    const x1 = Math.min(input.x1, input.x2), x2 = Math.max(input.x1, input.x2);
    const y1 = Math.min(input.y1, input.y2), y2 = Math.max(input.y1, input.y2);
    const found = [...deps.getState().objects.values()].filter((o) => o.catalogId === from && !o.locked
      && o.position.x >= x1 && o.position.x <= x2 && o.position.y >= y1 && o.position.y <= y2);
    if (found.length === 0) return { isError: true, content: `No ${from} stands in (${x1},${y1})-(${x2},${y2}). Use get_objects with that rectangle to read what does.` };
    const exec = deps.getExecutor();
    let replaced = 0;
    const failures: string[] = [];
    const stroke = await runStrokeBody(deps, 'the replacement', () => {
      for (const object of found) {
        const place = buildPlaceCmd(deps, to, object.position, object.rotation);
        if (typeof place === 'string' || !exec.execute(removeObjectCommand(object)).success) continue;
        const placed = exec.execute(place);
        if (placed.success) { replaced++; continue; }
        failures.push(formatErrors(placed.errors));
        exec.execute(placeObjectCommand(object));
      }
    });
    if ('refusal' in stroke) return stroke.refusal;
    const kept = found.length - replaced;
    return {
      isError: replaced === 0,
      content: `Replaced ${replaced} of ${found.length} ${from} with ${to} in (${x1},${y1})-(${x2},${y2}).`
        + (kept > 0 ? ` ${kept} stand as they were, where ${to} is refused:\n${capLines(dedupe(failures)).join('\n')}` : ''),
      ...(stroke.detail ? { detail: stroke.detail } : {}),
    };
  },
});

const AXIS_ARGS = {
  axisX: num({ description: 'A vertical mirror line: a whole number c runs through the middle of column c (a path 1 or 3 wide centred on c); c + 0.5 runs between columns c and c + 1 (a path 2 wide on c and c + 1).' }),
  axisY: num({ description: 'A horizontal mirror line, given the same way for rows.' }),
};

/** The one axis a call names, in whole or half cells, or a refusal. */
function axisOf(input: { axisX?: number; axisY?: number }): { along: 'x' | 'y'; at: number } | string {
  const { axisX, axisY } = input;
  if ((axisX === undefined) === (axisY === undefined)) return 'give exactly one of axisX and axisY.';
  const at = (axisX ?? axisY)!;
  if (!Number.isInteger(at * 2)) return 'the axis is a whole number (through the middle of a column or row) or a whole number plus 0.5 (between two).';
  return { along: axisX !== undefined ? 'x' : 'y', at };
}

/**
 * Builds the other side: lays the source rectangle again as its exact mirror image about a line, the
 * tool working out where it lands. Two sides built by separate calls drift a cell apart; one side
 * mirrored cannot.
 */
export const mirrorAreaTool = defineTool({
  description: 'Make two sides match: build ONE side of an entrance, a path, a court or a pond, then mirror the rectangle x1,y1,x2,y2 '
    + 'across a line, in one step. The tool computes where the mirror image lands, so the two sides are exactly symmetric, '
    + 'terrain and objects alike. Never build the two sides of something symmetric with separate calls. '
    + 'The other side must be open ground: what already stands there is kept and reported.',
  input: obj({ ...corners, ...AXIS_ARGS }),
  access: 'write',
  example: 'x1: 20, y1: 30, x2: 27, y2: 35, axisX: 30.5',
  async run(deps, input) {
    const axis = axisOf(input);
    if (typeof axis === 'string') return argError(axis, 'axisX: 30.5');
    const frame = {
      x: Math.min(input.x1, input.x2), y: Math.min(input.y1, input.y2),
      w: Math.abs(input.x2 - input.x1) + 1, h: Math.abs(input.y2 - input.y1) + 1,
    };
    const far = axis.along === 'x' ? frame.x + frame.w - 1 : frame.y + frame.h - 1;
    const near = axis.along === 'x' ? frame.x : frame.y;
    if (near <= axis.at && far >= axis.at) return argError('the rectangle crosses the axis; give only the side to be mirrored.');
    const captured = captureBlueprint(deps.getState(), frame);
    if ('refusal' in captured) return argError(captureRefusalText(captured.refusal, 'mirror'));
    const landing = 2 * axis.at - far;
    const at = axis.along === 'x' ? { x: landing, y: frame.y } : { x: frame.x, y: landing };
    const exec = deps.getExecutor();
    let landed = { objects: 0, cells: 0, skipped: 0 };
    const stroke = await runStrokeBody(deps, 'the mirror image', () => {
      // A left-to-right mirror; turned half round it becomes the top-to-bottom one.
      const result = layBlueprintWith(exec, deps.getState(), captured.body, { at, quarters: axis.along === 'x' ? 0 : 2, mirror: true });
      landed = {
        objects: result.placed.length, cells: result.cells.length,
        skipped: Object.values(result.skips).reduce<number>((sum, n) => sum + (typeof n === 'number' ? n : 0), 0),
      };
    });
    if ('refusal' in stroke) return stroke.refusal;
    if (landed.objects + landed.cells === 0) return { isError: true, content: 'Nothing landed: the other side is occupied, off the buildable ground or outside the selection.' };
    const end = axis.along === 'x' ? `(${at.x},${frame.y})-(${at.x + frame.w - 1},${frame.y + frame.h - 1})` : `(${frame.x},${at.y})-(${frame.x + frame.w - 1},${at.y + frame.h - 1})`;
    return {
      isError: false,
      content: `Mirrored to ${end}: ${landed.objects} objects, ${landed.cells} terrain cells`
        + (landed.skipped > 0 ? `; ${landed.skipped} parts were left out where the ground was taken or the rules refused, so the two sides differ there. check_build lists them.` : '. The two sides match.'),
      ...(stroke.detail ? { detail: stroke.detail } : {}),
    };
  },
});
