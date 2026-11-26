/* What a dealt sample is called on its card (`editor/editing/generate-batch.ts:samplePool` holds the samples). */
import type { StencilSample } from '../../../../editor/editing/generate-batch';
import { localizedName } from '../../../../i18n/context';
import { brandName } from '../../../../i18n/terms/brand';
import type { Locale } from '../../../../core/model/locale';

/** A sample's name on its card: its letters, its picture's localized name, or the app's name for its own mark. */
export function sampleName(sample: StencilSample, locale: Locale): string {
  if (sample.text) return sample.text;
  if (sample.name) return localizedName(sample.name, locale);
  return sample.id === 'logo' ? brandName(locale) : sample.id;
}
