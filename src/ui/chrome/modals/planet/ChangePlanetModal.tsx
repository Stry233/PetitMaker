import { SUPPORTS_JSON_FILES, SUPPORTS_VIDEO_IMPORT } from '../../../../platform/build/edition';
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { AnimatePresence, motion, useIsPresent, useReducedMotionConfig } from 'framer-motion';
import { useLocale, useT } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { useWindow, type WindowProps } from '../use-window';
import type { GridState, MapTemplate } from '../../../../core/model/types';
import { mapChunkAxes } from '../../../../core/grid/map-chunks';
import { JSON_ACCEPT } from '../../../../io/import/facts';
import { hasCarriableContent } from '../../../../editor/operations/transfer-map';
import { changePlanet, pickStepGoes, planetPick, switchFooter, type SwitchStep } from '../../../../editor/session/planet-switch';
import {
  downloadPlanetFile, duplicatePlanetEntry, importPlanetFile, removePlanetEntry, type PlanetEntry,
} from '../../../../editor/session/planet-library';
import { useMapDerived } from '../../../session/use-map-derived';
import { useUndoDepth } from '../../../session/use-undo-depth';
import { hasUnsavedEdits } from '../../../../state/unsaved-edits';
import { radii } from '../../../design/styles';
import { RenderBoundary } from '../../../primitives/RenderBoundary';
import { ChunkNotice } from '../../guards/FailureNotice';
import { ActionButton } from '../../../primitives/ActionButton';
import { useNameReveal } from '../../../primitives/use-name-reveal';
import { ModalShell } from '../../../primitives/ModalShell';
import { DuplicateIcon, EditIcon, ExportFileIcon, RenameIcon, TrashIcon } from '../../../primitives/line-glyphs';
import { useSizeGlide } from '../../../primitives/use-size-glide';
import { WindowBody, WindowFooter, WindowHeader, windowColumn, windowFrame } from '../../../primitives/Window';
import { useOpenCount } from '../../../primitives/use-open-count';
import { useLatch } from '../../../primitives/use-latch';
import { useFilePick } from '../../../primitives/use-file-pick';
import { skin, windowIconButton } from '../../../design/window-skin';
import { ERROR, PANEL_EDGE } from '../../../design/tokens';
import { MOTIONS } from '../../../design/motion/registry';
import { seconds } from '../../../design/motion';
import { useTransition } from '../../../design/motion/use-motion';
import { PlanetCarryStep, useCarryPreview, type Carry } from './PlanetCarryStep';
import { ControlConfirm } from '../../../primitives/ControlConfirm';
import { PlanetStep } from './PlanetStep';
import { PlanetNameField, usePlanetNameReview } from './PlanetNameField';
import { PlanetPicker } from './PlanetPicker';
import { PlanetPreview } from './PlanetPreview';
import { usePlanetLibrary, usePlanetName } from './use-planet-library';
import { loadPlanetImportWindow } from '../../loaders';
import { useHandedImport } from '../import/use-handed-import';
import { ExportFirstButton } from '../ExportFirstButton';
import { useWindowColumns } from '../use-window-columns';
import { useAway } from '../../../primitives/away';
import { pressCommand } from '../../../../editor/commands/run';

interface ChangePlanetModalProps extends WindowProps {
  /** Stands in for the switch (`editor/session/planet-switch.ts:changePlanet`) where the window is a
   *  picture, which must not move the visitor's map: it is handed `target` (a built-in's id, or any
   *  other planet's template) and whether the build comes along. */
  onSwitch?: (target: string | MapTemplate, carry: boolean) => void;
  /** Whether the planet editor can open over the current map, as the frame reads it with the
   *  assistant's job; the window's editor entries press `planet.edit`, and a picture passes none. */
  canEditPlanet?: boolean;
  /** The Help Center's preview map; when absent, carry availability reads the open map. */
  subject?: GridState;
  /** Open with this planet already picked: a built-in's id or a saved planet's entry id. */
  initialChosen?: string;
  /** Whether this window reads the planet file or video another import surface hands over; only the
   *  app's own window does, never a picture of it. */
  takesHandedFiles?: boolean;
}

/** Import planet's window, kept out of the bundle of an edition that cannot read a video. */
const PlanetImportWindow = SUPPORTS_VIDEO_IMPORT ? lazy(loadPlanetImportWindow) : null;

/** The backdrop under Import planet's window, which blurs the page itself: one blur is enough, and
 *  the window drops its own while it reads a video. */
const UNBLURRED: CSSProperties = { backdropFilter: 'none', WebkitBackdropFilter: 'none' };
const cardStyle: CSSProperties = windowFrame;
/** The Help page the window and its questions answer What's this with. */
const PLANET_HELP = { page: 'planet' } as const;

/** Everything inside the card, and the box whose height eases; it clips while it travels. */
const bodyStyle: CSSProperties = { ...windowColumn, gap: 18 };
const stepsStyle: CSSProperties = { ...windowColumn, position: 'relative' };
/** Two columns: the list is the one scroller, and the pair gives way to a short window. */
const splitStyle: CSSProperties = { display: 'flex', gap: 20, height: 420, flex: '0 1 auto', minHeight: 0 };
/** In one column the preview, this tall in css px, stands above the whole list, and the two scroll
 *  together in the window's body. Taller than the shared `STACKED_PREVIEW_HEIGHT`: here the planet is
 *  what the step chooses, not a preview of a form's output. */
const PLANET_STACKED_PREVIEW = 220;
const stackedSplitStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14 };
const stackedPreview: CSSProperties = { width: '100%', flex: 'none', height: PLANET_STACKED_PREVIEW };
const stackedList: CSSProperties = { width: '100%', flex: 'none', height: 'auto' };
const primaryStyle: CSSProperties = { flex: '0 0 auto', minWidth: 200 };
/** In one column the confirming action takes the footer's remaining width instead. */
const stackedPrimaryStyle: CSSProperties = { flex: '1 1 auto', minWidth: 0 };
/** The saved planet's tools: window icon buttons standing on the toolbar's own plate. */
const iconButton: CSSProperties = { ...windowIconButton, background: 'transparent' };
const toolsStyle: CSSProperties = {
  display: 'flex', gap: 4, padding: 4, background: skin.plate, borderRadius: radii.pill, border: PANEL_EDGE,
};

const TOOLS_FROM = 1 - MOTIONS['planet.tools.offer'].amplitude;

type Asking = 'rename' | 'delete' | null;

const chunkCount = (template: MapTemplate) => {
  const axes = mapChunkAxes(template);
  return { w: axes.columns.length, h: axes.rows.length };
};

export function ChangePlanetModal({ open: openProp, onClose, ...props }: ChangePlanetModalProps) {
  const t = useT();
  const { open, close: closeWindow } = useWindow('newProject', { open: openProp, onClose });
  const canEdit = !!props.canEditPlanet;
  // The store keeps the window open while a switch runs.
  const close = closeWindow;
  const importRef = useRef<((file: File) => Promise<void>) | null>(null);
  const file = useFilePick({ accept: JSON_ACCEPT, onFile: (f) => { void importRef.current?.(f); } });
  const pickFile = file.pick;
  const importOpen = useEditorStore((s) => s.modals.planetImport);
  // Kept mounted after its first open, so its closing animation can finish.
  const importEver = useLatch(importOpen);
  // Each opening of Import planet's window is a fresh window.
  const importSession = useOpenCount(importOpen);

  return (
    <>
    <ModalShell helpTarget={PLANET_HELP} open={open} onClose={close} size="panel" width={900} cardStyle={cardStyle} backdropStyle={importOpen ? UNBLURRED : undefined} ariaLabel={t('modal.new_title')}>
      {SUPPORTS_JSON_FILES && (
        <input {...file.input} data-testid="planet-file" />
      )}
      <ChangePlanetBody {...props} open={open} canEdit={canEdit} close={close} pickFile={pickFile} importRef={importRef} />
    </ModalShell>
    {PlanetImportWindow && importEver && (
      <RenderBoundary resetKey={importOpen} fallback={<ChunkNotice />}>
        <Suspense fallback={null}>
          <PlanetImportWindow key={importSession} canEdit={canEdit} takesHandedFiles={props.takesHandedFiles ?? false}
            {...(SUPPORTS_JSON_FILES ? { onPickFile: pickFile } : {})} />
        </Suspense>
      </RenderBoundary>
    )}
    </>
  );
}

interface ChangePlanetBodyProps extends Omit<ChangePlanetModalProps, 'open' | 'onClose'> {
  open: boolean;
  canEdit: boolean;
  close: () => void;
  pickFile: () => void;
  /** Where the card's file input hands a picked planet file. */
  importRef: React.MutableRefObject<((file: File) => Promise<void>) | null>;
}

function ChangePlanetBody(
  { open, onSwitch = changePlanet, subject, initialChosen, takesHandedFiles = false, canEdit, close, pickFile, importRef }: ChangePlanetBodyProps,
) {
  const t = useT();
  const locale = useLocale();
  // The undo stack's length at the last export is the mark; anything past it lives only here.
  const exportedAt = useEditorStore((s) => s.exportedAt);
  const liveState = useEditorStore((s) => s.gridState);
  const gridState = subject ?? liveState;
  const setModal = useEditorStore((s) => s.setModal);
  const unsaved = hasUnsavedEdits(useUndoDepth(0), exportedAt);
  const library = usePlanetLibrary();

  // Null stands for the planet the map is on.
  const [chosenKey, setChosenKey] = useState<string | null>(initialChosen ?? null);
  // A planet named after the window opened (the planet editor's return lands a frame late) is chosen too.
  const [namedChosen, setNamedChosen] = useState(initialChosen);
  if (initialChosen !== namedChosen) {
    setNamedChosen(initialChosen);
    if (initialChosen) setChosenKey(initialChosen);
  }
  const [step, setStep] = useState<SwitchStep>('pick');
  const [carry, setCarry] = useState<Carry>('carry');
  const [asking, setAsking] = useState<Asking>(null);
  const busy = useEditorStore((s) => s.planetSwitching);
  const renameRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);

  // Whether there is anything to carry, asked of the operation that would carry it: a per-layer
  // tally misses ground-level edge cuts. Walks the grid, so only while open and when the map moved.
  const hasBuild = useMapDerived(() => !!gridState && open && hasCarriableContent(gridState), [gridState, open], { grid: gridState });
  const currentTemplate = gridState?.template;
  const currentName = usePlanetName(currentTemplate);
  const currentId = currentTemplate?.id;
  const { current, builtin, mine, chosen, startingOver, target } = useMemo(() => planetPick({
    entries: library.entries, locale, here: currentTemplate ? { template: currentTemplate, name: currentName } : null, chosenKey,
  }), [library.entries, locale, currentTemplate, currentName, chosenKey]);
  const entry = chosen.entry;

  const reduced = useReducedMotionConfig() === true;
  // The replay takes the thread, so it waits for the step's crossfade and the card's glide to land.
  const settleMs = reduced ? 0 : Math.max(seconds('section.opacity'), seconds('modal.resize')) * 1000;
  const carryPreview = useCarryPreview(gridState ?? null, chosen.template, open && step === 'carry', settleMs);
  const body = useSizeGlide<HTMLDivElement>({ change: `${open}|${step}|${busy}|${locale}`, axis: 'height', motionId: 'modal.resize' });
  // The control that moved the step leaves with it, so focus lands on the new step's own choice.
  const stepMoved = useRef(false);
  const toStep = (next: SwitchStep) => { stepMoved.current = true; setStep(next); };
  useEffect(() => {
    if (!stepMoved.current) return;
    stepMoved.current = false;
    const root = body.ref.current;
    const landing = step === 'carry'
      ? root?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
      : root?.querySelector<HTMLElement>('[aria-pressed="true"]'); // the chosen planet's row
    landing?.focus();
  }, [step, body.ref]);
  const titleId = useId();
  const [columns, splitRef] = useWindowColumns();

  const choose = (key: string) => { setAsking(null); setChosenKey(key); };

  const go = (bring: boolean) => { onSwitch(target, bring); };

  const primary = () => {
    if (pickStepGoes(startingOver, hasBuild) === 'switch') go(false);
    else { setCarry('carry'); toStep('carry'); }
  };

  // The press on Export first closes this window; the export window opens in its place.
  const exportFirst = () => { close(); pressCommand('window.open', { window: 'share', section: 'keep' }); };

  const importFile = async (file: File) => {
    const entry = await importPlanetFile(file, locale);
    if (entry) choose(entry.entryId);
  };
  importRef.current = importFile;

  // A planet file handed over by another import surface is read as From a planet file reads one.
  useHandedImport('planet', takesHandedFiles && open, (file) => { void importFile(file); });

  const duplicate = (e: PlanetEntry) => {
    const copy = duplicatePlanetEntry(e);
    if (copy) choose(copy.entryId);
  };

  const rename = (e: PlanetEntry, name: string) => {
    setAsking(null);
    pressCommand('planets.rename', { planet: e.entryId, name });
  };

  const remove = (e: PlanetEntry) => {
    setAsking(null);
    if (removePlanetEntry(e)) setChosenKey(null);
  };

  const chunks = chunkCount(chosen.template);
  const footer = switchFooter({ step, startingOver, hasBuild, unsaved });
  const showExportFirst = footer.exportFirst;
  const verb = footer.verb === 'switch' ? t('planet.switch_to', { name: chosen.name })
    : footer.verb === 'start-over' ? t('planet.start_over_on', { name: chosen.name })
      : t('planet.next');
  const verbDisabled = footer.disabled;

  const picker = (
    <PlanetPicker key="picker" current={current} builtin={builtin} mine={mine} chosenKey={chosen.key} currentId={currentId}
      onChoose={choose} newDisabled={!canEdit} onNew={() => pressCommand('planet.edit')}
      {...(columns === 1 ? { style: stackedList, scrolls: false } : {})}
      {...(PlanetImportWindow ? { onImport: () => setModal('planetImport', true) } : SUPPORTS_JSON_FILES ? { onImport: pickFile } : {})} />
  );
  const preview = (
    <PreviewSwap key="preview" choiceKey={chosen.key} {...(columns === 1 ? { style: stackedPreview } : {})}>
      <PlanetPreview template={chosen.template} state={startingOver ? gridState ?? undefined : undefined}
        label={chosen.name} size={t('planet.chunks', chunks)}
        toolbar={(
          <AnimatePresence initial={false}>
            {entry && (
              <PlanetTools key="tools" canEdit={canEdit} renameRef={renameRef} deleteRef={deleteRef}
                onEdit={() => pressCommand('planet.edit', { planet: entry.entryId })}
                onRename={() => setAsking(asking === 'rename' ? null : 'rename')}
                onDuplicate={() => duplicate(entry)}
                {...(SUPPORTS_JSON_FILES ? { onExport: () => downloadPlanetFile(entry) } : {})}
                onDelete={() => setAsking(asking === 'delete' ? null : 'delete')} />
            )}
          </AnimatePresence>
        )} />
    </PreviewSwap>
  );

  return (
    <>
      <div ref={body.ref} data-testid="planet-body" style={body.gliding ? { ...bodyStyle, overflow: 'hidden' } : bodyStyle}>
        <div style={stepsStyle}>
          <AnimatePresence mode="popLayout" initial={false}>
            <PlanetStep key={step}>
              <WindowHeader reserve titleId={step === 'carry' ? titleId : undefined}
                title={step === 'carry' ? t('planet.switch_to', { name: chosen.name }) : t('modal.new_title')}
                {...(step === 'carry' ? { back: { label: t('planet.back'), onPress: () => toStep('pick') } } : {})}
                close={{ label: t('hint.close'), onPress: close }} />

              {step === 'pick' ? (
                columns === 2 ? (
                  <div ref={splitRef} data-columns={columns} style={splitStyle}>{[picker, preview]}</div>
                ) : (
                  <WindowBody>
                    <div ref={splitRef} data-columns={columns} style={stackedSplitStyle}>{[preview, picker]}</div>
                  </WindowBody>
                )
              ) : (
                <WindowBody>
                  <PlanetCarryStep target={chosen.template} preview={carryPreview} carry={carry} onCarry={setCarry} labelledBy={titleId} />
                </WindowBody>
              )}
            </PlanetStep>
          </AnimatePresence>
        </div>

        <WindowFooter
          tertiary={showExportFirst ? <ExportFirstButton testId="planet-export-first" onPress={exportFirst} /> : undefined}
          cancel={<ActionButton appearance="tertiary" hoverFill={skin.inset} onClick={close}>{t('delete.cancel')}</ActionButton>}
          primary={(
            <ActionButton appearance="primary" data-testid="planet-switch" busy={busy} disabled={verbDisabled} style={columns === 2 ? primaryStyle : stackedPrimaryStyle}
              onClick={() => (step === 'carry' ? go(hasBuild && carry === 'carry') : primary())}>
              {verb}
            </ActionButton>
          )}
        />
      </div>

      <AnimatePresence>
        {entry && asking === 'rename' && (
          <RenameCard key={`rename-${entry.entryId}`} anchor={renameRef} entry={entry} onCancel={() => setAsking(null)} onRename={(name) => rename(entry, name)} />
        )}
        {entry && asking === 'delete' && (
          <ControlConfirm key={`delete-${entry.entryId}`} anchor={deleteRef} floor={false} helpTarget={PLANET_HELP}
            title={t('planet.delete_title', { name: entry.name })} cancelLabel={t('delete.cancel')} confirmLabel={t('planet.delete')}
            onCancel={() => setAsking(null)} onConfirm={() => remove(entry)} />
        )}
      </AnimatePresence>
    </>
  );
}

/** The chosen planet's preview crossfades into the next choice's. */
function PreviewSwap({ choiceKey, style, children }: { choiceKey: string; style?: CSSProperties; children: React.ReactNode }) {
  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0, ...style }}>
      <AnimatePresence initial={false}>
        <SwapLayer key={choiceKey}>{children}</SwapLayer>
      </AnimatePresence>
    </div>
  );
}

/** One preview of the crossfade; the one leaving takes no input. */
function SwapLayer({ children }: { children: React.ReactNode }) {
  const swap = useTransition('planet.preview.swap');
  const present = useIsPresent();
  const away = useAway();
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={swap}
      {...away}
      style={{ position: 'absolute', inset: 0, display: 'flex', pointerEvents: present ? undefined : 'none' }}>
      {children}
    </motion.div>
  );
}

/** One glyph tool of a planet's row, named by `label` (`useNameReveal`). */
function ToolTile({ label, icon, onClick, buttonRef, disabled, color }: {
  label: string; icon: React.ReactNode; onClick: () => void; buttonRef?: RefObject<HTMLButtonElement>; disabled?: boolean; color?: string;
}) {
  const name = useNameReveal(label);
  return (
    <ActionButton ref={buttonRef} interaction="tile" {...name.bind} aria-label={label} disabled={disabled} onClick={onClick}
      style={{ ...iconButton, ...(color ? { color } : {}) }}>
      {icon}
      {name.bubble}
    </ActionButton>
  );
}

function PlanetTools({ canEdit, renameRef, deleteRef, onEdit, onRename, onDuplicate, onExport, onDelete }: {
  canEdit: boolean;
  renameRef: RefObject<HTMLButtonElement>;
  deleteRef: RefObject<HTMLButtonElement>;
  onEdit: () => void; onRename: () => void; onDuplicate: () => void; onExport?: () => void; onDelete: () => void;
}) {
  const t = useT();
  const offer = useTransition('planet.tools.offer');
  const tool = (label: string, icon: React.ReactNode, onClick: () => void, extra: {
    ref?: RefObject<HTMLButtonElement>;
    disabled?: boolean;
    color?: string;
  } = {}) => <ToolTile label={label} icon={icon} onClick={onClick} buttonRef={extra.ref} disabled={extra.disabled} color={extra.color} />;
  return (
    <motion.div role="toolbar" data-testid="planet-tools" style={{ ...toolsStyle, transformOrigin: 'top right' }}
      initial={{ opacity: 0, scale: TOOLS_FROM }} animate={{ opacity: 1, scale: 1, transition: offer }}
      exit={{ opacity: 0, scale: TOOLS_FROM, transition: offer }}>
      {tool(t('planet.edit'), <EditIcon />, onEdit, { disabled: !canEdit })}
      {tool(t('planet.rename'), <RenameIcon />, onRename, { ref: renameRef })}
      {tool(t('planet.duplicate'), <DuplicateIcon />, onDuplicate)}
      {onExport && tool(t('planet.export'), <ExportFileIcon />, onExport)}
      {tool(t('planet.delete'), <TrashIcon />, onDelete, { ref: deleteRef, color: ERROR })}
    </motion.div>
  );
}

function RenameCard({ anchor, entry, onCancel, onRename }: {
  anchor: RefObject<HTMLElement | null>; entry: PlanetEntry; onCancel: () => void; onRename: (name: string) => void;
}) {
  const t = useT();
  const present = useIsPresent();
  const [name, setName] = useState(entry.name);
  const fieldRef = useRef<HTMLInputElement>(null);
  const check = usePlanetNameReview(present, name, entry.name);
  // After the card's own initial focus, so the name is what the keyboard lands on.
  useEffect(() => { fieldRef.current?.focus(); fieldRef.current?.select(); }, []);
  const confirm = () => check.commit(() => onRename(name.trim()));
  return (
    <ControlConfirm anchor={anchor} floor={false} lockSide helpTarget={PLANET_HELP} title={t('planet.rename_title')} cancelLabel={t('delete.cancel')} confirmLabel={t('planet.ok')}
      confirmDisabled={!check.approved} onCancel={onCancel} onConfirm={confirm}
      body={<PlanetNameField check={check} inputRef={fieldRef} value={name} onChange={setName} onSubmit={confirm} />} />
  );
}
