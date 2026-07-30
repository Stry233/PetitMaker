// Turns an `importFile()` outcome into toasts: the ONE mapping, shared by the Import modal and the
// window-level drop overlay.
import { translate } from '../../../i18n/context';
import { showToast } from '../Toast';
import type { FileImportOutcome } from '../../../io/import-file';
import type { ShareErrorCode } from '../../../io/share';

/** Map a ShareError code to an honest, user-facing i18n key. */
function errorKey(code: ShareErrorCode): string {
  switch (code) {
    case 'not-an-image':
    case 'no-payload': return 'import.fail_none';
    case 'future-version': return 'import.fail_future';
    case 'corrupt':
    case 'decode-failed': return 'import.fail_corrupt';
    default: return 'import.fail_generic'; // incompatible-template / missing-catalog-item / validation-failed
  }
}

export function toastImportOutcome(outcome: FileImportOutcome): void {
  switch (outcome.status) {
    case 'imported':
      if (outcome.source === 'json') {
        // .json order: dropped sections BEFORE the success toast, the modified-after-export
        // caution LAST.
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
