/** Which map direction a Letter's or Picture's top points: four arrows, each drawn where its direction
 *  lies on screen in the view shown, so a turned view never makes the choice read wrong. */
import { useEffect, useState } from 'react';
import { SIDES, SIDE_DELTA } from '../../../../core/grid/directions';
import type { Rotation } from '../../../../core/model/types';
import { useT } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { getActiveView, onProjectionChange } from '../../../../view/active-view';
import { DirectionArrow, screenAngleOf } from '../../../chrome/floating/map-direction';
import { SegmentedControl } from '../../../primitives/SegmentedControl';
import { STRIP } from './generate-shelf';

const FACINGS = ['0', '90', '180', '270'] as const;
type Facing = typeof FACINGS[number];

/** The map step a facing's top points along: north at 0, then a quarter turn clockwise per step. */
const topOf = (facing: Facing): readonly [number, number] => SIDE_DELTA[SIDES[Number(facing) / 90]!];

export function FacingChoice({ value, onChange, at }: {
  value: Rotation;
  onChange: (facing: Rotation) => void;
  /** The map point the arrows are read at: the middle of what the run fills; null draws north up. */
  at: { x: number; y: number } | null;
}) {
  const t = useT();
  const eventBus = useEditorStore((s) => s.eventBus);
  const [, redraw] = useState(0);
  useEffect(() => onProjectionChange(eventBus, () => redraw((n) => n + 1), { cells: false }), [eventBus]);
  const projection = getActiveView()?.projection;
  return (
    <SegmentedControl<Facing>
      idPrefix="gen-facing" height={STRIP.h} value={String(value) as Facing} options={FACINGS}
      onChange={(next) => onChange(Number(next) as Rotation)} stretch={false}
      render={(o) => <DirectionArrow facing={o} deg={screenAngleOf(...topOf(o), at, projection)} />}
      label={(o) => t(`generate.facing_${o}`)}
    />
  );
}
