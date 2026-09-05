/*
 * page-schema.ts — the shape of one Help Center page, as data.
 *
 * Prose is i18n keys (always full literals, so the key scan sees them); facts the source already
 * declares arrive as `{token}` params supplied at render (`facts.ts`), never retyped; key rows
 * carry COMMAND IDS resolved through the live keymap (`ui/hints/catalogue.ts:resolveTokenSpecs`),
 * so a rebind reaches the page with no wiring. Figures are named scenes (the canvas demo engine)
 * or named surfaces (the real interface mounted live); a page never embeds drawing code of its own.
 */
import type { TokenSpec } from '../../../hints/catalogue';

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
export interface HelpKeyRow {
  doKey: string;
  tokens: readonly TokenSpec[];
}

export type HelpSection =
  /** A heading and one or more paragraphs. Body strings may mark gestures with `**bold**`. */
  | { kind: 'prose'; anchor: string; titleKey: string; bodyKeys: readonly string[]; figure?: HelpFigure }
  /** A heading over a key table, with optional prose after it. */
  | { kind: 'keys'; anchor: string; titleKey: string; rows: readonly HelpKeyRow[]; afterKeys?: readonly string[] }
  /** A yellow aside between sections. */
  | { kind: 'callout'; bodyKey: string };

export interface HelpQA {
  qKey: string;
  aKey: string;
}

/** A demo narrates itself (the animated caption inside the canvas), so only a surface figure
 *  carries a static caption — a second line under a demo said the same thing twice. */
export type HelpFigure =
  | { kind: 'demo'; scene: string }
  /** Several small demos side by side, each with its own label line. */
  | { kind: 'demos'; scenes: readonly { scene: string; labelKey: string }[] }
  | { kind: 'surface'; surface: string; captionKey: string };

/** A page-level verb: the one live door a page offers beside its prose. */
export interface HelpAction {
  labelKey: string;
  kind: 'open-keyboard' | 'replay-tour';
}

export interface HelpPage {
  id: HelpPageId;
  /** The welcome page's banner treatment: brand lockup over a centered title and lede. */
  hero?: true;
  group: HelpGroupId;
  titleKey: string;
  /** A shorter name for the nav column; the page heading keeps `titleKey`. */
  navKey?: string;
  ledeKey: string;
  figure?: HelpFigure;
  action?: HelpAction;
  sections: readonly HelpSection[];
  qa: readonly HelpQA[];
  seeAlso: readonly HelpPageId[];
}
