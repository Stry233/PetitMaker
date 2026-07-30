/**
 * Slot bookkeeping for incremental InstancedMesh updates: each object id owns
 * one slot in its group's dense [0..count) range; removal swap-fills the hole
 * with the LAST slot so the range stays dense (the mesh renders count
 * instances, never a gap).
 */
import { describe, it, expect } from 'vitest';
import { InstanceSlots } from '../../canvas/map3d/build/instance-slots';

describe('InstanceSlots', () => {
  it('adds ids to consecutive slots per group', () => {
    const slots = new InstanceSlots();
    expect(slots.add('a', 'g1')).toBe(0);
    expect(slots.add('b', 'g1')).toBe(1);
    expect(slots.add('c', 'g2')).toBe(0);
    expect(slots.count('g1')).toBe(2);
    expect(slots.slotOf('b')).toEqual({ group: 'g1', slot: 1 });
  });

  it('removing the last slot shrinks without a move', () => {
    const slots = new InstanceSlots();
    slots.add('a', 'g'); slots.add('b', 'g');
    expect(slots.remove('b')).toEqual({ group: 'g', slot: 1, moved: null });
    expect(slots.count('g')).toBe(1);
    expect(slots.slotOf('b')).toBeNull();
  });

  it('removing a middle slot moves the last id into the hole', () => {
    const slots = new InstanceSlots();
    slots.add('a', 'g'); slots.add('b', 'g'); slots.add('c', 'g');
    expect(slots.remove('a')).toEqual({ group: 'g', slot: 0, moved: { id: 'c', fromSlot: 2 } });
    expect(slots.slotOf('c')).toEqual({ group: 'g', slot: 0 });
    expect(slots.count('g')).toBe(2);
  });

  it('unknown removals return null; re-adding an id replaces its old slot', () => {
    const slots = new InstanceSlots();
    expect(slots.remove('ghost')).toBeNull();
    slots.add('a', 'g'); slots.add('b', 'g');
    slots.add('a', 'g'); // replace: same id lands in a fresh slot, old slot freed
    expect(slots.count('g')).toBe(2);
    const s = slots.slotOf('a');
    expect(s).not.toBeNull();
  });

  it('ids of a group enumerate with their slots', () => {
    const slots = new InstanceSlots();
    slots.add('a', 'g'); slots.add('b', 'g');
    expect([...slots.entriesOf('g')].sort((x, y) => x.slot - y.slot).map((e) => e.id)).toEqual(['a', 'b']);
  });
});
