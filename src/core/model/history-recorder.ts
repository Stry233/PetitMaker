import type { CellSnapshot, Command, MacroCoord, PlacedObject } from './types';
import type { Author, TaintDelta } from '../provenance/tracker';
import type { MapProvenanceSummary, ProvenanceState, SourceContext } from '../provenance/types';

/** What the editor reads of a map's authorship, and the one way it carries authorship over from
 *  another map; reached through `CommandExecutor.getAuthorship()`. */
export interface Authorship {
  /** Whose work the cell or object is; null when nothing recorded touched it. */
  cellAuthor(x: number, y: number): Author;
  objectAuthor(id: string): Author;
  /** The authorship commands record under right now. */
  currentSource(): SourceContext;
  /** Carry `prev`'s authorship onto this map, shifted by `offset`, for the cells and objects kept. */
  adoptTransplant(prev: ProvenanceState, offset: MacroCoord, keepCell: (x: number, y: number) => boolean, keepObject: (id: string) => boolean): void;
  getSummary(): MapProvenanceSummary;
}

/**
 * What the executor tells about each history step, and what it reads back: authorship. The
 * executor calls it around state mutation in a fixed order: `capture` after a command applies,
 * `revertTaint` and `reapplyTaint` before an entry's cells are restored, and `deriveScope` around
 * the stroke policy's repairs so the commands they issue record as derived. Each executor gets its own,
 * bound to the executor's map (`commands/provenance-recorder.ts:ProvenanceRecorder`).
 */
export interface HistoryRecorder extends Authorship {
  /** The mark a just-applied command leaves on its history entry, if any; `objects` is the
   *  entry's object effect. */
  capture(cmd: Command, before: CellSnapshot[], after: CellSnapshot[], objects?: { removed: PlacedObject[]; added: PlacedObject[] }): TaintDelta | undefined;
  /** One mark for a collapsed group of entries. */
  mergeGroup(marks: (TaintDelta | undefined)[]): TaintDelta | undefined;
  revertTaint(mark: TaintDelta): void;
  reapplyTaint(mark: TaintDelta): void;
  deriveScope<T>(fn: () => T): T;
  pushSource(ctx: SourceContext): void;
  popSource(): void;
  withSource<T>(ctx: SourceContext, fn: () => T): T;
}
