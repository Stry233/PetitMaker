import { useNotesToolbar } from './annotation/AnnotationBar';
import { useTerrainToolbar } from './terrain/TerrainBar';
import type { ContentType } from '../../../state/editing/edit-mode';
import { ToolbarHost } from './toolbar-morph';

/**
 * One host for every editing toolbar, kept mounted across terrain surfaces and Notes, so a
 * control two bars both offer is the same node before and after the switch. Both bars' slots are
 * built on every render; only the active one is drawn.
 */
export function EditToolbar({ bar }: { bar: ContentType | 'notes' }) {
  const terrain = useTerrainToolbar(bar === 'notes' ? 'mountain' : bar);
  const notes = useNotesToolbar();
  return <ToolbarHost spec={bar === 'notes' ? notes : terrain}/>;
}
