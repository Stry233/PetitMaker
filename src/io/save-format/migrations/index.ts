import type { Migration } from '../types';
import { v1ToV2 } from './001-v1-to-v2';

/**
 * The migration chain, append-only and in ascending version order. Each entry
 * lifts vN → vN+1.
 *
 * RULES (what keeps this maintainable for years):
 *  - Append only. NEVER edit a migration once it has shipped — that retroactively
 *    changes how already-saved files load. Fix forward with a new migration.
 *  - Pure JSON → JSON. A migration must not import domain types (core/*), so it
 *    keeps working after the in-memory model changes.
 *  - One file per step (NNN-vX-to-vY.ts), each shipping with a frozen fixture of
 *    the version it consumes (src/__tests__/io/__fixtures__/).
 */
export const MIGRATIONS: Migration[] = [v1ToV2];
