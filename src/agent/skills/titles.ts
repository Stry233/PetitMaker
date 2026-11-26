/** The skills this build ships and the locale key each title is shown under. The model reads the
 *  English `title` in `index.ts`; the panel shows the key, falling back to that title for a skill a
 *  record names but this build no longer has. Light, because the panel's first load reads it. */
import type { I18nKey } from '../../i18n/keys';

/** Every skill name; `index.ts:SKILLS` holds exactly these. */
const SKILL_NAMES = [
  'layout-patterns', 'plan-island', 'region-kinds', 'neighbors', 'plan-on-map', 'build-from-plan', 'terrain-shaping', 'pro-terraforming', 'figure-landscape',
] as const;

export type SkillName = typeof SKILL_NAMES[number];

type Snake<S extends string> = S extends `${infer A}-${infer B}` ? `${A}_${Snake<B>}` : S;

/** The title key of skill `name`: the agent skill prefix and the name in snake case. The compiler
 *  checks that every skill's key is a locale key. */
export function skillTitleKey(name: string): I18nKey | undefined {
  if (!(SKILL_NAMES as readonly string[]).includes(name)) return undefined;
  const key: `agent.skill_${Snake<SkillName>}` = `agent.skill_${name.replace(/-/g, '_')}` as `agent.skill_${Snake<SkillName>}`;
  return key;
}
