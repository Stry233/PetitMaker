/*
 * The one flag that says "this interface subtree is a PICTURE of itself".
 *
 * The Help Center mounts real chrome as its figures, so a change to the interface changes its own
 * documentation. A pictured subtree must render exactly what the live one renders and do nothing:
 * effectful chrome consults this context and holds still — a timed button's fuse does not burn, a
 * global listener is not attached, and the shell skips the surfaces that exist to act (its windows,
 * the tour, the first-launch offers).
 *
 * A picture may also be posed: laid out for a window of the figure's choosing rather than the live
 * one (`useViewportSize` consults the pose, so every fit and plan downstream agrees), and holding a
 * mode armed so the surfaces that only exist under one — the bottom toolbar, the selected icon's
 * name — are in the picture whatever the live editor is doing.
 */
import type { BuildShape, ObjectBrush, RegionTool } from '../../state/editing/vocabulary';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { BuildMode } from '../../state/editing/edit-mode';

export interface UiPreviewPose {
  /** The window the pictured shell lays itself out for, instead of the live one. */
  viewport?: { w: number; h: number };
  /** The UI zoom the pictured subtree lays out at; absent, `ui-zoom-anim.ts:PICTURED_UI_ZOOM`. */
  uiZoom?: number;
  /** The mode the picture holds armed. Absent means at rest, whatever the live editor holds. */
  mode?: BuildMode;
  /** The size the layer control opens at in the picture; absent means collapsed, as live. */
  layerPanel?: 'pill' | 'column' | 'grid';
  /** The assistant panel's past-jobs list stands open in the picture; absent means collapsed, as live. */
  historyOpen?: boolean;
  /** The Notes row's eye and lock as the picture shows them; its presses then change nothing. */
  notesRow?: { visible: boolean; locked: boolean };
  /** The object shelf's brush bar standing open in the picture, with the way, shape and spacing it
   *  shows; absent means closed, as live. */
  objectBrush?: { brush: ObjectBrush; shape: BuildShape; spacing: number };
  /** The region screen standing in the bar's place in the picture over an empty region, with the tool
   *  it shows (its width and guides as the live store holds them); absent means not standing. */
  regionScreen?: { tool: RegionTool };
}

const UiPreviewContext = createContext<UiPreviewPose | null>(null);

// One shared rest pose: a fresh object per render would re-render the whole pictured subtree.
const AT_REST: UiPreviewPose = {};

/** A provider inside another poses on top of it: the facts it names win, the rest stand as the outer
 *  picture poses them. */
export function UiPreviewProvider({ pose, children }: { pose?: UiPreviewPose; children: ReactNode }) {
  const outer = useContext(UiPreviewContext);
  const value = useMemo(() => (outer && pose ? { ...outer, ...pose } : pose ?? outer ?? AT_REST), [outer, pose]);
  return <UiPreviewContext.Provider value={value}>{children}</UiPreviewContext.Provider>;
}

/** True inside a pictured subtree: render as always, act never. */
export function useUiPreview(): boolean {
  return useContext(UiPreviewContext) !== null;
}

/** The picture's pose, or null in the live interface. */
export function useUiPreviewPose(): UiPreviewPose | null {
  return useContext(UiPreviewContext);
}
