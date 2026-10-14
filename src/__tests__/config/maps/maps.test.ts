import { describe, it, expect } from 'vitest';
import { getMapTemplate, DEFAULT_MAP } from '../../../config/maps';
import { mapChunkAxes } from '../../../core/grid/map-chunks';
import { LANDMARKS } from '../../../core/game/profile';
import { CellZone } from '../../../core/game/zones';
import { deriveBoundary, groundUnderRim } from '../../../core/model/shore';

describe('getMapTemplate', () => {
  it('resolves a registered id to its own template', () => {
    expect(getMapTemplate('tafa').id).toBe('tafa');
  });

  it('falls back to the default for an Object.prototype key', () => {
    expect(getMapTemplate('__proto__')).toBe(DEFAULT_MAP);
    expect(getMapTemplate('toString')).toBe(DEFAULT_MAP);
    expect(getMapTemplate('constructor')).toBe(DEFAULT_MAP);
  });

  it.each(['hexia', 'tafa'])('%s retains its reference chunk borders within the cropped map', (id) => {
    const template = getMapTemplate(id);
    const { columns, rows } = mapChunkAxes(template);
    expect([template.width, template.height]).toEqual([169, 140]);
    expect(columns).toHaveLength(13);
    expect(rows).toHaveLength(12);
    expect(columns.map((span) => span.start).filter((x) => x > 0 && x < template.width)).toEqual([1, 17, 33, 49, 65, 81, 97, 113, 129, 145, 161]);
    expect(rows.map((span) => span.start).filter((y) => y > 0 && y < template.height)).toEqual([9, 25, 41, 57, 73, 89, 105, 121, 137]);
  });

  it.each(['hexia', 'tafa'])('%s lays every landmark at the footprint the planet profile gives custom planets', (id) => {
    const t = getMapTemplate(id);
    expect(t.landmarks.map((l) => l.id)).toEqual(LANDMARKS.map((l) => l.id));
    for (const l of t.landmarks) {
      const spec = LANDMARKS.find((s) => s.id === l.id)!;
      expect({ width: l.width, height: l.height }).toEqual({ width: spec.width, height: spec.height });
    }
  });
});

// Tafa's ground where the game's edit-mode outline and grass edges moved it off the layout sheet, in
// the template frame as `x,y:zone`.
const RIM_OVER_SEA = ['110,2:4', '34,6:4', '35,6:4'];
const TAFA_COAST = [
  // A: west inner edge
  '16,12:4 16,13:4 16,14:4 16,15:4 16,16:4 16,17:4 16,18:4 16,19:4 16,20:4 16,21:4 16,22:4 16,23:4',
  // B: west inner edge
  '13,91:2 13,92:2 14,92:2 13,93:2 14,93:2 13,94:2 14,94:2 13,95:2 14,95:2 13,96:2 14,96:2 15,96:2 14,97:2 15,97:2 14,98:2 15,98:2 14,99:2 15,99:2 14,100:2 15,100:2 14,101:2 15,101:2 14,102:2 14,103:2 14,104:2 14,105:2 14,106:2',
  // C: west inner edge
  '14,36:4 14,37:4 14,38:4 14,39:4 14,40:4 14,41:4 14,42:4 14,43:4 14,44:4 14,45:4 14,46:4 14,47:4 14,48:4',
  // D: south inner pockets
  '28,123:4 29,123:4 30,123:4 43,123:2 44,123:2 45,123:2 46,123:2 47,123:2 29,124:1 30,124:4 31,124:4 32,124:4 48,124:4 49,124:4 50,124:4 51,124:4 52,124:4 50,125:1 51,125:1 52,125:4 53,125:4 54,125:4 55,125:4 56,125:4',
  // E: south inner edge
  '101,125:4 102,125:4 103,125:4 102,126:1 103,126:4 104,126:4 105,126:4 106,126:4',
  // F: north inner edge
  '69,6:4 70,6:4 71,6:4 72,6:4 73,6:4 74,6:4 75,6:4',
  // K: south shore
  '50,136:0 53,136:0 50,137:0 53,137:0 54,137:0 50,138:0 50,139:0 54,136:0',
  // M: south-west shore
  '3,130:0 3,132:0 4,134:0 5,135:0 6,135:0 7,135:0 8,135:0 7,136:0',
  // N1: north-west shore
  '38,1:1 39,1:1 40,1:1',
  // N2: north shore
  '134,0:1 81,1:1 82,1:1 83,1:1 84,1:1 85,1:1 128,1:1 129,1:1 130,1:1 131,1:1 134,1:1 135,1:1 135,0:1',
  // R: east shore
  '162,94:0',
  // G: north inner edge
  '31,6:2 32,6:2 33,6:2',
  // J: east inner edge
  '154,29:2',
  // H: north tongue shore
  '108,1:0 109,1:0 110,1:0 111,1:0 113,0:1 114,0:1 115,0:1 114,1:1 115,1:1',
  // Rim cells no sand touches, beside the H shore and in the G notch: the shore rule reads sea under them
  RIM_OVER_SEA.join(' '),
].join(' ').split(' ');

describe('tafa coast', () => {
  it('lays the ground the game shows at its corrected shores', () => {
    const { zones } = getMapTemplate('tafa');
    const read = TAFA_COAST.map((cell) => {
      const [x, y] = cell.split(':')[0]!.split(',').map(Number);
      return `${x},${y}:${zones[y!]![x!]}`;
    });
    expect(read).toEqual(TAFA_COAST);
    expect(TAFA_COAST).toHaveLength(140);
  });

  it('keeps its rim and the ground under it as the shore rule derives them', () => {
    const { zones } = getMapTemplate('tafa');
    const ground = groundUnderRim(zones);
    expect(deriveBoundary(ground)).toEqual(zones);
    expect(RIM_OVER_SEA.map((cell) => {
      const [x, y] = cell.split(':')[0]!.split(',').map(Number);
      return ground[y!]![x!];
    })).toEqual([CellZone.Void, CellZone.Void, CellZone.Void]);
  });
});
