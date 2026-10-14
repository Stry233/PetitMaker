/*
 * One Help Center page as data: prose as literal i18n keys, source facts as `{token}` params
 * (`facts.ts`), key rows as command ids resolved through the live keymap, and figures as named scenes
 * or named surfaces, never drawing code of its own.
 */
import type { TokenSpec } from './hints/catalogue';
import type { ProviderId } from '../../agent/panel';
import type { TextKey } from '../../i18n/keys';
import type { EditionVariant } from '../../platform/build/edition';

/** A Help entry with its offline-edition variant: `lite: false` leaves it out there, and an object
 *  replaces those fields (`platform/build/edition.ts:forEdition`). */
type Editioned<T> = T & EditionVariant<Omit<T, 'kind'>>;

export type HelpGroupId = 'start' | 'build' | 'generate' | 'plan' | 'share' | 'agent' | 'misc';

export type HelpPageId =
  | 'welcome' | 'frame' | 'camera' | 'tour'
  | 'terrain' | 'trim' | 'objects' | 'search' | 'select' | 'smart'
  | 'generate' | 'gen-island' | 'maze' | 'gen-letter' | 'gen-picture' | 'candidates' | 'region'
  | 'notes' | 'layers' | 'load' | 'undo'
  | 'save' | 'share' | 'json' | 'checklist' | 'planet'
  | 'agent-intro' | 'agent-setup' | 'agent-run' | 'agent-trail' | 'agent-region' | 'agent-trouble' | 'agent-undo'
  | 'settings' | 'shortcuts' | 'faq';

/** One row of a key table: what it does, and the tokens that do it (command ids where possible). */
type HelpKeyRow = Editioned<{
  doKey: TextKey;
  tokens: readonly TokenSpec[];
}>;

/** One provider's bulleted walkthrough; its name and console links are read from `PROVIDER_META`. */
interface HelpStepGroup {
  provider: ProviderId;
  stepKeys: readonly TextKey[];
}

export type HelpSection =
  /** A heading and one or more paragraphs. Body strings may mark gestures with `**bold**`. */
  | Editioned<{ kind: 'prose'; anchor: string; titleKey: TextKey; bodyKeys: readonly TextKey[]; figure?: HelpFigure }>
  /** A heading, optional paragraphs, then one bulleted step list per provider. */
  | Editioned<{ kind: 'steps'; anchor: string; titleKey: TextKey; bodyKeys?: readonly TextKey[]; groups: readonly HelpStepGroup[] }>
  /** A heading over a key table, with optional prose after it. */
  | Editioned<{ kind: 'keys'; anchor: string; titleKey: TextKey; rows: readonly HelpKeyRow[]; afterKeys?: readonly TextKey[] }>
  /** A yellow aside between sections. */
  | Editioned<{ kind: 'callout'; bodyKey: TextKey }>;

type HelpQA = Editioned<{
  qKey: TextKey;
  aKey: TextKey;
}>;

/** A demo narrates itself (the animated caption inside the canvas), so only a surface figure
 *  carries a static caption — a second line under a demo said the same thing twice. */
type HelpFigure =
  | { kind: 'demo'; scene: string }
  /** Several small demos side by side, each with its own label line. */
  | { kind: 'demos'; scenes: readonly { scene: string; labelKey: TextKey }[] }
  | { kind: 'surface'; surface: string; captionKey: TextKey };

/** A page-level verb: the one live door a page offers beside its prose. */
interface HelpAction {
  labelKey: TextKey;
  kind: 'open-keyboard' | 'replay-tour';
}

export interface HelpPage {
  id: HelpPageId;
  /** The welcome page's banner treatment: brand lockup over a centered title and lede. */
  hero?: true;
  group: HelpGroupId;
  titleKey: TextKey;
  /** A shorter name for the nav column; the page heading keeps `titleKey`. */
  navKey?: TextKey;
  ledeKey: TextKey;
  /** Where to find the feature, displayed with the summary. */
  entryKey: TextKey;
  figure?: HelpFigure;
  action?: HelpAction;
  sections: readonly HelpSection[];
  qa: readonly HelpQA[];
  seeAlso: readonly HelpPageId[];
  /** False where the offline edition does not ship the page; an object replaces those fields there
   *  (`platform/build/edition.ts:forEdition`). */
  lite?: false | Partial<Omit<HelpPage, 'id' | 'lite'>>;
}
