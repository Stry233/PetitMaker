import type { GridState } from '../../core/model/types';

declare const reviewed: unique symbol;

/** A map that passed `export/exportable.ts:exportableState`, the only function that grants the
 *  brand; both serializers that let a map leave the browser accept nothing else. */
export type ExportableState = GridState & { readonly [reviewed]: true };
