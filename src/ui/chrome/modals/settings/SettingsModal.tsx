import { ActionButton } from '../../../primitives/ActionButton';
import { BrandName } from '../../BrandName';
import { useState, type CSSProperties } from 'react';
import { useLocale, useT } from '../../../../i18n/context';
import { font, radii, cursors } from '../../../design/styles';
import { skin, windowPill } from '../../../design/window-skin';
import { WindowHeader, windowFrame } from '../../../primitives/Window';
import { roleFont } from '../../../design/text-weight';
import { BUILD_NUMBER } from '../../../../platform/build/build-info';
import { LOCALES } from '../../../../core/model/locale';
import { LOCALE_INFO } from '../../../../i18n/locale-info';
import { ModalShell } from '../../../primitives/ModalShell';
import { useOpenCount } from '../../../primitives/use-open-count';
import { resetLocalData } from '../../../../editor/session/local-reset';
import { switchLocale } from '../../../../editor/session/locale';
import { ConfirmationModal } from '../../../primitives/ConfirmationModal';
import { useEditorStore } from '../../../../state/store';
import { useWindow, type WindowProps } from '../use-window';
import { startTour } from '../../tour/use-tour';
import { KeymapMiniature } from '../keyboard/KeymapMiniature';
import { useFullscreen } from '../../../primitives/use-fullscreen';
import { helpTargetAttr } from '../../../session/help-targets';
import { DANGER_INK, DANGER_SURFACE, WASH } from '../../../design/tokens';
import { QUALITIES_3D } from '../../../../platform/storage/prefs';
import { QualityShot, picStyle, tileStyle, capStyle, MapTile, stepStyle, stepName, MotionPref, MotionDemo, choiceStyle, SYSTEM_ARROW, PAINTED_ARROW_URL } from './settings-pictures';
import { UiScaleSlider } from './UiScaleSlider';


const CARD_ROW_GAP = 22;

// The card scrolls past its height cap, so a landscape phone still reaches every row.
const cardStyle: CSSProperties = { ...windowFrame, gap: CARD_ROW_GAP, overflowY: 'auto', overflowX: 'hidden' };

const langBandStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  justifyContent: 'center',
};

const langPill = (on: boolean): CSSProperties => ({
  ...windowPill(on ? 'active' : 'quiet'),
});

// The two groups: what the map shows (and how it renders), and how the interface feels. The
// grouping is the panel's only structure — no headers, each control self-describes.
const bodyStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '272px 1fr',
  gap: 14,
  alignItems: 'stretch',
};

const groupStyle: CSSProperties = {
  background: WASH,
  borderRadius: radii.card,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  justifyContent: 'space-between',
};

const rowOfTiles: CSSProperties = { display: 'flex', gap: 12 };

// The keyboard row: the live keymap as one wide pressable tile on the same wash the groups sit
// on, picture above and label below like every other tile here.
const keyboardRowStyle: CSSProperties = {
  background: WASH,
  border: 'none',
  borderRadius: radii.card,
  padding: '12px 14px 10px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  textAlign: 'left',
  cursor: cursors.clickable,
};

const keyboardFootStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
};

/** The identity stays on one line; the action group wraps as a unit and fills its row. */
const metaStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'stretch' };

const metaPillsStyle: CSSProperties = {
  display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(0, 1fr)',
  gap: 10, alignItems: 'stretch', flex: '1 0 auto', minWidth: 0, maxWidth: '100%',
};

const readoutStyle: CSSProperties = {
  flex: '1 0 auto',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  background: skin.inset,
  border: 'none',
  borderRadius: radii.field,
  padding: '10px 16px',
  whiteSpace: 'nowrap',
  textAlign: 'left',
  cursor: cursors.clickable,
  fontFamily: font.family,
};

const metaPillStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  background: skin.inset,
  border: 'none',
  borderRadius: radii.field,
  padding: '10px 12px',
  minWidth: 0,
  whiteSpace: 'normal',
  overflowWrap: 'anywhere',
  cursor: cursors.clickable,
  ...roleFont('chip'),
  fontFamily: font.family,
  color: skin.plateInk,
};

const dangerPillStyle: CSSProperties = {
  ...metaPillStyle,
  background: DANGER_SURFACE,
  color: DANGER_INK,
};

export function SettingsModal(props: WindowProps) {
  const t = useT();
  const { open, close } = useWindow('settings', props);
  // The erase question belongs to the opening it was asked in; a sibling shell keeps it mounted
  // with the Settings card rather than with each opening's content.
  const opening = useOpenCount(open);
  const [askedIn, setAskedIn] = useState<number | null>(null);
  const [resetting, setResetting] = useState(false);
  return (
    <>
      <ModalShell helpTarget={{ page: 'settings' }} open={open} onClose={close} size="panel" width={620} cardStyle={cardStyle} ariaLabel={t('modal.settings_title')}>
        <SettingsBody onClose={close} onReset={() => setAskedIn(opening)} />
      </ModalShell>
      <ConfirmationModal open={open && askedIn === opening} helpTarget={{ page: 'settings', anchor: 'settings-reset' }}
        title={t('modal.settings_reset_title')} message={t('modal.settings_reset_warn')}
        cancelLabel={t('delete.cancel')} confirmLabel={t('modal.settings_reset_confirm')}
        onCancel={() => setAskedIn(null)} busy={resetting}
        onConfirm={() => { setResetting(true); void resetLocalData(); }} />
    </>
  );
}

const motionOptions: MotionPref[] = ['reduced', 'system', 'full'];

function SettingsBody({ onClose, onReset }: { onClose: () => void; onReset: () => void }) {
  const t = useT();
  const fullscreen = useFullscreen();
  const setModal = useEditorStore((s) => s.setModal);
  const locale = useLocale();
  const showGrid = useEditorStore((s) => s.showGrid);
  const onShowGridChange = useEditorStore((s) => s.setShowGrid);
  const showChunks = useEditorStore((s) => s.showChunkBounds);
  const onShowChunksChange = useEditorStore((s) => s.setShowChunkBounds);
  const motionPref = useEditorStore((s) => s.motionPref);
  const onMotionPrefChange = useEditorStore((s) => s.setMotionPref);
  const systemCursors = useEditorStore((s) => s.systemCursors);
  const onSystemCursorsChange = useEditorStore((s) => s.setSystemCursors);
  const quality3d = useEditorStore((s) => s.quality3d);
  const onQuality3dChange = useEditorStore((s) => s.setQuality3d);
  const onAbout = () => setModal('about', true);
  // The tour walks the map's interface, which a planet session has set aside.
  const inSession = useEditorStore((s) => s.planetSession !== null);

  return (
    <>
      <WindowHeader title={t('modal.settings_title')} close={{ label: t('hint.close'), onPress: onClose }} reserve />

      {/* Language — all seven endonyms visible at once; each names itself in its own script. */}
      <div {...helpTargetAttr('settings', 'settings-language')} style={langBandStyle} role="radiogroup" aria-label={t('modal.settings_language')}>
        {LOCALES.map((code) => (
          <ActionButton interaction="choice"
            key={code}
            type="button"
            role="radio"
            aria-checked={locale === code}
            style={langPill(locale === code)}
            onClick={() => switchLocale(code)}
         >
            {LOCALE_INFO[code].label}
          </ActionButton>
        ))}
      </div>

      <div style={bodyStyle}>
        {/* The map: what shows on it, and how it renders. */}
        <div {...helpTargetAttr('settings', 'settings-map')} style={groupStyle}>
          <div style={rowOfTiles}>
            <MapTile kind="grid" on={showGrid} label={t('modal.settings_grid')} onToggle={() => onShowGridChange(!showGrid)} />
            <MapTile kind="chunks" on={showChunks} label={t('modal.settings_chunks')} onToggle={() => onShowChunksChange(!showChunks)} />
          </div>
          {/* Graphics quality — governs the 3D scene and the 2D canvas's render-scale cap on a
              software rasterizer (device-quality.ts:maxRenderScale reads this pref). Auto follows
              the GL probe; Full and Lite pin the choice, for a misread GPU or a screenshot worth
              the wait. Shown as the same map at each quality. */}
          <div style={rowOfTiles} role="radiogroup" aria-label={t('modal.settings_quality3d')}>
            {QUALITIES_3D.map((q) => (
              <ActionButton interaction="toggle"
                key={q}
                type="button"
                role="radio"
                aria-checked={quality3d === q}
                style={{ ...tileStyle, minWidth: 0 }}
                onClick={() => onQuality3dChange(q)}
             >
                <span style={{ ...picStyle(quality3d === q), position: 'relative' }} aria-hidden>
                  <QualityShot q={q} />
                </span>
                <span lang={locale} style={{ ...capStyle, overflowWrap: 'anywhere', hyphens: 'auto' }}>{t(`modal.settings_quality3d_${q}`)}</span>
              </ActionButton>
            ))}
          </div>
        </div>

        {/* The interface: its size, its motion, its pointer. */}
        <div {...helpTargetAttr('settings', 'settings-feel')} style={groupStyle}>
          <UiScaleSlider label={t('modal.settings_ui_scale')} />
          {/* Motion preference — System follows the OS reduce-motion setting; the others
              override it. Each step's ball performs the choice. */}
          <div style={{ display: 'flex', gap: 10 }} role="radiogroup" aria-label={t('modal.settings_motion')}>
            {motionOptions.map((p) => (
              <ActionButton interaction="pill"
                key={p}
                type="button"
                role="radio"
                aria-checked={motionPref === p}
                style={stepStyle(motionPref === p)}
                onClick={() => onMotionPrefChange(p)}
             >
                <MotionDemo pref={p} />
                <span style={stepName}>{t(`modal.settings_motion_${p}`)}</span>
              </ActionButton>
            ))}
          </div>
          {/* Cursor — the accessibility opt-out. A custom CSS cursor is an image, so it cannot
              honour the pointer size or theme the OS is configured with; a user who relies on
              those needs a way back. The choice shows the two arrows themselves. */}
          <div style={{ display: 'flex', gap: 10 }} role="radiogroup" aria-label={t('modal.settings_cursor')}>
            <ActionButton interaction="pill"
              type="button"
              role="radio"
              aria-checked={!systemCursors}
              style={choiceStyle(!systemCursors)}
              onClick={() => onSystemCursorsChange(false)}
           >
              {PAINTED_ARROW_URL ? <img src={PAINTED_ARROW_URL} alt="" width={24} height={24} /> : null}
              {t('modal.settings_cursor_painted')}
            </ActionButton>
            <ActionButton interaction="pill"
              type="button"
              role="radio"
              aria-checked={systemCursors}
              style={choiceStyle(systemCursors)}
              onClick={() => onSystemCursorsChange(true)}
           >
              {SYSTEM_ARROW}
              {t('modal.settings_cursor_system')}
            </ActionButton>
          </div>
        </div>
      </div>

      {/* The keyboard, painted: every keycap wears its command's category color from the live
          keymap, so a rebind or a preset switch repaints this picture. Clicking opens the full
          Keyboard Shortcuts window; Settings closes first so the board never opens behind it.
          The hover is the meta rows' own (scale 1.01/0.985), so the row presses like its
          neighbours. */}
      <ActionButton interaction="row"
        type="button"
        aria-label={t('modal.keyboard_title')}
        {...helpTargetAttr('shortcuts')}
        style={keyboardRowStyle}
        onClick={() => { onClose(); setModal('keyboard', true); }}
     >
        <KeymapMiniature />
        <span style={keyboardFootStyle}>
          <span style={{ ...roleFont('chip'), fontFamily: font.family, color: skin.plateInk }}>{t('modal.keyboard_title')}</span>
          <span style={{ marginLeft: 'auto', ...roleFont('chip'), fontFamily: font.family, color: skin.muted }}>{t('modal.settings_keyboard_hint')}</span>
        </span>
      </ActionButton>

      <div style={metaStyle}>
        {/* Identity readout — the app and its build, drilling into About. */}
        <ActionButton interaction="row" {...helpTargetAttr('settings', 'settings-about')} type="button" style={readoutStyle} onClick={onAbout}   aria-label={t('modal.settings_about')}>
          <span style={{ ...roleFont('label'), fontFamily: font.family, color: skin.ink }}><BrandName /></span>
          <span style={{ ...roleFont('chip'), fontFamily: font.family, color: skin.muted }}>{t('about.build_number', { build: BUILD_NUMBER })}</span>
          <span style={{ marginLeft: 'auto', color: skin.muted, ...roleFont('chip'), fontFamily: font.family }}>{'›'}</span>
        </ActionButton>

        <div style={metaPillsStyle}>
          {fullscreen.available && (
            <ActionButton interaction="pill" {...helpTargetAttr('settings', 'settings-immersive')} type="button" style={metaPillStyle} onClick={fullscreen.toggle}>
              {t(fullscreen.active ? 'modal.settings_immersive_exit' : 'modal.settings_immersive')}
            </ActionButton>
          )}

          {/* Replay the first-launch tour. A button, not a toggle: it performs an action rather
              than holding a setting. Closes Settings before starting the tour so the modal does
              not sit on top of the overlay it just launched. */}
          <ActionButton interaction="pill" {...helpTargetAttr('tour')} type="button" style={metaPillStyle} disabled={inSession} onClick={() => { onClose(); startTour(); }}>
            {t('modal.settings_tour')}
          </ActionButton>

          {/* Reset local data — asks in its own dialog below, so the pill stands whatever the
              answer and the card never changes shape under it. */}
          <ActionButton interaction="pill" {...helpTargetAttr('settings', 'settings-reset')} type="button" style={dangerPillStyle} onClick={onReset}>
            {t('modal.settings_reset_btn')}
          </ActionButton>
        </div>
      </div>
    </>
  );
}
