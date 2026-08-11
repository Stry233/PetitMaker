/**
 * The keymap declares what commands exist; this declares what they do. The two halves have to
 * cover each other exactly, or an id is either unreachable or unlisted.
 */
import { describe, it, expect } from 'vitest';
import { COMMAND_META } from '../../core/runtime/keybindings';
import { COMMANDS, COMMAND_BY_ID, RUN } from '../../kit/commands';

describe('command registry', () => {
  it('implements exactly the declared ids', () => {
    expect(COMMANDS.map((c) => c.id).sort()).toEqual(COMMAND_META.map((c) => c.id).sort());
  });

  it('indexes every command by id', () => {
    expect(COMMAND_BY_ID.size).toBe(COMMANDS.length);
  });

  it('gives every discrete command something to run', () => {
    for (const cmd of COMMANDS.filter((c) => !c.continuous)) {
      expect(typeof cmd.run).toBe('function');
    }
  });

  it('leaves held keys to the rAF loop', () => {
    for (const cmd of COMMANDS.filter((c) => c.continuous)) {
      expect(() => cmd.run({} as never)).not.toThrow();
    }
  });
});

/**
 * `COMMANDS` zips the data half (`COMMAND_META`) with the behaviour half (`RUN`) by id, defaulting
 * a missing key to a no-op (`RUN[meta.id] ?? (() => {})`). That default is silent: a typo'd or
 * forgotten `RUN` entry compiles clean and the command simply does nothing when pressed — which is
 * why the checks above (built from `COMMANDS`) can't catch it. These check `RUN` itself instead.
 */
// UI zoom is registered only to be SHOWN and PROTECTED (see keybindings.ts) — its own always-live
// window listener (canvas/interaction/use-view-shortcuts.ts:useUiZoomShortcut) drives it directly,
// so it never runs through the discrete engine and carries no RUN body.
const NO_RUN_IDS = new Set(['app.ui_zoom_in', 'app.ui_zoom_out']);

describe('COMMAND_META <-> RUN bijection', () => {
  it('every non-continuous command has a RUN body', () => {
    const missing = COMMAND_META
      .filter((c) => !c.continuous && !NO_RUN_IDS.has(c.id) && !(c.id in RUN))
      .map((c) => c.id);
    expect(missing).toEqual([]);
  });

  it('every RUN key names a declared command id', () => {
    const ids = new Set(COMMAND_META.map((c) => c.id));
    const stale = Object.keys(RUN).filter((id) => !ids.has(id));
    expect(stale).toEqual([]);
  });
});
