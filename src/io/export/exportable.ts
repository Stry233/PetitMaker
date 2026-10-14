/**
 * The map as it may leave the browser, the one owner of what an export carries: a custom planet
 * under its shown name (its approved name, or its default name while the name is unchecked or
 * refused) and only the custom tags the text check has approved. Both exporters, the share code and
 * the sectioned JSON, accept only an `ExportableState`. Autosave keeps the map's own name and every
 * tag, so a later approval restores them.
 */
import { keepCustomTags } from '../../core/model/annotations';
import { isCustomTemplate } from '../../core/model/planet';
import type { GridState, MapTemplate } from '../../core/model/types';
import { textApproved } from '../../state/text-verdicts';
import { listPlanets, namedTemplate } from '../storage/planet-library';
import { planetNameVerdict } from '../../state/planet-name-verdict';
import type { ExportableState } from '../save/exportable-state';

/** io keeps no localized text: the caller supplies the default name of a library entry. */
export interface ExportNaming {
  /** The default name of the library entry at `index`, or of the next planet at the library's length. */
  defaultName(index: number): string;
}

/** A custom planet's shown name: its approved name, or its default name while unchecked or refused. */
export function shownCustomPlanetName(template: MapTemplate, naming: ExportNaming): string {
  const verdict = planetNameVerdict(template, listPlanets());
  return verdict.status === 'approved' ? verdict.name : naming.defaultName(verdict.index);
}

/** `state` as it may leave the browser. Returns `state` itself when nothing needs hiding. */
export function exportableState(state: GridState, naming: ExportNaming): ExportableState {
  let out = state;
  if (isCustomTemplate(state.template)) {
    const template = namedTemplate(state.template, shownCustomPlanetName(state.template, naming));
    if (template !== state.template) out = { ...out, template };
  }
  const annotations = state.annotations;
  if (annotations?.customTags?.length) {
    const shown = keepCustomTags(annotations, (tag) => textApproved(tag.text));
    if (shown !== annotations) out = { ...out, annotations: shown };
  }
  return out as ExportableState;
}
