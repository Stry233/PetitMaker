/*
 * The held commands: keymap rows a key serves while it is down rather than on a press. Each one's
 * key is the last segment of its effective combo, read live from the keymap store, so a rebind or
 * an unbind (no key: never held) takes effect at once on every reader.
 */
import { heldToken } from '../../platform/input/combo';
import { isKeyHeld, onHeldKeysChange } from '../../platform/input/held-keys';
import { effectiveCombo, type Overrides } from './resolve';
import type { CommandId } from './registry';
import { useKeybinds } from './store';

/** Constrain snaps shape drags straight, square or round; multi-select turns a click into a
 *  membership toggle and a drag into a rubber band; break-handle turns a curve anchor's two
 *  direction sides apart; pan-drag turns a left drag into a camera pan in any tool mode. */
const HELD_IDS = ['tool.constrain', 'selection.multi', 'tool.break_handle', 'camera.pan_drag'] as const satisfies readonly CommandId[];
export type HeldCommandId = typeof HELD_IDS[number];

let memo: { overrides: Overrides; tokens: Map<HeldCommandId, string> } | null = null;

/** The key each held command waits on under the current overrides, '' for an unbound one. Read on
 *  every pointer move and pan frame, so it is computed once per overrides object. */
function heldKeyOf(id: HeldCommandId): string {
  const overrides = useKeybinds.getState().overrides;
  if (memo?.overrides !== overrides) {
    const tokens = new Map<HeldCommandId, string>();
    for (const held of HELD_IDS) {
      const combo = effectiveCombo(overrides, held);
      tokens.set(held, combo ? heldToken(combo) : '');
    }
    memo = { overrides, tokens };
  }
  return memo.tokens.get(id) ?? '';
}

export function isCommandHeld(id: HeldCommandId): boolean {
  return isKeyHeld(heldKeyOf(id));
}

/**
 * Subscribe to `id` going down or up, by key or by a rebind that moves it. Returns an unsubscribe.
 *
 * A key press runs with no pointer event beside it, so a reader that only recomputes on pointer
 * move would see the new state one mouse move late; the pointer machine and the cursor re-sample
 * on this instead.
 */
export function onCommandHeldChange(id: HeldCommandId, fn: () => void): () => void {
  let last = isCommandHeld(id);
  const check = (): void => {
    const now = isCommandHeld(id);
    if (now === last) return;
    last = now;
    fn();
  };
  const offKeys = onHeldKeysChange(check);
  const offKeymap = useKeybinds.subscribe(check);
  return () => { offKeys(); offKeymap(); };
}
