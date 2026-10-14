import type { Translate } from '../../i18n/keys';
/**
 * What a floor of the stack is called, in one place: the ground stores no terrain and has a word of its own
 * rather than "layer 0", and every surface naming floors reads this.
 */

/** The translator, as `i18n/context:useT` returns it. */

export function layerName(t: Translate, elevation: number): string {
  return elevation === 0 ? t('layer.ground') : t('layer.name', { n: elevation });
}
