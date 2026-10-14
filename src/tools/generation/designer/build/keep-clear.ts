/**
 * The cells the theme kits leave unplanted: the landmark's panel and frame, the large fountain
 * courts, and a band round the largest composed figure.
 */
import { flatIndex } from '../../../../core/grid/rect';
import { frameCells, landmarkCells } from '../terrain/landmark';
import type { TerrainSculpt } from '../terrain/terrain-sculpt';
import { FIGURE_CALM } from '../water/water-forms';

/** The cells no kit may plant on, as flat indices. */
export function keepClear(sculpt: TerrainSculpt, W: number, H: number): Set<number> {
  const out = sculpt.landmark ? landmarkCells(sculpt.landmark, W, H) : new Set<number>();
  // And the frame around it. What makes a figure read as figure against ground is the calm band round
  // its edge, framed on four sides, and that band reads calm only paved or bare. A bed planted against the panel's edge is the framing gone, and one seed reads 67% of
  // its band calm that way against the floor of 70%.
  if (sculpt.landmark) {
    for (const c of frameCells(sculpt.landmark, W, H)) {
      if (c.x >= 0 && c.y >= 0 && c.x < W && c.y < H) out.add(flatIndex(c.x, c.y, W));
    }
  }
  for (const court of sculpt.fountains) {
    if (court.size !== 'large') continue;
    for (let y = court.rect.y; y < court.rect.y + court.rect.h; y++) {
      for (let x = court.rect.x; x < court.rect.x + court.rect.w; x++) {
        if (x >= 0 && y >= 0 && x < W && y < H) out.add(flatIndex(x, y, W));
      }
    }
  }
  // The map's set piece is whichever water reads largest, and that is not always the landmark: on one
  // seed a composed figure of 339 cells outweighs a 46x8 panel whose pattern stands mostly dry, and the
  // framing floor is then read round a body nothing kept clear. So the
  // biggest composed figure keeps a band of its own. Only the biggest: every figure ringed would take
  // a tenth of the planet's plantable ground out of the kits' hands, and a planet gathers its waterside
  // planting at the banks.
  const largest = sculpt.figures.reduce<typeof sculpt.figures[number] | null>(
    (big, f) => (!big || f.cells.length > big.cells.length ? f : big), null,
  );
  if (largest) {
    for (let y = largest.rect.y - FIGURE_CALM; y < largest.rect.y + largest.rect.h + FIGURE_CALM; y++) {
      for (let x = largest.rect.x - FIGURE_CALM; x < largest.rect.x + largest.rect.w + FIGURE_CALM; x++) {
        if (x >= 0 && y >= 0 && x < W && y < H) out.add(flatIndex(x, y, W));
      }
    }
  }
  return out;
}
