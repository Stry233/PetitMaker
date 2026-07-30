import { describe, it, expect } from 'vitest';
import { BUILD_TILES, GRID_TILES } from '../../ui/menu/metrics';

describe('hub tile spec', () => {
  it('road is a large build tile that opens the tile/path surface', () => {
    const road = BUILD_TILES.find((t) => t.id === 'road');
    expect(road).toBeDefined();
    expect(road!.action).toBe('build');
    expect(road!.payload).toBe('tile'); // reuses the tile-coating brush
  });

  it('three large build tiles: mountain, river, road', () => {
    expect(BUILD_TILES.map((t) => t.id)).toEqual(['mountain', 'river', 'road']);
  });

  it('move is a grid tile and the old tile grid tile is gone', () => {
    const move = GRID_TILES.find((t) => t.id === 'move');
    expect(move).toBeDefined();
    expect(move!.action).toBe('move');
    expect(GRID_TILES.find((t) => t.id === 'tile')).toBeUndefined();
  });
});
