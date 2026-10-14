// Content-height changes animate inside ModalShell independently of its open/close motion.
import { SUPPORTS_JSON_FILES, SUPPORTS_VIDEO_IMPORT } from '../../../../platform/build/edition';
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { AnimatePresence, motion, useIsPresent, useReducedMotionConfig } from 'framer-motion';
import { quantityParams, useLocale, useT } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { useWindow, type WindowProps } from '../use-window';
import type { GridState, MapTemplate } from '../../../../core/model/types';
import { mapChunkAxes } from '../../../../core/grid/map-chunks';
import { isCustomTemplate } from '../../../../core/model/planet';
import { showToast } from '../../../../platform/channels/toast-bus';
import { onAfterPaint } from '../../../../platform/async/after-paint';
import { hasCarriableContent } from '../../../../editor/operations/transfer-map';
import type { PlanetDraft } from '../../../../editor/operations/planet-session';
import type { ScanOutcome } from '../../../../pipelines/planet-scan';
import {
  downloadPlanetFile, draftFromScan, duplicatePlanetEntry, importPlanetFile, planetEntryFor, removePlanetEntry, renamePlanetEntry,
  type PlanetEntry,
} from '../../../../editor/session/planet-library';
import { useMapDerived } from '../../../session/use-map-derived';
import { useUndoDepth } from '../../../session/use-undo-depth';
import { hasUnsavedEdits } from '../../../../state/unsaved-edits';
import { radii } from '../../../design/styles';
import { LoadingDots } from '../../../primitives/LoadingDots';
import { ChunkBoundary } from '../../../primitives/ChunkBoundary';
import { ChunkNotice } from '../../guards/ChunkNotice';
import { ActionButton } from '../../../primitives/ActionButton';
import { ModalShell } from '../../../primitives/ModalShell';
import { DuplicateIcon, EditIcon, ExportFileIcon, RenameIcon, TrashIcon } from '../../../primitives/line-glyphs';
import { useSizeGlide } from '../../../primitives/use-size-glide';
import { WindowFooter, WindowHeader, windowFrame } from '../../../primitives/Window';
import { useOpenCount } from '../../../primitives/use-open-count';
import { skin, windowIconButton } from '../../../design/window-skin';
import { ERROR, PANEL_EDGE } from '../../../design/tokens';
import { MOTIONS } from '../../../design/motion/registry';
import { seconds } from '../../../design/motion';
import { useTransition } from '../../../design/motion/use-motion';
import { PlanetCarryStep, useCarryPreview, type Carry } from './PlanetCarryStep';
import { PlanetConfirm } from './PlanetConfirm';
import { PlanetStep } from './PlanetStep';
import { PlanetNameField, usePlanetNameReview } from './PlanetNameField';
import { PlanetPicker, planetChoices, type PlanetChoice } from './PlanetPicker';
import { PlanetPreview } from './PlanetPreview';
import { usePlanetLibrary, usePlanetName } from './use-planet-library';
import { loadPlanetImportWindow } from '../../loaders';
import { useHandedImport } from '../import/use-handed-import';

interface ChangePlanetModalProps extends WindowProps {
  /** The verb: open `target` (a built-in's id, or any other planet's template), carrying this map's build along or leaving it behind. */
  onSwitch: (target: string | MapTemplate, carry: boolean) => void;
  /** Opens the planet editor on a saved planet, or on a new one when null; it refuses when the
   *  editor cannot open now. */
  onEditPlanet?: (entry: PlanetEntry | PlanetDraft | null) => void;
  /** Whether the planet editor can open over the current map, as `onEditPlanet`'s owner reads it. */
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
const cardStyle: CSSProperties = { ...windowFrame, overflowY: 'auto', overflowX: 'hidden' };

/** Everything inside the card, and the box whose height eases; it clips while it travels. */
const bodyStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 18 };
const stepsStyle: CSSProperties = { position: 'relative' };
const splitStyle: CSSProperties = { display: 'flex', gap: 20, height: 420 };
const primaryStyle: CSSProperties = { flex: '0 0 auto', minWidth: 200 };
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
  const locale = useLocale();
  const setModal = useEditorStore((s) => s.setModal);
  const canEdit = !!props.canEditPlanet && !!props.onEditPlanet;
  // A ref, not the busy state: the press yields a macrotask before it acts, and a second press
  // within that gap reads the state its own render closed over.
  const running = useRef(false);
  // Not closeable while the transfer runs: there is nothing to cancel once the replay is under way.
  const close = () => { if (!running.current) closeWindow(); };
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<((file: File) => Promise<void>) | null>(null);
  const pickFile = () => { if (fileRef.current) { fileRef.current.value = ''; fileRef.current.click(); } };
  const importOpen = useEditorStore((s) => s.modals.planetImport);
  // Kept mounted after its first open, so its closing animation can finish.
  const importEver = useRef(false);
  if (importOpen) importEver.current = true;
  // Each opening of Import planet's window is a fresh window.
  const importSession = useOpenCount(importOpen);
  // Change Planet closing takes its import window with it.
  useEffect(() => { if (!open && useEditorStore.getState().modals.planetImport) setModal('planetImport', false); }, [open, setModal]);

  /** Opens a planet read from a video in the planet editor; false when the editor cannot open now. */
  const openScanned = (outcome: ScanOutcome): boolean => {
    const { onEditPlanet } = props;
    if (!onEditPlanet || !canEdit) return false;
    onEditPlanet(draftFromScan(outcome));
    if (!useEditorStore.getState().planetSession) return false;
    if (outcome.partial) showToast(t('planet.scan_partial', quantityParams(locale, { percent: Math.round(outcome.coverage * 100) })), 'info');
    return true;
  };

  return (
    <>
    <ModalShell helpTarget={{ page: 'planet' }} open={open} onClose={close} size="panel" width={900} cardStyle={cardStyle} backdropStyle={importOpen ? UNBLURRED : undefined} ariaLabel={t('modal.new_title')}>
      {SUPPORTS_JSON_FILES && (
        <input ref={fileRef} type="file" hidden accept=".json,application/json" data-testid="planet-file"
          onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) void importRef.current?.(f); }} />
      )}
      <ChangePlanetBody {...props} open={open} canEdit={canEdit} running={running} close={close} pickFile={pickFile} importRef={importRef} />
    </ModalShell>
    {PlanetImportWindow && importEver.current && (
      <ChunkBoundary resetKey={importOpen} fallback={<ChunkNotice />}>
        <Suspense fallback={null}>
          <PlanetImportWindow key={importSession} canEdit={canEdit} takesHandedFiles={props.takesHandedFiles ?? false}
            {...(SUPPORTS_JSON_FILES ? { onPickFile: pickFile } : {})} onScanned={openScanned} />
        </Suspense>
      </ChunkBoundary>
    )}
    </>
  );
}

interface ChangePlanetBodyProps extends Omit<ChangePlanetModalProps, 'open' | 'onClose'> {
  open: boolean;
  canEdit: boolean;
  running: React.MutableRefObject<boolean>;
  close: () => void;
  pickFile: () => void;
  /** Where the card's file input hands a picked planet file. */
  importRef: React.MutableRefObject<((file: File) => Promise<void>) | null>;
}

function ChangePlanetBody(
  { open, onSwitch, onEditPlanet, subject, initialChosen, takesHandedFiles = false, canEdit, running, close, pickFile, importRef }: ChangePlanetBodyProps,
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
  const [step, setStep] = useState<'pick' | 'carry'>('pick');
  const [carry, setCarry] = useState<Carry>('carry');
  const [asking, setAsking] = useState<Asking>(null);
  const [busy, setBusy] = useState(false);
  const renameRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);

  // Whether there is anything to carry, asked of the operation that would carry it: a per-layer
  // tally misses ground-level edge cuts. Walks the grid, so only while open and when the map moved.
  const hasBuild = useMapDerived(() => !!gridState && open && hasCarriableContent(gridState), [gridState, open], { grid: gridState });
  const currentTemplate = gridState?.template;
  const currentName = usePlanetName(currentTemplate);
  const currentId = currentTemplate?.id;
  const { current, builtin, mine } = useMemo(() => {
    const choices = planetChoices(library.entries, locale);
    // A map can stand on a planet no longer in the list: its saved shape was edited or deleted, or
    // saving it failed. It still gets its row, in a group of its own, so it can be started over.
    const listed = [...choices.builtin, ...choices.mine].some((c) => c.template.id === currentId);
    if (listed || !currentTemplate) return { current: undefined, ...choices };
    const here: PlanetChoice = { key: currentTemplate.id, name: currentName, template: currentTemplate, entry: null };
    return { current: here, ...choices };
  }, [library.entries, locale, currentTemplate, currentId, currentName]);
  const all = [...(current ? [current] : []), ...builtin, ...mine];
  // A copy shares its original's template id; the entry that names the map's planet is the current one.
  const currentEntryId = currentTemplate ? planetEntryFor(currentTemplate)?.entryId : undefined;
  const currentChoice = all.find((c) => c.entry !== null && c.entry.entryId === currentEntryId) ?? all.find((c) => c.template.id === currentId);
  const chosen: PlanetChoice = all.find((c) => c.key === chosenKey) ?? currentChoice ?? builtin[0]!;
  const entry = chosen.entry;
  const startingOver = chosen.template.id === currentId;
  // A built-in travels by its id; any other planet by its template, which no id lookup can find.
  const target: string | MapTemplate = isCustomTemplate(chosen.template) ? chosen.template : chosen.key;

  const reduced = useReducedMotionConfig() === true;
  // The replay takes the thread, so it waits for the step's crossfade and the card's glide to land.
  const settleMs = reduced ? 0 : Math.max(seconds('section.opacity'), seconds('modal.resize')) * 1000;
  const carryPreview = useCarryPreview(gridState ?? null, chosen.template, open && step === 'carry', settleMs);
  const body = useSizeGlide<HTMLDivElement>(`${open}|${step}|${busy}|${locale}`, { axis: 'height', motionId: 'modal.resize' });
  // The control that moved the step leaves with it, so focus lands on the new step's own choice.
  const stepMoved = useRef(false);
  const toStep = (next: 'pick' | 'carry') => { stepMoved.current = true; setStep(next); };
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

  const choose = (key: string) => { setAsking(null); setChosenKey(key); };

  const go = (bring: boolean) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    // The busy state paints before the synchronous replay takes the thread.
    onAfterPaint(() => {
      try {
        onSwitch(target, bring);
      } catch (error) {
        console.error('[planet] switch failed', error);
        showToast(t('planet.switch_failed'), 'error');
      } finally {
        // A transfer that threw leaves the visitor where they were, so the window must work again.
        running.current = false;
        setBusy(false);
      }
    });
  };

  const primary = () => {
    if (startingOver || !hasBuild) go(false);
    else { setCarry('carry'); toStep('carry'); }
  };

  // The press on Export first closes this window; the export window opens in its place.
  const exportFirst = () => { close(); useEditorStore.getState().openShare('keep'); };

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

  const exportPlanet = downloadPlanetFile;

  const rename = (e: PlanetEntry, name: string) => {
    setAsking(null);
    renamePlanetEntry(e, name);
  };

  const remove = (e: PlanetEntry) => {
    setAsking(null);
    if (removePlanetEntry(e)) setChosenKey(null);
  };

  const chunks = chunkCount(chosen.template);
  const showExportFirst = unsaved && (step === 'carry' || (startingOver && hasBuild));
  const verb = busy
    ? <span style={{ display: 'inline-flex', height: 15, alignItems: 'center' }}><LoadingDots color={skin.plate} /></span>
    : step === 'carry' || !(startingOver || hasBuild) ? t('planet.switch_to', { name: chosen.name })
      : startingOver ? t('planet.start_over_on', { name: chosen.name })
        : t('planet.next');
  const verbDisabled = step === 'pick' && startingOver && !hasBuild;

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
                <div style={splitStyle}>
                  <PlanetPicker current={current} builtin={builtin} mine={mine} chosenKey={chosen.key} currentId={currentId}
                    onChoose={choose} newDisabled={!canEdit} onNew={() => onEditPlanet?.(null)}
                    {...(PlanetImportWindow ? { onImport: () => setModal('planetImport', true) } : SUPPORTS_JSON_FILES ? { onImport: pickFile } : {})} />
                  <PreviewSwap choiceKey={chosen.key}>
                    <PlanetPreview template={chosen.template} state={startingOver ? gridState ?? undefined : undefined}
                      label={chosen.name} size={t('planet.chunks', chunks)}
                      toolbar={(
                        <AnimatePresence initial={false}>
                          {entry && (
                            <PlanetTools key="tools" canEdit={canEdit} renameRef={renameRef} deleteRef={deleteRef}
                              onEdit={() => onEditPlanet?.(entry)}
                              onRename={() => setAsking(asking === 'rename' ? null : 'rename')}
                              onDuplicate={() => duplicate(entry)}
                              {...(SUPPORTS_JSON_FILES ? { onExport: () => exportPlanet(entry) } : {})}
                              onDelete={() => setAsking(asking === 'delete' ? null : 'delete')} />
                          )}
                        </AnimatePresence>
                      )} />
                  </PreviewSwap>
                </div>
              ) : (
                <PlanetCarryStep target={chosen.template} preview={carryPreview} carry={carry} onCarry={setCarry} labelledBy={titleId} />
              )}
            </PlanetStep>
          </AnimatePresence>
        </div>

        <WindowFooter
          tertiary={showExportFirst ? (
            <ActionButton appearance="secondary" data-testid="planet-export-first" onClick={exportFirst}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <ExportFileIcon />{t('modal.new_export_first')}
            </ActionButton>
          ) : undefined}
          cancel={<ActionButton appearance="tertiary" hoverFill={skin.inset} onClick={close}>{t('delete.cancel')}</ActionButton>}
          primary={(
            <ActionButton appearance="primary" data-testid="planet-switch" busy={busy} disabled={verbDisabled} style={primaryStyle}
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
          <PlanetConfirm key={`delete-${entry.entryId}`} anchor={deleteRef} floor={false}
            title={t('planet.delete_title', { name: entry.name })} cancelLabel={t('delete.cancel')} confirmLabel={t('planet.delete')}
            onCancel={() => setAsking(null)} onConfirm={() => remove(entry)} />
        )}
      </AnimatePresence>
    </>
  );
}

/** The chosen planet's preview crossfades into the next choice's. */
function PreviewSwap({ choiceKey, children }: { choiceKey: string; children: React.ReactNode }) {
  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
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
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={swap}
      {...(present ? {} : { inert: '', 'aria-hidden': true, 'data-leaving': '' })}
      style={{ position: 'absolute', inset: 0, display: 'flex', pointerEvents: present ? undefined : 'none' }}>
      {children}
    </motion.div>
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
  } = {}) => (
    <ActionButton ref={extra.ref} interaction="tile" aria-label={label} title={label} disabled={extra.disabled} onClick={onClick}
      style={{ ...iconButton, ...(extra.color ? { color: extra.color } : {}) }}>
      {icon}
    </ActionButton>
  );
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
  const confirm = () => { if (check.approved) onRename(name.trim()); };
  return (
    <PlanetConfirm anchor={anchor} floor={false} lockSide title={t('planet.rename_title')} cancelLabel={t('delete.cancel')} confirmLabel={t('planet.ok')}
      confirmDisabled={!check.approved} onCancel={onCancel} onConfirm={confirm}
      body={<PlanetNameField check={check} inputRef={fieldRef} value={name} onChange={setName} onSubmit={confirm} />} />
  );
}
