// Turns an import outcome into toasts: the one mapping, shared by every import surface.
import { translate } from '../../i18n/context';
import { showToast } from '../../platform/channels/toast-bus';
import type { FileImportOutcome, ImportRefusal } from '../../io/import/file';
import { MAX_IMPORT_BYTES } from '../../io/save/limits';
import { SECTION_LABELS } from '../../io/save/facts';
import type { I18nKey } from '../../i18n/keys';

/** What a refused read says, in words about the file it was given: a map file's failures never
 *  speak of an image, and an image's say whether its code was absent, damaged or newer. */
function failureKey({ code, source }: Extract<ImportRefusal, { status: 'failed' }>): I18nKey {
  if (code === 'future-version') return 'import.fail_future';
  if (code === 'incompatible-template') return 'import.fail_planet';
  if (source === 'json') return code ? 'import.fail_file' : 'import.fail_generic';
  if (source === 'raster') {
    switch (code) {
      case undefined: return 'import.fail_image';
      case 'not-an-image':
      case 'no-payload': return 'import.fail_none';
      case 'corrupt':
      case 'decode-failed':
      case 'malformed': return 'import.fail_corrupt';
    }
  }
  return 'import.fail_generic';
}

export function reportImport(outcome: FileImportOutcome): void {
  switch (outcome.status) {
    case 'imported':
      if (outcome.source === 'json') {
        // .json order: dropped sections before the success toast, the modified-after-export
        // caution last.
        for (const w of outcome.warnings) {
          if (w.kind === 'dropped-section') showToast(translate('import.warn_section', { section: translate(SECTION_LABELS[w.section]) }), 'info');
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
      showToast(translate('import.fail_unsupported'), 'error');
      break;
    case 'too-large':
      showToast(translate('import.fail_too_large', { size: MAX_IMPORT_BYTES / (1024 * 1024) }), 'error');
      break;
    case 'failed':
      showToast(translate(failureKey(outcome)), 'error');
      break;
  }
}
