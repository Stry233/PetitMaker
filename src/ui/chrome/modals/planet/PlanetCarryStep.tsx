/**
 * Change Planet's second step: the build laid onto the destination, with every cell that does not
 * fit in red, beside the destination as it opens empty. The two are radio options; a tap on either
 * picture chooses it and a drag pans it.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { GridState, MapTemplate } from '../../../../core/model/types';
import { useT } from '../../../../i18n/context';
import {
  cachedCarryPreview, carryPreviewsVersion, requestCarryPreview, subscribeCarryPreviews,
} from '../../../../editor/operations/transfer-map';
import type { TransferPreview } from '../../../../tools/generation/run';
import { planetBounds } from '../../../../view/map2d/capture/planet-painter';
import { PlanetPreview } from './PlanetPreview';
import { PictureChoices } from './PictureOption';
import { useEditorStore } from '../../../../state/store';

export type Carry = 'carry' | 'fresh';

const liveNotesEpoch = (): number => useEditorStore.getState().annotationsEpoch;

/**
 * The build as it would arrive on `target`, or null while it is being worked out
 * (`editor/operations/transfer-map.ts:requestCarryPreview`, which waits `settleMs` where no worker
 * runs). A request whose target, map version, notes or step has moved on is cancelled.
 */
export function useCarryPreview(state: GridState | null, target: MapTemplate, active: boolean, settleMs = 0): TransferPreview | null {
  useSyncExternalStore(subscribeCarryPreviews, carryPreviewsVersion);
  const notesEpoch = useEditorStore((s) => s.annotationsEpoch);
  const ready = active && state ? cachedCarryPreview(state, notesEpoch, target) : null;
  const asking = active && !!state && !ready;
  useEffect(() => (asking && state ? requestCarryPreview(state, target, { notesEpoch: liveNotesEpoch, settleMs }) : undefined),
    [asking, state, notesEpoch, target, settleMs]);
  return ready;
}

interface PlanetCarryStepProps {
  target: MapTemplate;
  /** Null while the transfer is being worked out. */
  preview: TransferPreview | null;
  carry: Carry;
  onCarry: (carry: Carry) => void;
  /** The element naming the choice: the step's title. */
  labelledBy: string;
}

export function PlanetCarryStep({ target, preview, carry, onCarry, labelledBy }: PlanetCarryStepProps) {
  const t = useT();
  const lost = preview?.dropped.length ?? 0;
  // One box for both pictures, so the choice is between two planets at the same scale and centre.
  // The box needs the dropped cells, so both pictures wait for the transfer and neither rescales.
  const fit = useMemo(() => (preview ? planetBounds({ template: target, dropped: preview.dropped }) : undefined), [target, preview]);
  return (
    <PictureChoices<Carry> value={carry} onChange={onCarry} labelledBy={labelledBy} choices={[
      {
        value: 'carry', testId: 'planet-carry-option', label: t('planet.carry_option'),
        badge: lost > 0 ? { text: t('planet.cells_dropped', { n: lost }), loss: true } : null,
        picture: (onTap) => (
          <PlanetPreview template={target} fit={fit} pending={!preview} onTap={onTap}
            {...(preview ? { state: preview.state, dropped: preview.dropped } : {})} />
        ),
      },
      {
        value: 'fresh', testId: 'planet-fresh-option', label: t('planet.carry_fresh'), badge: null,
        picture: (onTap) => <PlanetPreview template={target} fit={fit} pending={!preview} onTap={onTap} />,
      },
    ]} />
  );
}
