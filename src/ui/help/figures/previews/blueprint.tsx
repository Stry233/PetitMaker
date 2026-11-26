/*
 * The Blueprint library's figures: its explorer cut from the pictured shell in Blueprint mode,
 * holding the reader's own library, and the menus a blueprint and a folder open.
 */
import { useRef, type RefObject } from 'react';
import { useT } from '../../../../i18n/context';
import { EXAMPLES_FOLDER } from '../../../../io/blueprint/facts';
import { FloatMenu } from '../../../primitives/FloatMenu';
import { blueprintMenuItems, folderMenuItems } from '../../../shell/bars/blueprint/blueprint-asks';
import { FrameCut } from './frame-overview';
import { PreviewFrame } from './PreviewFrame';

const noop = () => {};

const CARDS = '[data-testid="blueprint-explorer-cards"] > *';
/** The folders down the explorer's side and the cards beside them, down to the last card. */
const EXPLORER = ['[data-testid="blueprint-explorer"] > div:first-child button', CARDS];
/** The details list's head and rows, its columns in view. */
const LIST = ['[data-blueprint-view] > :first-child', CARDS];
const GRID = { view: 'grid' } as const;
const LIST_VIEW = { view: 'list' } as const;

/** The strip unfolded into the explorer, in its grid. */
export function BlueprintExplorerPreview() {
  return <FrameCut corner="bar" mode="blueprint" blueprintExplorer={GRID} targets={EXPLORER} />;
}

/** The explorer in its details list. */
export function BlueprintListPreview() {
  return <FrameCut corner="bar" mode="blueprint" blueprintExplorer={LIST_VIEW} targets={LIST} />;
}

/** The explorer's head from New folder to the fold button, Export ringed. */
const HEAD = ['[data-testid="shell-blueprint-new-folder"]', '[data-testid="shell-blueprint-fold"]'];
const EXPORT = ['[data-testid="shell-blueprint-export"]'];

export function BlueprintExportPreview() {
  return <FrameCut corner="bar" mode="blueprint" blueprintExplorer={GRID} targets={HEAD} highlight={EXPORT} />;
}

/** A blueprint's menu beside the Examples folder's, each offering what the live one offers. */
export function BlueprintMenusPreview() {
  const t = useT();
  // Pictured, a menu stands in the figure's flow rather than hanging from its trigger.
  const anchor = useRef<HTMLElement>(null) as RefObject<HTMLElement>;
  return (
    <PreviewFrame height={240} fit width="max-content">
      <div style={{ display: 'flex', gap: 34, alignItems: 'flex-start' }}>
        <FloatMenu row={null} trigger={{ ref: anchor, align: 'start', onMap: true }} open onOpen={noop} onClose={noop}
          items={blueprintMenuItems(t, 1)} />
        <FloatMenu row={null} trigger={{ ref: anchor, align: 'start', onMap: true }} open onOpen={noop} onClose={noop}
          items={folderMenuItems(t, EXAMPLES_FOLDER)} />
      </div>
    </PreviewFrame>
  );
}
