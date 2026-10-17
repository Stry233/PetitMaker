/*
 * Captures the live map for cards that refer to a location, with the editor's own renderer. A gate
 * over a call with no footprint shows no picture; a receipt with no single rect (`whole`) shows the
 * whole map, since its postcard is the built thing itself.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { focusFrame, renderThumbnail, seaFrame, type CellFrame } from '../../../view/map2d/capture/thumbnail';
import { WATER_COLOR } from '../../../core/model/palette';
import { useEditorStore } from '../../../state/store';
import { ACTIVE, INK, rgbaOf } from '../../design/tokens';
import { edge } from '../panel-skin';
import type { CellBox } from '../../../agent/panel';
import { radii } from '../../design/styles';
import { useSettledValue } from '../../primitives/use-settled-value';

/** A macro-cell rectangle a shot is framed on, in the shape `focusFrame` reads. */
type ShotBox = CellBox;

/** The live map as a PNG at `width`x`height`, framed on `box`; the grid mutates in place, so the shot is keyed on its identity plus the frame. */
export function MapShot({ box, width, height, whole = false, placeholder, version }: {
  box: ShotBox | undefined;
  width: number;
  height: number;
  /** The caller's map version (the `GridState` version pair), which re-takes the shot per value; absent, the shot is taken once. */
  version?: string | number;
  /** With no box, photograph the whole map rather than nothing (see the file header). */
  whole?: boolean;
  /**
   * What stands while the picture is still being taken, for a card whose whole subject is the
   * photograph. A gate thumbnail leaves the slot empty (it is one of several facts on the card); a
   * card that is nothing but the planet needs to say it is waiting, and drawing a stand-in planet
   * would be a picture of a map nobody has.
   */
  placeholder?: ReactNode;
}) {
  const grid = useEditorStore((s) => s.gridState);
  const [png, setPng] = useState<string | null>(null);
  const frameBox = useSettledValue(box, (b) => (b ? [b.origin.x, b.origin.y, b.width, b.height].join(',') : ''));

  useEffect(() => {
    let live = true;
    setPng(null);
    if (!grid || (!frameBox && !whole)) return () => { live = false; };
    const aspect = width / height;
    // `focusFrame` answers null for "the map entire", which is also what a missing box means
    // here, so the two paths need no branch of their own.
    const frame: CellFrame | null = frameBox ? focusFrame(frameBox, grid.template, aspect) : null;
    void renderThumbnail(grid, Math.max(width, height), { aspect, frame, ...(version !== undefined ? { version } : {}) }).then((shot) => {
      if (live) setPng(shot);
    });
    return () => { live = false; };
  }, [grid, frameBox, width, height, whole, version]);

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

/* ── the marked shot: one map, one rect on it ────────────────────────────── */

/** How the marked box is drawn over the ground: the house `ACTIVE` yellow, washed inside and solid at
 *  the edge, which is the same yellow the map's own scope overlay is painted in. */
const MARK_FILL = rgbaOf(ACTIVE, 0.44);
const MARK_LINE = ACTIVE;
/** The line's dark backing, so a mark over pale sand reads as strongly as one over dark water. */
const MARK_HALO = rgbaOf(INK, 0.5);

/**
 * The whole map with a rect marked on it, so each picture says where; a crop of the rect alone shows
 * only its ground. The mark is placed by the capture's own sea framing (`seaFrame`).
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
        borderRadius: radii.chip,
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
