import type { Translate } from '../../../i18n/keys';
import { skillTitleKey } from '../../../agent/panel';

/** A loaded skill's title in the interface language; a skill this build does not know keeps the
 *  title its record carries. */
export function skillTitle(skill: { name: string; title: string }, t: Translate): string {
  const key = skillTitleKey(skill.name);
  return key ? t(key) : skill.title;
}
