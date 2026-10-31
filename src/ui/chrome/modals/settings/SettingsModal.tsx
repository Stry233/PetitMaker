import { ActionButton } from '../../../primitives/ActionButton';
import { BrandName } from '../../BrandName';
import { useState, type CSSProperties } from 'react';
import { useLocale, useT } from '../../../../i18n/context';
import { font, radii, cursors } from '../../../design/styles';
import { skin, windowPill } from '../../../design/window-skin';
import { WindowBody, WindowHeader, windowFrame } from '../../../primitives/Window';
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
import { QUALITIES_3D, type GridMode } from '../../../../platform/storage/prefs';
import type { I18nKey } from '../../../../i18n/keys';
import { QualityShot, picStyle, tileStyle, capStyle, MapTile, GridOverlay, ChunkOverlay, stepStyle, stepName, MotionPref, MotionDemo, choiceStyle, SYSTEM_ARROW, PAINTED_ARROW_URL } from './settings-pictures';
import { UiScaleSlider } from './UiScaleSlider';
import { useWindowColumns } from '../use-window-columns';
import { useTouchMode } from '../../../design/input-mode';
import { useMorphPresence } from '../../../primitives/morph';


const CARD_ROW_GAP = 22;

const cardStyle: CSSProperties = { ...windowFrame, gap: CARD_ROW_GAP };
/** Every row under the title scrolls together past the card's height cap; the title and Close stay. */
const rowsStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: CARD_ROW_GAP };

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
const bodyStyle = (columns: 1 | 2): CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: columns === 2 ? '272px 1fr' : 'minmax(0, 1fr)',
  gap: 14,
  alignItems: 'stretch',
});

/** The body's width, in css px, below which the two groups stack. */
const SETTINGS_TWO_COLUMNS_FROM = 500;

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

const GRID_MODE_LABELS: Record<GridMode, I18nKey> = {
  auto: 'modal.settings_grid_auto',
  object: 'modal.settings_grid_object',
  terrain: 'modal.settings_grid_terrain',
  off: 'modal.settings_grid_off',
};

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

/** In one column the actions stand two to a row, and the last one alone takes its whole row. */
const stackedPillsStyle: CSSProperties = {
  ...metaPillsStyle, gridAutoFlow: 'row', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
};
const wholeRow: CSSProperties = { gridColumn: '1 / -1' };

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
  const gridMode = useEditorStore((s) => s.gridMode);
  const lastGridMode = useEditorStore((s) => s.lastGridMode);
  const onCycleGrid = useEditorStore((s) => s.cycleGridMode);
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
  // The cursor and the keyboard are a mouse's and a keyboard's settings.
  const touch = useTouchMode();
  // Shown in PC mode only, so a switch fades them out or in within the window.
  const cursorOnly = useMorphPresence('settings-cursor');
  const keyboardOnly = useMorphPresence('settings-keyboard');
  const [columns, bodyRef] = useWindowColumns(SETTINGS_TWO_COLUMNS_FROM);
  const resetAlone = columns === 1 && fullscreen.available;

  return (
    <>
      <WindowHeader title={t('modal.settings_title')} close={{ label: t('hint.close'), onPress: onClose }} reserve />

      <WindowBody contentStyle={rowsStyle}>

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

        <div ref={bodyRef} data-columns={columns} style={bodyStyle(columns)}>
          {/* The map: what shows on it, and how it renders. */}
          <div {...helpTargetAttr('settings', 'settings-map')} style={groupStyle}>
            <div style={rowOfTiles}>
              {/* Each press moves to the next grid mode. */}
              <MapTile on={gridMode !== 'off'} onPress={onCycleGrid} announce
                name={t('modal.settings_grid')} state={t(GRID_MODE_LABELS[gridMode])}>
                <GridOverlay mode={gridMode} shown={gridMode === 'off' ? lastGridMode : gridMode} />
              </MapTile>
              <MapTile on={showChunks} asSwitch onPress={() => onShowChunksChange(!showChunks)}
                name={t('modal.settings_chunks')} state={t(showChunks ? 'modal.settings_chunks_shown' : 'modal.settings_chunks_hidden')}>
                <ChunkOverlay on={showChunks} />
              </MapTile>
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
            {/* Motion preference: Auto ('system') follows the OS reduce-motion setting; the others
                override it. Each step's falling cell performs the choice. */}
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
            {!touch && <div {...cursorOnly} style={{ display: 'flex', gap: 10 }} role="radiogroup" aria-label={t('modal.settings_cursor')}>
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
            </div>}
          </div>
        </div>

        {/* The keyboard, painted: every keycap wears its command's category color from the live
            keymap, so a rebind or a preset switch repaints this picture. Clicking opens the full
            Keyboard Shortcuts window; Settings closes first so the board never opens behind it.
            It takes the meta rows' `row` interaction, so it presses like its neighbours. */}
        {!touch && <ActionButton interaction="row"
          type="button"
          aria-label={t('modal.keyboard_title')}
          {...helpTargetAttr('shortcuts')}
          {...keyboardOnly}
          style={keyboardRowStyle}
          onClick={() => { onClose(); setModal('keyboard', true); }}
       >
          <KeymapMiniature />
          <span style={keyboardFootStyle}>
            <span style={{ ...roleFont('chip'), fontFamily: font.family, color: skin.plateInk }}>{t('modal.keyboard_title')}</span>
            <span style={{ marginLeft: 'auto', ...roleFont('chip'), fontFamily: font.family, color: skin.muted }}>{t('modal.settings_keyboard_hint')}</span>
          </span>
        </ActionButton>}

        <div style={metaStyle}>
          {/* Identity readout — the app and its build, drilling into About. */}
          <ActionButton interaction="row" {...helpTargetAttr('settings', 'settings-about')} type="button" style={readoutStyle} onClick={onAbout}   aria-label={t('modal.settings_about')}>
            <span style={{ ...roleFont('label'), fontFamily: font.family, color: skin.ink }}><BrandName /></span>
            <span style={{ ...roleFont('chip'), fontFamily: font.family, color: skin.muted }}>{t('about.build_number', { build: BUILD_NUMBER })}</span>
            <span style={{ marginLeft: 'auto', color: skin.muted, ...roleFont('chip'), fontFamily: font.family }}>{'›'}</span>
          </ActionButton>

          <div style={columns === 1 ? stackedPillsStyle : metaPillsStyle}>
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
            <ActionButton interaction="pill" {...helpTargetAttr('settings', 'settings-reset')} type="button" style={resetAlone ? { ...dangerPillStyle, ...wholeRow } : dangerPillStyle} onClick={onReset}>
              {t('modal.settings_reset_btn')}
            </ActionButton>
          </div>
        </div>
      </WindowBody>
    </>
  );
}
