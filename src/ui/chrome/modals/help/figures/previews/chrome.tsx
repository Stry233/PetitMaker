/*
 * chrome.tsx — the Help Center's figures for the chrome modals: Settings, the keyboard board, and
 * Change a planet, each the real component mounted live inside `PreviewFrame` rather than a drawing
 * of it. Every callback is a no-op (the frame already strips pointer events); only `UiScaleSlider`
 * inside SettingsModal reads the live store directly, which is fine here too — it shows the visitor's
 * own scale.
 */
import { PreviewFrame } from './PreviewFrame';
import { SettingsModal } from '../../../SettingsModal';
import { KeyboardModal } from '../../../keyboard/KeyboardModal';
import { ChangePlanetModal } from '../../../ChangePlanetModal';
import { useEditorStore } from '../../../../../../state/store';
import { useT, localizedName } from '../../../../../../i18n/context';
import { iconUrl } from '../../../../../../assets/icon-urls';
import { DEFAULT_MAP, MAP_LIST } from '../../../../../../config/maps';
import { ArrivalCard } from '../../../../floating/ArrivalToast';
import { ARRIVAL_LEAD_KEY } from '../../../../floating/arrival-gate';
import { useShownMap } from './share';

const noop = () => {};

export function SettingsPreview() {
  const locale = useEditorStore((s) => s.locale);
  const showGrid = useEditorStore((s) => s.showGrid);
  const showChunkBounds = useEditorStore((s) => s.showChunkBounds);
  const motionPref = useEditorStore((s) => s.motionPref);
  const systemCursors = useEditorStore((s) => s.systemCursors);
  const quality3d = useEditorStore((s) => s.quality3d);
  return (
    <PreviewFrame height={360} zoom={0.62} align="top">
      <SettingsModal
        open
        locale={locale}
        showGrid={showGrid}
        showChunks={showChunkBounds}
        motionPref={motionPref}
        systemCursors={systemCursors}
        quality3d={quality3d}
        onLocaleChange={noop}
        onShowGridChange={noop}
        onShowChunksChange={noop}
        onMotionPrefChange={noop}
        onSystemCursorsChange={noop}
        onQuality3dChange={noop}
        onAbout={noop}
        onClose={noop}
      />
    </PreviewFrame>
  );
}

export function KeyboardPreview() {
  return (
    <PreviewFrame height={330} zoom={0.34} align="top">
      <KeyboardModal open onClose={noop} />
    </PreviewFrame>
  );
}

export function PlanetPreview() {
  // With a subject that holds a build, the carry row the page describes is in the picture even
  // for a visitor whose own island is still empty. The OTHER planet stands picked, so the figure
  // shows what the page promises: the confirm button naming its destination, live.
  const subject = useShownMap();
  const destination = MAP_LIST.find((m) => m.id !== (subject?.template.id ?? DEFAULT_MAP.id))?.id;
  return (
    <PreviewFrame height={360} zoom={0.62} align="top">
      <ChangePlanetModal
        open
        onSwitch={noop}
        onClose={noop}
        {...(subject ? { subject } : {})}
        {...(destination ? { initialChosen: destination } : {})}
      />
    </PreviewFrame>
  );
}

/* ── arrival: the notice that names where you are ────────────────────────── */

/** The arrival notice as a picture: the real card over the visitor's own planet, countdown held. */
export function ArrivalPreview() {
  const t = useT();
  const locale = useEditorStore((s) => s.locale);
  const template = useEditorStore((s) => s.gridState?.template) ?? DEFAULT_MAP;
  return (
    <PreviewFrame height={110}>
      <ArrivalCard
        art={iconUrl(`planet-${template.id}`)}
        eyebrow={t(ARRIVAL_LEAD_KEY.boot)}
        name={localizedName(template.name, locale)}
        seq={0}
        paused
        onOk={() => {}}
        onSwitch={() => {}}
        measureKey="figure"
      />
    </PreviewFrame>
  );
}
