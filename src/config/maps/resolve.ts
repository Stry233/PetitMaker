import type { MapTemplate } from '../../core/model/types';
import { DEFAULT_MAP, MAP_TEMPLATES } from './index';

export class UnknownTemplateError extends Error {
  constructor(readonly templateId: string | undefined) { super(`Unknown map template "${templateId ?? ''}".`); }
}

/** The template a map names: its embedded planet when the caller parsed one, else a built-in. A save without an id predates multiple planets and opens on the default map; a named id that resolves nowhere throws. */
export function resolveTemplate(id: string | undefined, embedded?: MapTemplate): MapTemplate {
  if (!id) return DEFAULT_MAP;
  if (embedded && embedded.id === id) return embedded;
  if (Object.prototype.hasOwnProperty.call(MAP_TEMPLATES, id)) return MAP_TEMPLATES[id]!;
  throw new UnknownTemplateError(id);
}

/** A map named by a built-in id, or the template itself when the built-in registry does not hold
 *  it. An id that names no built-in throws rather than switching to the default planet. */
export function templateOf(target: string | MapTemplate): MapTemplate {
  return typeof target === 'string' ? resolveTemplate(target) : target;
}
