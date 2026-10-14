import { describe, expect, it } from 'vitest';
import { transferLoss } from '../../../../ui/shell/windows/planet-arrival';

const none = { cells: 0, objects: 0 };

describe('transferLoss', () => {
  it('names nothing when the carry left nothing behind', () => {
    expect(transferLoss({ moved: { cells: 4, objects: 2 }, dropped: none })).toBeNull();
    expect(transferLoss({ moved: none, dropped: none })).toBeNull();
  });

  it('says what was left behind beside what came along', () => {
    expect(transferLoss({ moved: { cells: 4, objects: 2 }, dropped: { cells: 3, objects: 1 } }))
      .toEqual({ key: 'arrival.transferred_both', params: { cells: 3, objects: 1 } });
    expect(transferLoss({ moved: { cells: 4, objects: 2 }, dropped: { cells: 3, objects: 0 } }))
      .toEqual({ key: 'arrival.transferred_ground', params: { cells: 3 } });
    expect(transferLoss({ moved: { cells: 4, objects: 2 }, dropped: { cells: 0, objects: 1 } }))
      .toEqual({ key: 'arrival.transferred_pieces', params: { objects: 1 } });
  });

  it('says everything was lost when nothing came along', () => {
    expect(transferLoss({ moved: none, dropped: { cells: 3, objects: 1 } })).toEqual({ key: 'arrival.transferred_lost' });
  });
});
