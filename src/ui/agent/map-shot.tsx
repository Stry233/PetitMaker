/*
 * Captures the live map for cards that refer to a location. The thumbnail uses the same renderer as
 * the editor, so terrain, trims, roads and objects match the map the action will affect.
 *
 * IT IS THE MINIMAL PATH, AND THE REGION FAMILY'S VIGNETTE IS THE SAME MOVE PLUS AN OVERLAY: this
 * captures the live grid framed on a cell rect, memoized per grid identity by `renderThumbnail`
 * itself. A vignette drawing the marked bounds over that ground wants exactly this component with a
 * rect painted on top, and lifting it here rather than copying it is the whole point of it being a
 * file of its own.
 *
 * WHERE THERE IS NO RECT THERE IS NO SHOT — for a GATE. A gate over a call with no footprint (a
 * rotate by id, a plan) renders nothing at all, which is what the card's own slot-or-nothing rule
 * wants: an empty bordered rectangle beside every plain yes/no question would only be noise. And a
 * null from `renderThumbnail` is "no renderer yet", not a broken picture, so the box simply stays
 * empty.
 *
 * A RECEIPT'S POSTCARD ANSWERS THE OTHER WAY (`whole`), and the difference is what each picture is
 * FOR. A gate's thumbnail is a promise about the cells the click is about, so with no cells there is
 * no promise to make. A receipt's postcard is the built thing itself, and a job whose edits name no
 * one rectangle (a whole-island generate, a scatter of placements) still built something — the
 * island entire is the honest frame for it, which is also what `focusFrame` returns for a box
 * covering most of the template.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { focusFrame, renderThumbnail, seaFrame, type CellFrame } from '../../canvas/thumbnail';
import { WATER_COLOR } from '../../core/model/constants';
import { useEditorStore } from '../../state/store';
import { ACTIVE, INK } from '../design/tokens';
import { edge } from './tokens';
import { withAlpha } from '../design/styles';

/** A macro-cell rectangle a shot is framed on, in the shape `focusFrame` reads. */
export interface ShotBox { origin: { x: number; y: number }; width: number; height: number }

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined;
}

function boxOf(x1: number, y1: number, x2: number, y2: number): ShotBox {
  const lo = { x: Math.min(x1, x2), y: Math.min(y1, y2) };
  return { origin: lo, width: Math.abs(x2 - x1) + 1, height: Math.abs(y2 - y1) + 1 };
}

function cellsBox(raw: unknown): ShotBox | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  let x1 = Infinity; let y1 = Infinity; let x2 = -Infinity; let y2 = -Infinity;
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const x = num((item as Record<string, unknown>).x);
    const y = num((item as Record<string, unknown>).y);
    if (x === undefined || y === undefined) continue;
    x1 = Math.min(x1, x); y1 = Math.min(y1, y);
    x2 = Math.max(x2, x); y2 = Math.max(y2, y);
  }
  return Number.isFinite(x1) ? boxOf(x1, y1, x2, y2) : undefined;
}

/**
 * THE CELLS A GATED CALL IS ABOUT, from the call's own arguments — or undefined where the arguments
 * name no place on the map.
 *
 * The tool schemas speak four shapes and no more (`agent/tools/tools.ts`): a rect as `x1,y1,x2,y2`
 * (loose or under `rect`), an explicit `cells`/`path` list, a circle as `cx,cy,r`, and a single
 * point as `x,y`. Anything else — an objectId, a category, a generator recipe — names no rectangle,
 * and a shot invented for one would be a picture of somewhere else.
 */
export function callFootprint(input: Record<string, unknown> | undefined): ShotBox | undefined {
  if (!input) return undefined;
  const rect = (typeof input.rect === 'object' && input.rect !== null ? input.rect : input) as Record<string, unknown>;
  const x1 = num(rect.x1); const y1 = num(rect.y1); const x2 = num(rect.x2); const y2 = num(rect.y2);
  if (x1 !== undefined && y1 !== undefined && x2 !== undefined && y2 !== undefined) return boxOf(x1, y1, x2, y2);

  const cells = cellsBox(input.cells) ?? cellsBox(input.path);
  if (cells) return cells;

  const cx = num(input.cx); const cy = num(input.cy); const r = num(input.r);
  if (cx !== undefined && cy !== undefined && r !== undefined) return boxOf(cx - r, cy - r, cx + r, cy + r);

  const x = num(input.x); const y = num(input.y);
  if (x !== undefined && y !== undefined) return boxOf(x, y, x, y);
  return undefined;
}

/** The smallest box holding every one of `boxes`, or undefined where there are none. The union of a
 *  job's own write footprints is what a receipt's postcard is framed on. */
export function unionBox(boxes: readonly (ShotBox | undefined)[]): ShotBox | undefined {
  let x1 = Infinity; let y1 = Infinity; let x2 = -Infinity; let y2 = -Infinity;
  for (const b of boxes) {
    if (!b) continue;
    x1 = Math.min(x1, b.origin.x); y1 = Math.min(y1, b.origin.y);
    x2 = Math.max(x2, b.origin.x + b.width - 1); y2 = Math.max(y2, b.origin.y + b.height - 1);
  }
  return Number.isFinite(x1) ? boxOf(x1, y1, x2, y2) : undefined;
}

/**
 * The live map as a PNG at `width`x`height`, framed on `box`.
 *
 * The capture is async and the grid mutates in place, so the shot is keyed on the store's own
 * object identity plus the frame: a stroke that replaces the grid re-takes the picture, and a
 * re-render that does not, does not.
 */
export function MapShot({ box, width, height, whole = false, placeholder, version }: {
  box: ShotBox | undefined;
  width: number;
  height: number;
  /**
   * WHAT THE CALLER KNOWS ABOUT THE MAP MOVING. The live grid is mutated in place, so its identity
   * never changes under an edit and one picture would stand for the map's whole life. A card whose
   * subject IS the island passes the reading it already has (the version pair off `GridState`), and
   * gets a fresh capture per value. Absent, the shot is taken once — which is right for a picture of
   * a moment (a gate's footprint, a settled receipt's postcard).
   */
  version?: string | number;
  /** With no box, photograph the WHOLE map rather than nothing (see the file header). */
  whole?: boolean;
  /**
   * What stands while the picture is still being taken, for a card whose whole subject IS the
   * photograph. A gate thumbnail leaves the slot empty (it is one of several facts on the card); a
   * card that is nothing but the island needs to say it is waiting, and drawing a stand-in island
   * would be a picture of a map nobody has.
   */
  placeholder?: ReactNode;
}) {
  const grid = useEditorStore((s) => s.gridState);
  const [png, setPng] = useState<string | null>(null);
  const key = box ? `${box.origin.x},${box.origin.y},${box.width},${box.height}` : '';

  useEffect(() => {
    let live = true;
    setPng(null);
    if (!grid || (!box && !whole)) return () => { live = false; };
    const aspect = width / height;
    // `focusFrame` answers null for "the island entire", which is also what a missing box means
    // here, so the two paths need no branch of their own.
    const frame: CellFrame | null = box ? focusFrame(box, grid.template, aspect) : null;
    void renderThumbnail(grid, Math.max(width, height), aspect, frame, version).then((shot) => {
      if (live) setPng(shot);
    });
    return () => { live = false; };
    // `box` is rebuilt on every render by its caller; `key` is its value, which is what identity the
    // capture actually depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, key, width, height, whole, version]);

  if (!box && !whole) return null;
  return (
    <span
      data-testid="map-shot"
      data-shot={png === null ? 'pending' : 'ready'}
      style={{ display: 'block', width: '100%', height: '100%' }}
    >
      {png !== null
        ? <img src={png} alt="" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
        : placeholder}
    </span>
  );
}

/* ── the marked shot: one island, one rect on it ─────────────────────────── */

/** How the marked box is drawn over the ground: the house ACTIVE yellow, washed inside and solid at
 *  the edge, which is the same yellow the map's own scope overlay is painted in. */
const MARK_FILL = withAlpha(ACTIVE, 0.44);
const MARK_LINE = ACTIVE;
/** The line's dark backing, so a mark over pale sand reads as strongly as one over dark water. */
const MARK_HALO = withAlpha(INK, 0.5);

/**
 * THE WHOLE ISLAND WITH A RECT MARKED ON IT — the picture this file's header describes and the one
 * every card that is ABOUT a place on the map draws.
 *
 * A CROP SAYS NOTHING ABOUT WHERE. That is the reading the region vignette was written to, and the
 * gate family had the other half of it: `MapShot box=…` frames ON the rect, so the cells fill the
 * frame edge to edge and the picture is a flat patch of whatever ground happens to be there. Three
 * option cards came out as three near-identical crops of the same green field — a picture that
 * exists to distinguish three choices and distinguished none of them. Marked on the island entire,
 * each option's own geometry is what its thumb shows.
 *
 * The rect is placed by the SAME sea-framing math the capture is composed with
 * (`thumbnail.ts:seaFrame`), so the mark lands on the cells it names rather than on an eyeballed
 * fraction of the picture.
 */
export function MarkedShot({ box, width, height, testId = 'marked-shot', version }: {
  box: ShotBox;
  width: number;
  height: number;
  /** The outer box's own id; the mark is `<testId>-mark`. Named so the region family keeps the two
   *  ids it already had rather than gaining a second name for one drawing. */
  testId?: string;
  version?: string | number;
}) {
  const template = useEditorStore((s) => s.gridState?.template);
  const sea = template ? seaFrame(template.width, template.height, width / height) : null;
  const mark: CSSProperties | null = sea && {
    position: 'absolute',
    left: `${((sea.dx + box.origin.x) / sea.width) * 100}%`,
    top: `${((sea.dy + box.origin.y) / sea.height) * 100}%`,
    width: `${(box.width / sea.width) * 100}%`,
    height: `${(box.height / sea.height) * 100}%`,
    background: MARK_FILL,
    // Two rings rather than one: the outer is the dark backing that keeps a pale yellow line legible
    // over pale ground, and neither takes any layout room (a border would inset the mark off its
    // own cells).
    boxShadow: `0 0 0 1px ${MARK_LINE}, 0 0 0 2px ${MARK_HALO}`,
  };
  return (
    <span
      data-testid={testId}
      style={{
        position: 'relative',
        display: 'inline-flex',
        overflow: 'hidden',
        border: edge,
        borderRadius: 8,
        flex: '0 0 auto',
        background: WATER_COLOR,
        width,
        height,
      }}
    >
      <MapShot box={undefined} width={width} height={height} whole {...(version !== undefined ? { version } : {})} />
      {mark && <span data-testid={`${testId}-mark`} style={mark} />}
    </span>
  );
}
