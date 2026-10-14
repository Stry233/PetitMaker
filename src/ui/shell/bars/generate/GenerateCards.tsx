/** The generate shelf's candidate row: one card per dealt recipe, then the visitor's own. */
import { forwardRef, type CSSProperties } from 'react';
import { useLocale, useT } from '../../../../i18n/context';
import { helpTargetAttr } from '../../../session/help-targets';
import { CandidateCard, ImportCard } from './CandidateCard';
import { CustomCard } from './CustomCard';
import { CANDIDATES, GENERATE_KIND, hasCustomCard } from './generate-shelf';
import { sampleName, type StencilSample } from './stencil-samples';
import type { GenerateRecipe } from './use-generate-recipe';

/** The visitor's own card stands after the dealt ones. */
export const CUSTOM = CANDIDATES;

export interface CardsView {
  shots: readonly (string | null | undefined)[];
  customShot: string | null | undefined;
  appliedIndex: number | null;
  failedIndex: number | null;
  landingIndex: number | null;
  /** Why a dealt card has no picture, or null. */
  noteFor: (sample: StencilSample | null) => string | null;
  ownNote: string | null;
  ownAllowed: boolean;
  ownPending: boolean;
  onRetryOwn?: () => void;
  hand: readonly StencilSample[];
  onSelect: (index: number) => void;
}

/**
 * A card keeps one size and the row scrolls, so the count never shrinks the pictures. The chosen
 * card's plate bleeds into its neighbours, so it stands above them.
 */
export const GenerateCards = forwardRef<HTMLDivElement, {
  recipe: GenerateRecipe;
  view: CardsView;
  cardW: number;
  style: CSSProperties;
}>(function GenerateCards({ recipe, view, cardW, style }, ref) {
  const t = useT();
  const locale = useLocale();
  const { kind, stencil, base } = recipe;
  const slot = (i: number): CSSProperties => ({ flex: '0 0 auto', width: cardW, position: 'relative', zIndex: view.appliedIndex === i ? 1 : 0 });
  const flags = (i: number) => ({ selected: view.appliedIndex === i, failed: view.failedIndex === i, landing: view.landingIndex === i });
  return (
    <div ref={ref} className="pw-noscroll" data-testid="gen-cards-row" {...helpTargetAttr('candidates')} style={style}>
      {(stencil ? view.hand : recipe.seeds).map((entry, i) => {
        const note = view.noteFor(stencil ? (entry as StencilSample) : null);
        return (
          <div key={stencil ? (entry as StencilSample).id : (entry as number)} style={slot(i)}>
            <CandidateCard
              seed={stencil ? base + i : (entry as number)}
              {...(stencil ? { name: sampleName(entry as StencilSample, locale) } : {})}
              {...(note ? { note } : {})}
              shot={view.shots[i]}
              {...flags(i)}
              onSelect={() => view.onSelect(i)}
            />
          </div>
        );
      })}
      {hasCustomCard(kind) && (
        <div style={slot(CUSTOM)}>
          {GENERATE_KIND[kind].input === 'image' ? (
            <ImportCard name={recipe.ownImage?.name ?? null} shot={view.customShot} {...flags(CUSTOM)}
              onPick={recipe.pickImage} onSelect={() => view.onSelect(CUSTOM)} />
          ) : (
            <CustomCard
              field={GENERATE_KIND[kind].input === 'text' ? 'glyph' : 'number'}
              {...(GENERATE_KIND[kind].input === 'text' ? { title: t('generate.custom_text') } : {})}
              {...(view.ownNote ? { note: view.ownNote } : {})}
              seed={recipe.customSeed}
              glyph={recipe.ownText}
              draft={recipe.customDraft}
              shot={view.ownAllowed ? view.customShot : view.ownPending ? undefined : null}
              onRetry={GENERATE_KIND[kind].input === 'text' ? view.onRetryOwn : undefined}
              {...flags(CUSTOM)}
              onDraft={recipe.setCustomDraft}
              onCommit={recipe.commitCustom}
              onEdit={() => recipe.setCustomDraft(GENERATE_KIND[kind].input === 'text' ? (recipe.ownText ?? '') : String(recipe.customSeed ?? ''))}
              onSelect={() => view.onSelect(CUSTOM)}
            />
          )}
        </div>
      )}
    </div>
  );
});
