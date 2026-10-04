/**
 * Import planet's window, over Change Planet: it asks how to import. From a planet file hands the
 * press to Change Planet's file picker. From a game video shows the recording guide, reads the video
 * on this device with progress and Cancel, and hands the planet it read to the planet editor; a
 * refused video brings the guide back with the reason.
 *
 * A file dropped anywhere on the window, or picked in the guide, goes where its kind belongs: a
 * video is read here, a planet file goes to Change Planet as From a planet file, and a map file
 * gets the card that offers Import map. A video handed over by another import surface is read as
 * the window opens.
 */
import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { SUPPORTS_JSON_FILES } from '../../../../core/runtime/edition';
import { useT } from '../../../../i18n/context';
import { scanVideo as defaultScan, VideoImportError, type ImportFailure, type ScanProgress, type ScanVideo } from '../../../../io/planet-scan/import-video';
import type { ScanOutcome } from '../../../../io/planet-scan/run';
import { useEditorStore } from '../../../../state/store';
import type { HandedImport } from '../../../../state/slices/shell';
import { classifyImportFile } from '../../../../io/import-kind';
import { showToast } from '../../../../core/runtime/toast-bus';
import { ConfirmationModal } from '../../../primitives/ConfirmationModal';
import { useRedirectContent } from '../import/ImportRedirect';
import { cssMotion, seconds } from '../../../design/motion';
import { colors, interactionProfiles, radii } from '../../../design/styles';
import { roleFont } from '../../../design/text-weight';
import { skin, windowCard, windowChip, windowIconButton, windowTitle } from '../../../design/window-skin';
import { useViewportSize } from '../../../design/scale';
import { useSizeGlide } from '../../../hooks/use-size-glide';
import { ActionButton } from '../../../primitives/ActionButton';
import { BackIcon, ImportFileIcon, VideoIcon } from '../../../primitives/line-glyphs';
import { ModalShell } from '../../../primitives/ModalShell';
import { PlanetStep } from './PlanetStep';
import { VideoImportGuide } from './VideoImportGuide';
import { VideoImportProgress } from './VideoImportProgress';

type Step = 'choose' | 'guide' | 'scanning' | 'read';

/** Below this window width the guide stands its protocol above the example. */
const STACK_BELOW = 700;

const cardStyle: CSSProperties = { ...windowCard, padding: '24px 26px 20px', display: 'flex', flexDirection: 'column', overflowY: 'auto', overflowX: 'hidden' };
const titleRow: CSSProperties = { position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 40, paddingInline: 44 };
const backButton: CSSProperties = { ...windowIconButton, position: 'absolute', insetInlineStart: 0, top: 0, bottom: 0, marginBlock: 'auto' };
const footerStyle: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 18 };
const choiceStyle: CSSProperties = {
  position: 'relative', flex: '1 1 0', minWidth: 0, minHeight: 132, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
  padding: '20px 16px', border: 'none', borderRadius: radii.lg, background: skin.inset, color: skin.ink, ...roleFont('head'),
  WebkitTapHighlightColor: 'transparent', textAlign: 'center',
};
const choiceArt: CSSProperties = { width: 52, height: 52, borderRadius: '50%', background: skin.plate, display: 'grid', placeItems: 'center' };
/** The Beta tag in a choice's top end corner and after the guide's title. */
const choiceTag: CSSProperties = { ...windowChip('inset'), position: 'absolute', top: 10, insetInlineEnd: 10, padding: '3px 10px' };
const titleTag: CSSProperties = { ...windowChip('plate'), padding: '3px 10px', marginInlineStart: 10, verticalAlign: 'middle', whiteSpace: 'nowrap' };

export interface PlanetImportWindowProps {
  open: boolean;
  onClose: () => void;
  /** From a planet file: Change Planet's file picker, opened inside this press. */
  onPickFile?: () => void;
  /** Opens the planet read from a video; false when the planet editor could not open, which keeps
   *  the window, and the planet, for another try. */
  onScanned: (outcome: ScanOutcome) => boolean;
  /** Whether a planet editor may open now; the video import waits for it otherwise. */
  canEdit: boolean;
  /** Reads a video; tests pass a scripted one. */
  scan?: ScanVideo;
  /** Whether a video another import surface handed over is read here as the window opens. */
  takesHandedFiles?: boolean;
}

function Choice({ testId, icon, label, tag, disabled, onClick }: { testId: string; icon: ReactNode; label: string; tag?: string; disabled?: boolean; onClick: () => void }) {
  return (
    <ActionButton interaction="row" data-testid={testId} disabled={disabled} onClick={onClick} style={choiceStyle}>
      <span aria-hidden style={choiceArt}>{icon}</span>
      <span>{label}</span>
      {tag && <span data-testid={`${testId}-tag`} style={choiceTag}>{tag}</span>}
    </ActionButton>
  );
}

export function PlanetImportWindow({ open, onClose, onPickFile, onScanned, canEdit, scan = defaultScan, takesHandedFiles = false }: PlanetImportWindowProps) {
  const t = useT();
  const locale = useEditorStore((s) => s.locale);
  const viewport = useViewportSize();
  const [step, setStep] = useState<Step>('choose');
  const [failure, setFailure] = useState<ImportFailure | null>(null);
  const [progress, setProgress] = useState<ScanProgress>({ stage: 'reading', share: 0 });
  const running = useRef<AbortController | null>(null);
  /** A planet read whose editor could not open yet. */
  const [held, setHeld] = useState<ScanOutcome | null>(null);
  /** The planet read, shown in the progress picture for a moment before the editor opens. */
  const [finished, setFinished] = useState<ScanOutcome | null>(null);
  const finishing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopFinishing = () => {
    if (finishing.current !== null) clearTimeout(finishing.current);
    finishing.current = null;
    setFinished(null);
  };
  const reduced = useReducedMotionConfig() === true;
  /** A map file waiting on the card that offers Import map; the last one stays while the card leaves. */
  const [redirect, setRedirect] = useState<HandedImport | null>(null);
  const lastRedirect = useRef<HandedImport | null>(null);
  if (redirect) lastRedirect.current = redirect;

  // The window stays mounted between opens, so each opening asks again from the start.
  useEffect(() => {
    if (open) return;
    running.current?.abort();
    running.current = null;
    stopFinishing();
    setStep('choose');
    setFailure(null);
    setHeld(null);
    setRedirect(null);
  }, [open]);
  useEffect(() => () => { running.current?.abort(); if (finishing.current !== null) clearTimeout(finishing.current); }, []);

  const body = useSizeGlide<HTMLDivElement>(`${open}|${step}|${failure}|${locale}|${viewport.w < STACK_BELOW}`, { axis: 'height', motionId: 'modal.resize' });

  const read = async (file: File) => {
    if (running.current) return;
    const controller = new AbortController();
    running.current = controller;
    setFailure(null);
    setProgress({ stage: 'reading', share: 0 });
    setStep('scanning');
    try {
      const outcome = await scan(file, { signal: controller.signal, onProgress: (p) => { if (!controller.signal.aborted) setProgress(p); } });
      if (controller.signal.aborted) return;
      running.current = null;
      show(outcome);
    } catch (error) {
      if (controller.signal.aborted) return;
      running.current = null;
      if (!(error instanceof VideoImportError)) console.error('[planet] video import failed', error);
      setFailure(error instanceof VideoImportError ? error.reason : 'failed');
      setStep('guide');
    }
  };

  // The planet read takes the picture's place for as long again as it takes to appear, then opens.
  const show = (outcome: ScanOutcome) => {
    if (reduced) { hand(outcome); return; }
    setFinished(outcome);
    finishing.current = setTimeout(() => {
      finishing.current = null;
      setFinished(null);
      hand(outcome);
    }, 2 * seconds('scan.preview.finish') * 1000);
  };

  // The editor opens before the window closes, so a refusal keeps the planet here.
  const hand = (outcome: ScanOutcome) => {
    if (onScanned(outcome)) { setHeld(null); onClose(); return; }
    setHeld(outcome);
    setStep('read');
  };

  const cancel = () => {
    running.current?.abort();
    running.current = null;
    stopFinishing();
    setStep('guide');
  };

  const close = () => { if (step === 'scanning') cancel(); onClose(); };

  /** Sends `file` where its kind belongs. Only the chooser and the guide take a file; `read` starts
   *  one scan at a time. */
  const route = async (file: File) => {
    if (running.current || (step !== 'choose' && step !== 'guide')) return;
    const kind = await classifyImportFile(file, file.name);
    if (kind === 'video') void read(file);
    else if (kind === 'planet') useEditorStore.getState().handImport({ kind, file });
    else if (kind === 'map') setRedirect({ kind, file });
    else showToast(t('planet.import_unknown'), 'error');
  };

  // A video handed over by the page's drop or by Import map starts reading at once.
  const handed = useEditorStore((s) => s.handedImport);
  useEffect(() => {
    if (!takesHandedFiles || !open || handed?.kind !== 'video') return;
    const file = useEditorStore.getState().takeHandedImport('video');
    if (file) void read(file);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read starts one scan and guards a second
  }, [takesHandedFiles, open, handed]);

  const redirectContent = useRedirectContent({
    hand: redirect ?? lastRedirect.current ?? { kind: 'map', file: new File([], '') },
    onCancel: () => setRedirect(null),
    onGone: () => setRedirect(null),
  });

  /** Drops anywhere on the window; the guide's drop zone hands its own to `route` too. */
  const dragOver = (e: DragEvent) => { if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault(); };
  const drop = (e: DragEvent) => {
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    e.preventDefault();
    void route(file);
  };

  // While the video is read the backdrop drops its blur for a deeper dim: the blur is redrawn with
  // every progress change and, without graphics acceleration, takes the time the decoder needs.
  const backdropStyle: CSSProperties = {
    transition: cssMotion('modal.dim', ['background-color'], reduced),
    ...(step === 'scanning' ? { backdropFilter: 'none', WebkitBackdropFilter: 'none', background: colors.surfaceOverlayWorking } : {}),
  };

  const title = step === 'choose' ? t('planet.import') : step === 'guide' || step === 'read' ? t('planet.scan_title') : t('planet.scan_progress_title');
  const width = step === 'choose' ? 520 : 820;

  return (
    <>
    <ModalShell helpTarget={{ page: 'planet' }} open={open} onClose={close} width={width} maxVwPct={96} maxVh={92} cardStyle={cardStyle} backdropStyle={backdropStyle} ariaLabel={title}>
      <div ref={body.ref} data-testid="planet-import" style={body.gliding ? { overflow: 'hidden' } : undefined} onDragOver={dragOver} onDrop={drop}>
        <div style={{ position: 'relative' }}>
          <AnimatePresence mode="popLayout" initial={false}>
            <PlanetStep key={step}>
              <div style={titleRow}>
                {step === 'guide' && (
                  <motion.button type="button" {...interactionProfiles.tile} aria-label={t('planet.back')} title={t('planet.back')}
                    data-testid="planet-import-back" style={backButton} onClick={() => { setFailure(null); setStep('choose'); }}>
                    <BackIcon size={18} />
                  </motion.button>
                )}
                <div style={windowTitle}>
                  {title}
                  {step !== 'choose' && step !== 'scanning' && <span data-testid="planet-import-beta" style={titleTag}>{t('app.beta')}</span>}
                </div>
              </div>
              {step === 'choose' && (
                <div style={{ display: 'flex', gap: 14 }}>
                  {SUPPORTS_JSON_FILES && onPickFile && (
                    <Choice testId="planet-import-file" icon={<ImportFileIcon />} label={t('planet.import_file')} onClick={() => { onClose(); onPickFile(); }} />
                  )}
                  <Choice testId="planet-import-video" icon={<VideoIcon />} label={t('planet.import_video')} tag={t('app.beta')} disabled={!canEdit} onClick={() => setStep('guide')} />
                </div>
              )}
              {step === 'guide' && <VideoImportGuide failure={failure} stacked={viewport.w < STACK_BELOW} onFile={(f) => { void route(f); }} />}
              {step === 'scanning' && <VideoImportProgress progress={progress} finished={finished?.template ?? null} stacked={viewport.w < STACK_BELOW} />}
              {step === 'read' && (
                <div role="alert" data-testid="scan-open-failed" style={{ ...roleFont('label'), color: skin.plateInk, textAlign: 'center', lineHeight: 1.45 }}>
                  {t('planet.scan_open_failed')}
                </div>
              )}
            </PlanetStep>
          </AnimatePresence>
        </div>
        <div style={footerStyle}>
          <ActionButton appearance="tertiary" hoverFill={skin.inset} data-testid="planet-import-cancel" onClick={step === 'scanning' ? cancel : close}>
            {t('delete.cancel')}
          </ActionButton>
          {step === 'read' && held && (
            <ActionButton appearance="primary" data-testid="planet-import-retry" onClick={() => hand(held)}>
              {t('planet.scan_retry_open')}
            </ActionButton>
          )}
        </div>
      </div>
    </ModalShell>
    <ConfirmationModal open={open && redirect !== null} helpTarget={{ page: 'planet' }} {...redirectContent} />
    </>
  );
}

export default PlanetImportWindow;
