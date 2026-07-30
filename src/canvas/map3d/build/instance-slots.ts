/**
 * Dense slot bookkeeping for incremental InstancedMesh updates. An
 * InstancedMesh renders instances [0..count): removing from the middle would
 * leave a rendered hole, so removal swap-fills the vacated slot with the
 * group's LAST slot and reports which id moved — the scene copies that
 * instance's matrix/color down and shrinks count by one.
 */
export interface SlotRef { group: string; slot: number }
export interface RemoveResult { group: string; slot: number; moved: { id: string; fromSlot: number } | null }

export class InstanceSlots {
  private byId = new Map<string, SlotRef>();
  private byGroup = new Map<string, string[]>(); // slot index → id

  /** Assign the next slot in `group` to `id` (re-adding first frees the old slot). */
  add(id: string, group: string): number {
    if (this.byId.has(id)) this.remove(id);
    let list = this.byGroup.get(group);
    if (!list) { list = []; this.byGroup.set(group, list); }
    const slot = list.length;
    list.push(id);
    this.byId.set(id, { group, slot });
    return slot;
  }

  /** Free `id`'s slot, keeping the group dense. Returns the vacated slot and
   *  which id (if any) moved into it from the group's end; null for unknown ids. */
  remove(id: string): RemoveResult | null {
    const ref = this.byId.get(id);
    if (!ref) return null;
    const list = this.byGroup.get(ref.group)!;
    const lastSlot = list.length - 1;
    const lastId = list[lastSlot]!;
    this.byId.delete(id);
    list.pop();
    if (ref.slot === lastSlot) {
      return { group: ref.group, slot: ref.slot, moved: null };
    }
    list[ref.slot] = lastId;
    this.byId.set(lastId, { group: ref.group, slot: ref.slot });
    return { group: ref.group, slot: ref.slot, moved: { id: lastId, fromSlot: lastSlot } };
  }

  slotOf(id: string): SlotRef | null {
    return this.byId.get(id) ?? null;
  }

  count(group: string): number {
    return this.byGroup.get(group)?.length ?? 0;
  }

  idAt(group: string, slot: number): string | null {
    return this.byGroup.get(group)?.[slot] ?? null;
  }

  *entriesOf(group: string): IterableIterator<{ id: string; slot: number }> {
    const list = this.byGroup.get(group);
    if (!list) return;
    for (let slot = 0; slot < list.length; slot++) yield { id: list[slot]!, slot };
  }
}
