/**
 * The video import's guide: the recording steps beside a looping example recording, with the way
 * into the full guide in Help, the reason the last video was refused with the way to its fix there,
 * and the drop zone that takes the next one.
 *
 * The example loads when the guide mounts, plays muted and loops; under reduced motion it rests on
 * its poster with a play button and plays only when asked.
 */
import { ActionButton } from '../../../primitives/ActionButton';
import type { CSSProperties } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useT } from '../../../../i18n/context';
import type { ImportFailure } from '../../../../pipelines/planet-scan';
import { cursors, radii } from '../../../design/styles';
import { ERROR, FRAME_INK } from '../../../design/tokens';
import { roleFont } from '../../../design/text-weight';
import { skin } from '../../../design/window-skin';
import { Disclosure } from '../../../primitives/Disclosure';
import { LoopVideo } from '../../../primitives/LoopVideo';
import { ImportDropZone } from '../import/ImportDropZone';
import { useFilePick } from '../../../primitives/use-file-pick';
import { acceptsVideo, VIDEO_ACCEPT } from '../../../../io/import/facts';
import { SCAN_EXAMPLE, SCAN_EXAMPLE_SIZE } from './scan-example';
import { openHelp } from '../../../session/help-targets';
import { VIDEO_GUIDE_HELP, VIDEO_STEPS, videoFixAnchor } from '../../../../editor/help/video-guide';

/** Each refusal's copy key; every locale defines each (`planet-import-window.test.tsx`). */
export const FAILURE_COPY = {
  framing: 'planet.scan_failed_framing',
  'not-map-view': 'planet.scan_failed_not_map_view',
  'not-max-zoom': 'planet.scan_failed_zoom',
  'zoom-changed': 'planet.scan_failed_zoom_changed',
  'region-load-off': 'planet.scan_failed_region_off',
  'too-little': 'planet.scan_failed_too_little',
  'too-long': 'planet.scan_failed_too_long',
  'too-fast': 'planet.scan_failed_too_fast',
  blurry: 'planet.scan_failed_blurry',
  'too-large': 'planet.scan_failed_too_large',
  'no-ground': 'planet.scan_failed_no_ground',
  unreadable: 'planet.scan_failed_unreadable',
  busy: 'planet.scan_failed_busy',
  failed: 'planet.scan_failed_failed',
} as const satisfies Record<ImportFailure, `planet.scan_failed_${string}`>;


const listStyle: CSSProperties = {
  ...roleFont('body'), color: skin.plateInk, margin: 0, paddingInlineStart: 20, display: 'flex', flexDirection: 'column', gap: 10, lineHeight: 1.45,
};
const frameStyle: CSSProperties = {
  position: 'relative', width: '100%', aspectRatio: `${SCAN_EXAMPLE_SIZE.width} / ${SCAN_EXAMPLE_SIZE.height}`, borderRadius: radii.md, overflow: 'hidden',
  background: FRAME_INK, border: `1.5px solid ${skin.line}`, boxSizing: 'border-box',
};
const failureStyle: CSSProperties = {
  ...roleFont('label'), color: ERROR, background: skin.inset, borderRadius: radii.md, padding: '10px 14px', lineHeight: 1.45,
  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6,
};
const helpLinkStyle: CSSProperties = {
  ...roleFont('label'), border: 'none', background: 'none', padding: 0, color: skin.plateInk, textDecoration: 'underline', textUnderlineOffset: 3,
  cursor: cursors.clickable, textAlign: 'start',
};

/** A link that opens Help at `anchor` on the Change a planet page, over this window. */
function GuideLink({ anchor, label, testId }: { anchor: string; label: string; testId: string }) {
  return (
    <ActionButton interaction="quietLink" style={helpLinkStyle} data-testid={testId} onClick={() => openHelp(VIDEO_GUIDE_HELP.page, anchor)}>
      {label}
    </ActionButton>
  );
}

function ExampleVideo() {
  const t = useT();
  return (
    <LoopVideo style={frameStyle} testId="scan-example" label={t('planet.scan_example')} playLabel={t('planet.scan_play')} poster={SCAN_EXAMPLE.poster}
      sources={[{ src: SCAN_EXAMPLE.webm, type: 'video/webm' }, { src: SCAN_EXAMPLE.mp4, type: 'video/mp4' }]} />
  );
}

export function VideoImportGuide({ failure, stacked, onFile }: {
  /** Why the last video was refused, or null. */
  failure: ImportFailure | null;
  /** The protocol stands above the example where the window is narrow. */
  stacked: boolean;
  /** A dropped or picked file, a video or not. */
  onFile: (file: File) => void;
}) {
  const t = useT();
  const file = useFilePick({ accept: VIDEO_ACCEPT, onFile });
  // A video among several files is the one taken; any other file goes to `onFile` to be routed.
  const take = (files: File[]) => onFile(files.find(acceptsVideo) ?? files[0]!);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <input {...file.input} data-testid="scan-file" />
      <div style={{ display: 'flex', flexDirection: stacked ? 'column' : 'row', gap: 20, alignItems: stacked ? 'stretch' : 'center' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <ol style={listStyle} data-testid="scan-steps">
            {VIDEO_STEPS.map((key) => <li key={key}>{t(key)}</li>)}
          </ol>
          <GuideLink anchor={VIDEO_GUIDE_HELP.anchor} label={t('planet.video_guide_link')} testId="scan-guide-help" />
        </div>
        <div style={{ flex: stacked ? 'none' : '0 0 46%', minWidth: 0 }}>
          <ExampleVideo />
        </div>
      </div>
      <AnimatePresence initial={false}>
        {failure && (
          <Disclosure key={failure} motionId="section.expand">
            <div role="alert" data-testid="scan-failure" style={failureStyle}>
              <span>{t(FAILURE_COPY[failure])}</span>
              <GuideLink anchor={videoFixAnchor(failure)} label={t('planet.video_fix_link')} testId="scan-failure-help" />
            </div>
          </Disclosure>
        )}
      </AnimatePresence>
      <ImportDropZone busy={false} label={t('planet.scan_drop')} onClick={file.pick} onFiles={take} />
    </div>
  );
}
