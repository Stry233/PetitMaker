import { exportableState, type ExportNaming } from '../../io/export/exportable';
import type { ExportableState } from '../../io/save/exportable-state';
import type { GridState } from '../../core/model/types';

/** The English default planet names, as the interface supplies them. */
export const TEST_NAMING: ExportNaming = { defaultName: (index) => `My planet ${index + 1}` };

/** `state` through the export policy, for tests that call an exporter. */
export const exportable = (state: GridState): ExportableState => exportableState(state, TEST_NAMING);
