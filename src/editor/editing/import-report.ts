// Turns an import outcome into toasts: the one mapping, shared by every import surface.
import { translate } from '../../i18n/context';
import { showToast } from '../../platform/channels/toast-bus';
import type { FileImportOutcome } from '../../io/import/file';
import type { ImportErrorCode } from '../../io/save/import-error';
import type { I18nKey } from '../../i18n/keys';

/** Map an import error code to an honest, user-facing i18n key. */
function errorKey(code: ImportErrorCode): I18nKey {
  switch (code) {
    case 'not-an-image':
    case 'no-payload': return 'import.fail_none';
    case 'future-version': return 'import.fail_future';
    case 'corrupt':
    case 'decode-failed': return 'import.fail_corrupt';
    case 'malformed':
    case 'incompatible-template': return 'import.fail_generic';
  }
}

export function reportImport(outcome: FileImportOutcome): void {
  switch (outcome.status) {
    case 'imported':
      if (outcome.source === 'json') {
        // .json order: dropped sections before the success toast, the modified-after-export
        // caution last.
        for (const w of outcome.warnings) {
          if (w.kind === 'dropped-section') showToast(translate('import.warn_section', { section: w.section }), 'info');
        }
        showToast(translate('import.success'), 'info');
        if (outcome.warnings.some((w) => w.kind === 'modified-after-export')) showToast(translate('import.warn_modified'), 'error');
      } else {
        // Raster order: success first, then its own drift warnings.
        showToast(translate('import.success'), 'info');
        for (const w of outcome.warnings) {
          if (w.kind === 'template-drift') showToast(translate('import.warn_template'), 'info');
          else if (w.kind === 'catalog-drift') showToast(translate('import.warn_catalog'), 'info');
        }
      }
      break;
    case 'unsupported':
      showToast(translate('import.fail_generic'), 'error');
      break;
    case 'failed':
      showToast(translate(outcome.code ? errorKey(outcome.code) : 'import.fail_generic'), 'error');
      break;
  }
}
