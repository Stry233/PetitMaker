/** The layer panel's pinned row for the plan-notes layer. */
import { TileToggle } from './LayerTile';
import { TILE, NOTES_ROW } from './layer-plate';
import { ActionButton } from '../../primitives/ActionButton';
import { useT } from '../../../i18n/context';
import { openHelp } from '../../session/help-targets';
import { useEditorStore } from '../../../state/store';
import { showNotesForEditing } from '../../../editor/editing/annotation-edit';
import { btnReset, cursors, font } from '../../design/styles';
import { roleFont } from '../../design/text-weight';
import { cssMotion } from '../../design/motion';
import { ACTIVE, INK, INSET, PLATE_INK } from '../../design/tokens';
import { TEXT } from '../units';
import { useFrameReadableWeight } from '../use-frame-zoom';
import { useUiPreviewPose } from '../../design/preview';

/**
 * The plan-notes row, pinned between the head and the floors: not a floor, so outside the scroller.
 * Selecting it enters annotation editing (and shows a hidden layer); its eye and lock write the map's
 * annotation state.
 */
export function NotesRow({ lane }: { lane: number }) {
  const t = useT();
  const fw = useFrameReadableWeight();
  const editMode = useEditorStore((s) => s.editMode);
  const setEditMode = useEditorStore((s) => s.setEditMode);
  const setAnnotationsVisible = useEditorStore((s) => s.setAnnotationsVisible);
  const setAnnotationsLocked = useEditorStore((s) => s.setAnnotationsLocked);
  // The data mutates in place; the epoch is what re-renders this row's count and toggles.
  useEditorStore((s) => s.annotationsEpoch);
  const data = useEditorStore((s) => s.gridState)?.annotations;
  const selected = editMode.mode === 'annotate';
  const posed = useUiPreviewPose()?.notesRow;
  const visible = posed ? posed.visible : data?.visible !== false;
  const locked = posed ? posed.locked : data?.locked === true;
  const count = data?.items.length ?? 0;
  const tileM = TILE.column;
  const ink = selected ? INK : PLATE_INK;
  const line = (measurer: boolean) => (
    <div
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', gap: tileM.readingGap,
        padding: `${NOTES_ROW.padY}px ${tileM.padX}px`, pointerEvents: 'none',
        whiteSpace: 'nowrap',
        ...(measurer ? { visibility: 'hidden' as const } : {}),
      }}
    >
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: tileM.swatchGap }}>
        {/* The layer's help door: the export controls' own "?" bubble, opening the notes help page. */}
        <ActionButton
          interaction="tile"
          aria-label={t('a11y.help')}
          data-testid={measurer ? undefined : 'shell-layer-annotation-help'}
          tabIndex={measurer ? -1 : undefined}
          onClick={measurer ? undefined : () => openHelp('notes')}
          style={{
            // Drawn at 16 in the floors' 12 px swatch slot, on whole pixels so no projection measures a half-pixel box.
            ...btnReset, width: 16, height: 16, margin: `0 ${NOTES_ROW.helpMarginX}px`, flex: 'none', borderRadius: '50%',
            background: selected ? INK : INSET, color: selected ? ACTIVE : PLATE_INK,
            fontFamily: font.family, ...roleFont('small'), lineHeight: '16px',
            textAlign: 'center', pointerEvents: measurer ? 'none' : 'auto', cursor: cursors.clickable,
          }}
        >
          ?
        </ActionButton>
        <span style={{ fontSize: TEXT.tab, fontWeight: fw(800, TEXT.tab), color: ink, whiteSpace: 'nowrap', ...(measurer ? {} : { overflow: 'hidden', textOverflow: 'ellipsis' }) }}>
          {t('annot.layer')}
        </span>
      </div>
      <span style={{ minWidth: tileM.count, textAlign: 'right', fontSize: TEXT.small, fontWeight: fw(800, TEXT.small), color: ink, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: tileM.toggleGap }}>
        <TileToggle
          icon={`${visible ? 'eye-open' : 'eye-closed'}-selected`}
          label={t('a11y.toggle_visibility')}
          testId={measurer ? 'shell-layer-annotation-eye-width' : 'shell-layer-annotation-eye'}
          size={tileM.icon}
          onPress={measurer || posed ? () => {} : () => setAnnotationsVisible(!visible)}
        />
        <TileToggle
          icon={`${locked ? 'lock' : 'unlock'}-selected`}
          label={t('a11y.toggle_lock')}
          testId={measurer ? 'shell-layer-annotation-lock-width' : 'shell-layer-annotation-lock'}
          size={tileM.icon}
          onPress={measurer || posed ? () => {} : () => setAnnotationsLocked(!locked)}
        />
      </div>
    </div>
  );
  return (
    // The hidden twin alone is in flow, bidding the plate the line's width plus the floors' scrollbar lane; the
    // visible line stops a lane short of the right edge, where the floors' content ends.
    <div style={{ position: 'relative', flex: 'none', marginBottom: NOTES_ROW.gap }}>
      <div aria-hidden style={{ pointerEvents: 'none', paddingRight: lane }}>{line(true)}</div>
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: lane }}>
      <ActionButton
        interaction="row"
        hoverFill={selected ? undefined : INSET}
        aria-pressed={selected}
        aria-label={t('annot.layer')}
        data-testid="shell-layer-annotation"
        onClick={() => (selected ? setEditMode({ mode: null }) : showNotesForEditing())}
        style={{
          ...btnReset, position: 'absolute', inset: 0, borderRadius: tileM.radius,
          background: selected ? ACTIVE : 'transparent',
          cursor: cursors.clickable, pointerEvents: 'auto',
          transition: cssMotion('layer.select.fade', ['background']),
        }}
      />
      {/* The row reads in the file tile's own columns — the same padding, the same figure slot,
          the same pair gap — so in the 1×9 file the eyes and the locks stand in one line down the
          panel instead of the notes row sitting a few px off every floor below it. */}
      {line(false)}
      </div>
    </div>
  );
}
