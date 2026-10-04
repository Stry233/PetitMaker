import { describe, it, expect } from 'vitest';
import { CellZone, CommandType, TerrainType } from '../../core/model/types';
import { groundLockRule } from '../../rules/ground-lock';
import { createDefaultRegistry } from '../../rules/index';
import { makeState, paintCmd } from './_helpers';

describe('V-GROUND-LOCK', () => {
  it('the default registry refuses any command carrying ground', () => {
    const state = makeState();
    const cmd = { ...paintCmd([{ x: 1, y: 1 }], TerrainType.Mountain, 0), ground: CellZone.Void as const };
    expect(groundLockRule.validate(cmd, state)).toHaveLength(1);
    expect(createDefaultRegistry().validatePreCommand(cmd, state).some((e) => e.ruleId === 'V-GROUND-LOCK')).toBe(true);
    expect(createDefaultRegistry().validatePreCommand({ type: CommandType.EraseTerrain, timestamp: 0, cells: [{ x: 1, y: 1 }], ground: CellZone.Void }, state).length).toBeGreaterThan(0);
  });
  it('ignores ordinary terrain commands', () => {
    expect(groundLockRule.validate(paintCmd([{ x: 1, y: 1 }], TerrainType.Mountain, 1), makeState())).toHaveLength(0);
  });
});
