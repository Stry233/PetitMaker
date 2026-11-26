import { useEditorStore } from '../../state/store';
import { PixiCanvas } from '../../view/map2d/PixiCanvas';
import { Editor3DCanvas } from '../../view/map3d/Editor3DCanvas';
import { cssMotion, fadeVisibilityCss, framerMotion } from '../design/motion';

// The 2D↔3D crossfade and the restore fade share one motion: "the map view changes underneath you".
const VIEW_FADE = 'map.view.crossfade';
const viewFade = (visible: boolean): string => fadeVisibilityCss(VIEW_FADE, visible);

/**
 * Both map views, mounted together in every edition: the view mode picks the visible one with a
 * crossfade, its visibility flipping after the fade so the hidden canvas takes no pointer events,
 * and the hidden 2D view remains the capture and export engine. The outer wrapper is the restore
 * fade (`hidden`): it fades whichever view is visible, since the other is already at opacity 0. The
 * hide carries no transition, landing in the frame of the restore it covers; the release animates.
 */
export function MapViews({ hidden = false }: { hidden?: boolean }) {
  const viewMode = useEditorStore((s) => s.viewMode);
  return (
    <div style={{ opacity: hidden ? 0 : 1, transition: hidden ? 'none' : cssMotion(VIEW_FADE, ['opacity']) }}>
      <div
        style={{
          opacity: viewMode === '3d' ? 0 : 1,
          visibility: viewMode === '3d' ? 'hidden' : undefined,
          transition: viewFade(viewMode !== '3d'),
        }}
      >
        <PixiCanvas reveal={framerMotion('canvas.reveal')} />
      </div>
      <Editor3DCanvas fade={viewFade} />
    </div>
  );
}
