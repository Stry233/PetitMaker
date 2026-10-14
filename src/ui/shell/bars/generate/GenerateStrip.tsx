/** The generate shelf's settings strip inside its band: the scope chip, then the kind's own knobs. */
import { forwardRef, type CSSProperties } from 'react';
import { localizedName, useLocale, useT } from '../../../../i18n/context';
import { getCatalogItem } from '../../../../state/catalog';
import { useEditorStore } from '../../../../state/store';
import { helpTargetAttr } from '../../../session/help-targets';
import { SegmentedControl } from '../../../primitives/SegmentedControl';
import { layerName } from '../../../session/layer-name';
import { TEXT } from '../../units';
import { BarSlider } from '../BarSlider';
import { Knob, StripChip, StripSwitch } from './generate-controls';
import {
  CONTRAST, CORRIDOR, GENERATE_KIND, RICHNESS, SLIDERS, STRIP, fillKindsFor, fillLabelKey, fillTakesElevation, fillTakesItem,
} from './generate-shelf';
import type { GenerateRecipe } from './use-generate-recipe';
import type { MazeEndsState } from './use-maze-ends';

import sliderKnob from '../../../../assets/shell/shelf-generate/slider-naturalness/ellipse-1.svg';
import sliderPip from '../../../../assets/shell/shelf-generate/slider-naturalness/ellipse-2.svg';
import sliderTick from '../../../../assets/shell/shelf-generate/slider-naturalness/ticks/ellipse-1.svg';

/** Slider marks reused across variable-width generated tracks. */
const SLIDER_ART = { knob: sliderKnob, pip: sliderPip, tick: sliderTick };
/** The design draws three marks on a track, whatever the range behind it. */
const SLIDER_TICKS = 3;

/**
 * Every control a kind offers stands on every state of it, dimmed and reading n/a where it cannot
 * act, so nothing beside it moves as a neighbour is pressed; a kind that lacks a control altogether
 * (the letter's tallest layer, the picture's item) swaps its whole row.
 */
export const GenerateStrip = forwardRef<HTMLDivElement, {
  recipe: GenerateRecipe;
  ends: MazeEndsState;
  scopeSays: string;
  style: CSSProperties;
}>(function GenerateStrip({ recipe, ends, scopeSays, style }, ref) {
  const t = useT();
  const locale = useLocale();
  const setSelectingRegion = useEditorStore((s) => s.setSelectingRegion);
  const { kind, stencil, fillKind, fillItem } = recipe;
  const traits = GENERATE_KIND[kind];
  const takesItem = fillTakesItem(kind, fillKind);
  const chosenItem = fillItem ? getCatalogItem(fillItem) : null;
  const itemName = chosenItem ? localizedName(chosenItem.name, locale) : null;
  // The upper slot holds the kind's own knob: corridor width for the maze, richness otherwise.
  const upper = traits.corridor
    ? {
      label: t('generate.corridor'),
      reading: t('units.cells', { n: recipe.corridorWidth }),
      min: CORRIDOR.min, max: CORRIDOR.max, value: recipe.corridorWidth, set: recipe.setCorridorWidth,
    }
    : {
      label: t('generate.richness'), reading: t('generate.percent', { n: recipe.richness }),
      min: RICHNESS.min, max: RICHNESS.max, value: recipe.richness, set: recipe.setRichness,
    };
  const slider = (
    { label, value, set, reading, min, max }: { label: string; value: number; set: (v: number) => void; reading: string; min: number; max: number },
    shape = SLIDERS.upper, disabled = false,
  ) => (
    <Knob label={label} control={(
      <BarSlider art={SLIDER_ART} shape={shape} ticks={SLIDER_TICKS} min={min} max={max}
        value={value} onChange={set} label={label} valueText={reading} {...(disabled ? { disabled } : {})} />
    )} />
  );
  return (
    <div ref={ref} className="pw-noscroll" data-testid="shell-gen-strip" style={style}>
      <span {...helpTargetAttr('region')} style={{ flex: '0 0 auto' }}>
        <StripChip testId="shell-gen-scope" name={t('generate.scope')} value={scopeSays} onOpen={() => setSelectingRegion(true)} />
      </span>
      <span style={{ flex: '1 1 auto', minWidth: 0 }} />
      {traits.gates ? (
        <>
          <StripSwitch testId="shell-gen-ends" label={t('generate.ends')} on={ends.customEnds} onToggle={ends.toggleEnds} />
          {/* The way answers for the chosen pair, so it refuses until the ends are chosen. */}
          <StripSwitch testId="shell-gen-route" label={t('generate.way')} on={ends.showWay}
            onToggle={() => ends.setShowWay(!ends.showWay)} disabled={!ends.customEnds} />
        </>
      ) : null}
      {stencil ? (
        <Knob groove={false} control={(
          // The segments name the choice, so the group's name is announced rather than drawn.
          <span role="group" aria-label={t('generate.built_from')} style={{ pointerEvents: 'auto', display: 'flex' }} data-testid="shell-gen-fill">
            <SegmentedControl
              idPrefix="gen-fill" height={STRIP.h} value={fillKind} options={fillKindsFor(kind)}
              onChange={(next) => {
                recipe.setFillKind(next);
                // An object letter with nothing chosen opens the shelf that chooses one; a picture matches its own items.
                if (fillTakesItem(kind, next) && !fillItem) recipe.setPickingItem(true);
              }}
              render={(o) => t(fillLabelKey(kind, o))} stretch={false} fontSize={TEXT.label}
            />
          </span>
        )} />
      ) : slider(upper)}
      {traits.pickItem ? (
        <StripChip testId="shell-gen-item" name={t('generate.fill_item')}
          value={takesItem ? itemName ?? t('generate.fill_pick') : t('generate.not_applicable')}
          width={STRIP.chip} disabled={!takesItem} onOpen={() => recipe.setPickingItem(true)} />
      ) : null}
      {traits.contrast
        ? slider({
          label: t('generate.contrast'), value: recipe.contrast, set: recipe.setContrast,
          reading: t('generate.percent', { n: recipe.contrast }), min: CONTRAST.min, max: CONTRAST.max,
        })
        : null}
      {traits.elevation !== 'none' ? slider({
        label: t('generate.max_layer'), value: recipe.elevation, set: recipe.setMaxElevation,
        reading: fillTakesElevation(kind, fillKind) ? layerName(t, recipe.elevation) : t('generate.not_applicable'),
        min: recipe.floor, max: recipe.ceiling,
      }, SLIDERS.maxLayer, !fillTakesElevation(kind, fillKind)) : null}
    </div>
  );
});
