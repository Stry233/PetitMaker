/*
 * One Help Center page as data: prose as literal i18n keys, source facts as `{token}` params
 * (`facts.ts`), and key rows as command ids resolved through the live keymap. A
 * page's pictures are the interface's own and are keyed by page id and section anchor above this layer.
 */
import type { TokenSpec } from './key-tokens';
import type { Locale } from '../../core/model/locale';
import type { TextKey } from '../../i18n/keys';
import type { AssistantProviderId } from '../../i18n/terms/providers';
import type { EditionNeed, EditionVariant } from '../../platform/build/edition';

/** The `{token}` values whose owners rank above this layer: the assistant's limits and provider
 *  lists, and the settings Help's Generate figures show side by side. `facts.ts` builds every other. */
export type HelpFactAbove =
  | 'agentMaxTurns' | 'agentChildTurns' | 'agentTries' | 'agentFirstWaitMinutes' | 'agentBetweenWaitMinutes'
  | 'agentProviderCount' | 'agentProviders' | 'regionalAgentProviders'
  | 'richShots' | 'tallShotLayers' | 'contrastShots' | 'reliefShotLayers';

/** Those values per locale, which a reader that has them passes in (`facts.ts:helpFacts`). */
export type HelpFactsOf = (locale: Locale) => Readonly<Record<HelpFactAbove, string | number>>;

/** A Help entry with its offline-edition variant: `lite: false` leaves it out there, and an object
 *  replaces those fields (`platform/build/edition.ts:forEdition`). */
type Editioned<T> = T & EditionVariant<Omit<T, 'kind'>>;

export type HelpGroupId = 'start' | 'build' | 'blueprint' | 'generate' | 'plan' | 'share' | 'agent' | 'misc';

export type HelpPageId =
  | 'welcome' | 'frame' | 'camera' | 'touch' | 'tour'
  | 'terrain' | 'trim' | 'objects' | 'search' | 'select' | 'copy' | 'smart'
  | 'blueprint' | 'blueprint-save' | 'blueprint-place' | 'blueprint-groups' | 'blueprint-library' | 'blueprint-files'
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
  provider: AssistantProviderId;
  stepKeys: readonly TextKey[];
}

/** One list entry: its copy and, where the interface links to it, its anchor. */
interface HelpListItem {
  key: TextKey;
  anchor?: string;
}

export type HelpSection =
  /** A heading and one or more paragraphs. Body strings may mark gestures with `**bold**`. */
  | Editioned<{ kind: 'prose'; anchor: string; titleKey: TextKey; bodyKeys: readonly TextKey[] }>
  /** A heading, optional paragraphs, then one bulleted step list per provider. */
  | Editioned<{ kind: 'steps'; anchor: string; titleKey: TextKey; bodyKeys?: readonly TextKey[]; groups: readonly HelpStepGroup[] }>
  /** A heading, optional paragraphs, then a numbered (`ordered`) or bulleted list; an item with an
   *  anchor is a deep-link target of its own. */
  | Editioned<{ kind: 'list'; anchor: string; titleKey: TextKey; bodyKeys?: readonly TextKey[]; ordered?: true; items: readonly HelpListItem[] }>
  /** A heading over a key table, with optional prose after it. */
  | Editioned<{ kind: 'keys'; anchor: string; titleKey: TextKey; rows: readonly HelpKeyRow[]; afterKeys?: readonly TextKey[] }>
  /** A yellow aside between sections. */
  | Editioned<{ kind: 'callout'; bodyKey: TextKey }>;

type HelpQA = Editioned<{
  qKey: TextKey;
  aKey: TextKey;
}>;

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
  action?: HelpAction;
  sections: readonly HelpSection[];
  qa: readonly HelpQA[];
  seeAlso: readonly HelpPageId[];
  /** False where the offline edition does not ship the page; an object replaces those fields there
   *  (`platform/build/edition.ts:forEdition`). */
  lite?: false | Partial<Omit<HelpPage, 'id' | 'lite'>>;
  /** The capability a build needs to ship the page. */
  needs?: EditionNeed;
}
