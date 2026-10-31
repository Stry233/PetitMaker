/**
 * Property: the upright object grid with no height set rests within what `bar.room` leaves it, so the
 * resting panel stands clear of undo and redo, while a height the handle set may reach past the column
 * up to `bar.reach`; every height stays between one row and that reach, and the grid never rests
 * between one row and the height where a second row fits.
 */
import { describe, expect } from 'vitest';
import { spec } from '../../../_support/spec';
import { uprightGridHeight } from '../../../../ui/shell/bars/objects/UprightObjectPanel';

const LEAST = 110;
const TURN = 2 * LEAST;
const ROOMS = [0, 150, 240, 330, 480];
const REACHES = [300, 420, 640];
const RESTING = [90, 275, 600];

/** What the panel stands around its grid, read off the function: the most a reach leaves the grid. */
const surround = (reach: number) => reach - uprightGridHeight({ asked: null, least: 0, turn: 0, resting: 0, room: reach, reach }).most;

describe('the upright object grid height', () => {
  spec('UI-28', 'with no height set the grid rests within the room under the column, however far a handle could draw it', () => {
    for (const room of ROOMS) for (const reach of REACHES) for (const resting of RESTING) {
      if (reach < room) continue;
      const at = `room ${room} reach ${reach} resting ${resting}`;
      const { height, most } = uprightGridHeight({ asked: null, least: LEAST, turn: TURN, resting, room, reach });
      expect(height + surround(reach), at).toBeLessThanOrEqual(Math.max(room, LEAST + surround(reach)) + 1e-9);
      expect(height, at).toBeGreaterThanOrEqual(LEAST);
      expect(height, at).toBeLessThanOrEqual(most);
      expect(height === LEAST || height >= TURN, at).toBe(true);
    }
  });

  spec('UI-28', 'a height the handle set is kept between one row and the reach over the column, one short of two rows resting at one row', () => {
    for (const room of ROOMS) for (const reach of REACHES) {
      if (reach < room) continue;
      const { most, kept } = uprightGridHeight({ asked: null, least: LEAST, turn: TURN, resting: 0, room, reach });
      expect(most + surround(reach)).toBeCloseTo(Math.max(reach, LEAST + surround(reach)));
      for (const asked of [0, LEAST, 160, TURN - 1, TURN, 260, 5000]) {
        const { height } = uprightGridHeight({ asked, least: LEAST, turn: TURN, resting: 0, room, reach });
        // A drag's clamp is the range the panel rests in; within it, short of two rows rests at one.
        const drawn = Math.min(most, Math.max(LEAST, asked));
        expect(kept(asked)).toBe(drawn);
        expect(height, `asked ${asked} reach ${reach}`).toBe(drawn < TURN ? LEAST : drawn);
      }
    }
  });

  spec('UI-28', 'a keyboard step up from one row reaches two rows where the reach holds them, and a step down below two rows rests at one', () => {
    const half = LEAST / 2;
    for (const reach of REACHES) {
      const { most, step } = uprightGridHeight({ asked: LEAST, least: LEAST, turn: TURN, resting: 0, reach });
      const up = uprightGridHeight({ asked: step(half), least: LEAST, turn: TURN, resting: 0, reach }).height;
      expect(up).toBe(most >= TURN ? TURN : LEAST);
      const down = uprightGridHeight({ asked: TURN, least: LEAST, turn: TURN, resting: 0, reach });
      expect(uprightGridHeight({ asked: down.step(-half), least: LEAST, turn: TURN, resting: 0, reach }).height).toBe(LEAST);
    }
  });
});
