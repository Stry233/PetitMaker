/*
 * ui-preview.tsx — the one flag that says "this interface subtree is a PICTURE of itself".
 *
 * The Help Center mounts real chrome as its figures, so a change to the interface changes its own
 * documentation. A pictured subtree must render exactly what the live one renders and DO nothing:
 * effectful chrome consults this context and holds still — a timed button's fuse does not burn, a
 * global listener is not attached, and the shell skips the surfaces that exist to act (its windows,
 * the tour, the first-launch offers).
 *
 * A picture may also be POSED: laid out for a window of the figure's choosing rather than the live
 * one (`useViewportSize` consults the pose, so every fit and plan downstream agrees), and holding a
 * mode armed so the surfaces that only exist under one — the bottom toolbar, the selected icon's
 * name — are in the picture whatever the live editor is doing.
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { BuildMode } from '../../core/model/edit-mode';

export interface UiPreviewPose {
  /** The window the pictured shell lays itself out for, instead of the live one. */
  viewport?: { w: number; h: number };
  /** The mode the picture holds armed. Absent means at rest, whatever the live editor holds. */
  mode?: BuildMode;
  /** The size the layer control opens at in the picture; absent means collapsed, as live. */
  layerPanel?: 'pill' | 'column' | 'grid';
  /** The assistant panel's past-jobs list stands open in the picture; absent means collapsed, as live. */
  historyOpen?: boolean;
}

const UiPreviewContext = createContext<UiPreviewPose | null>(null);

// One shared rest pose: a fresh object per render would re-render the whole pictured subtree.
const AT_REST: UiPreviewPose = {};

export function UiPreviewProvider({ pose, children }: { pose?: UiPreviewPose; children: ReactNode }) {
  return <UiPreviewContext.Provider value={pose ?? AT_REST}>{children}</UiPreviewContext.Provider>;
}

/** True inside a pictured subtree: render as always, act never. */
export function useUiPreview(): boolean {
  return useContext(UiPreviewContext) !== null;
}

/** The picture's pose, or null in the live interface. */
export function useUiPreviewPose(): UiPreviewPose | null {
  return useContext(UiPreviewContext);
}
