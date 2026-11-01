/*
 * The Help Center's figures for the chrome modals: Settings, the keyboard board, and
 * Change a planet, each the real component mounted live inside `PreviewFrame` rather than a drawing
 * of it. Every callback is a no-op and the frame strips pointer events, so Settings shows the visitor's own
 * preferences without being able to change them.
 */
import { PicturedWindow, PreviewFrame } from './PreviewFrame';
import { FIT_REF } from '../../../design/scale-model';
import { SettingsModal } from '../../../chrome/modals/settings/SettingsModal';
import { KeyboardModal } from '../../../chrome/modals/keyboard/KeyboardModal';
import { ChangePlanetModal } from '../../../chrome/modals/planet/ChangePlanetModal';
import { useEditorStore } from '../../../../state/store';
import { useT } from '../../../../i18n/context';
import { usePlanetName } from '../../../chrome/modals/planet/use-planet-library';
import { iconUrl } from '../../../../assets/icon-urls';
import { DEFAULT_MAP, MAP_LIST } from '../../../../config/maps';
import { ArrivalCard } from '../../../chrome/floating/ArrivalToast';
import { ARRIVAL_LEAD_KEY } from '../../../chrome/floating/arrival-gate';
import { useShownMap } from './share';

const noop = () => {};

export function SettingsPreview() {
  return (
    <PicturedWindow width={980} height={780}>
      <SettingsModal open onClose={noop} />
    </PicturedWindow>
  );
}

export function KeyboardPreview() {
  return (
    // The board sizes its keys to the window it stands in, so it stands in a reference screen and
    // draws them as the editor's window does.
    <PicturedWindow width={FIT_REF.w} height={FIT_REF.h * 0.8}>
      <KeyboardModal open onClose={noop} />
    </PicturedWindow>
  );
}

export function PlanetPreview() {
  // With a subject that holds a build, the window reads as it does over a built map even for a
  // visitor whose own planet is still empty. The other planet stands picked, so the figure shows its
  // preview beside the list.
  const subject = useShownMap();
  const destination = MAP_LIST.find((m) => m.id !== (subject?.template.id ?? DEFAULT_MAP.id))?.id;
  return (
    <PicturedWindow width={980} height={720}>
      <ChangePlanetModal
        open
        onSwitch={noop}
        onClose={noop}
        {...(subject ? { subject } : {})}
        {...(destination ? { initialChosen: destination } : {})}
      />
    </PicturedWindow>
  );
}

/* ── arrival: the notice that names where you are ────────────────────────── */

/** The arrival notice as a picture: the real card over the visitor's own planet, countdown held. */
export function ArrivalPreview() {
  const t = useT();
  const template = useEditorStore((s) => s.gridState?.template) ?? DEFAULT_MAP;
  const planetName = usePlanetName(template);
  return (
    <PreviewFrame height={110}>
      <ArrivalCard
        art={iconUrl(`planet-${template.id}`)}
        eyebrow={t(ARRIVAL_LEAD_KEY.boot)}
        name={planetName}
        seq={0}
        paused
        onOk={() => {}}
        onSwitch={() => {}}
        measureKey="figure"
      />
    </PreviewFrame>
  );
}
