import type { Command, ValidationError } from './types';
import type { CellSet } from '../grid/grids';
import type { CommandSink } from './command-sink';

/** The executor as a stroke policy sees it: the map, and the two command doors its repairs use.
 *  Repairs issued through `execute` join the open stroke's history like any other command. */
export interface StrokeKernel extends CommandSink {
  /** Pre-command validation without executing or emitting: a refusal here is an outcome. */
  validatePre(cmd: Command): ValidationError[];
}

/**
 * What a game adds to a stroke beyond the rules: repairs that keep the map's invariants. Hook order:
 * 1. `afterCommand` after each command, its repairs recorded as derived; not re-entered by them.
 * 2. At commit, `beforeValidate` over the changed cells, each set on its own grid (skipped when
 *    nothing changed and `pending` holds no work), recorded as derived and validated with the stroke.
 * 3. `endStroke`, before the post-stroke rules, and whenever the open stroke is abandoned.
 * 4. The post-stroke rules and their automatic revert.
 * 5. `afterValidate` over the cells still changed after the revert, recorded as derived.
 * A commit without reconcile skips 2 and 5. Each executor gets its own instance; `{}` adds nothing.
 */
export interface StrokePolicy {
  afterCommand?(kernel: StrokeKernel, cmd: Command): void;
  pending?(): boolean;
  beforeValidate?(kernel: StrokeKernel, changed: readonly CellSet[]): void;
  endStroke?(): void;
  afterValidate?(kernel: StrokeKernel, changed: readonly CellSet[]): void;
}
