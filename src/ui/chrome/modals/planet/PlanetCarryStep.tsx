/**
 * Change Planet's second step: the build laid onto the destination, with every cell that does not
 * fit in red, beside the destination as it opens empty. The two are radio options; a tap on either
 * picture chooses it and a drag pans it.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { LOSS_COLOR } from '../../../../view/shared/viewport/view-constants';
import type { GridState, MapTemplate } from '../../../../core/model/types';
import { useT } from '../../../../i18n/context';
import { requestTransferPreview } from '../../../../editor/operations';
import { cachedTransferPreview, rememberTransferPreview, transferPreviewKey } from '../../../../editor/operations/transfer-map';
import type { TransferPreview } from '../../../../tools/generation/run';
import { planetBounds } from '../../../../view/map2d/capture/planet-painter';
import { PlanetPreview } from './PlanetPreview';
import { PictureOption } from './PictureOption';
import { onAfterPaint } from '../../../../platform/async/after-paint';
import { useEditorStore } from '../../../../state/store';

export type Carry = 'carry' | 'fresh';

/**
 * The build as it would arrive on `target`, or null while it is being worked out. The transfer
 * replays the whole build, far longer than a frame, so it runs in a worker; where none runs it waits
 * `settleMs` for the step's own motion to land and then runs after the next painted frame. A request
 * whose target, map version, notes or step has moved on is cancelled and its answer is never shown.
 */
export function useCarryPreview(state: GridState | null, target: MapTemplate, active: boolean, settleMs = 0): TransferPreview | null {
  const [, setDone] = useState(0);
  const notesEpoch = useEditorStore((s) => s.annotationsEpoch);
  const key = state ? transferPreviewKey(state, notesEpoch) : '';
  const ready = active && state ? cachedTransferPreview(state, key, target) : null;
  useEffect(() => {
    if (!active || !state || cachedTransferPreview(state, key, target)) return undefined;
    const controller = new AbortController();
    const { signal } = controller;
    let settle: ReturnType<typeof setTimeout> | undefined;
    let cancelPaint = () => {};
    const whenIdle = () => new Promise<void>((resolve) => {
      settle = setTimeout(() => { cancelPaint = onAfterPaint(resolve); }, settleMs);
    });
    void requestTransferPreview(state, target, { signal, whenIdle }).then((preview) => {
      // An edit since the request is a newer map than the one the answer was worked out from.
      if (!preview || signal.aborted) return;
      if (transferPreviewKey(state, useEditorStore.getState().annotationsEpoch) !== key) return;
      rememberTransferPreview(state, key, target, preview);
      setDone((n) => n + 1);
    });
    return () => {
      controller.abort();
      if (settle !== undefined) clearTimeout(settle);
      cancelPaint();
    };
  }, [active, state, key, target, settleMs]);
  return ready;
}

const optionsStyle: CSSProperties = { display: 'flex', gap: 16 };
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
  const refs = useRef<Record<Carry, HTMLDivElement | null>>({ carry: null, fresh: null });
  const lost = preview?.dropped.length ?? 0;
  // One box for both pictures, so the choice is between two planets at the same scale and centre.
  // The box needs the dropped cells, so both pictures wait for the transfer and neither rescales.
  const fit = useMemo(() => (preview ? planetBounds({ template: target, dropped: preview.dropped }) : undefined), [target, preview]);
  // Arrow keys move the choice, as in any radio group; the chosen option is the one tab stop.
  const keys = (value: Carry) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCarry(value); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const other: Carry = value === 'carry' ? 'fresh' : 'carry';
    onCarry(other);
    refs.current[other]?.focus();
  };
  const option = (value: Carry) => ({
    checked: carry === value,
    onSelect: () => onCarry(value),
    onKeyDown: keys(value),
    optionRef: (el: HTMLDivElement | null) => { refs.current[value] = el; },
  });
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} style={optionsStyle}>
      <PictureOption {...option('carry')} testId="planet-carry-option" label={t('planet.carry_option')}
        badge={lost > 0 ? { text: t('planet.cells_dropped', { n: lost }), swatch: LOSS_COLOR } : null}>
        {(onTap) => (
          <PlanetPreview template={target} fit={fit} pending={!preview} onTap={onTap}
            {...(preview ? { state: preview.state, dropped: preview.dropped } : {})} />
        )}
      </PictureOption>
      <PictureOption {...option('fresh')} testId="planet-fresh-option" label={t('planet.carry_fresh')} badge={null}>
        {(onTap) => <PlanetPreview template={target} fit={fit} pending={!preview} onTap={onTap} />}
      </PictureOption>
    </div>
  );
}
