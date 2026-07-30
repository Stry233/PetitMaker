import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { Shot3dStrip } from '../../ui/chrome/export/Shot3dStrip';
import { I18nProvider } from '../../i18n/context';
import { useEditorStore } from '../../state/store';
import { makeState } from '../rules/_helpers';
import type { CameraAngle } from '../../canvas/map3d/capture';

const A = (az: number): CameraAngle => ({ az, el: 40, dist: 0.9 });

function setShots(n: number) {
  useEditorStore.setState({
    gridState: makeState(30, 30),
    export3dShots: Array.from({ length: n }, (_, i) => A(i * 40)),
    preview3DEdit: null,
    preview3DOpen: false,
  });
}

function renderStrip() {
  return render(<I18nProvider><Shot3dStrip open /></I18nProvider>);
}

describe('Shot3dStrip', () => {
  beforeEach(() => { MotionGlobalConfig.skipAnimations = true; });
  afterEach(() => { MotionGlobalConfig.skipAnimations = false; });

  it('renders one block per shot plus an Add tile below the max', () => {
    setShots(3);
    renderStrip();
    expect(screen.getAllByTitle('Click to set the camera angle')).toHaveLength(3);
    expect(screen.getByLabelText('Add shot')).toBeTruthy();
    expect(screen.getAllByLabelText('Remove shot')).toHaveLength(3);
  });

  it('hides the Add tile at 5 shots', () => {
    setShots(5);
    renderStrip();
    expect(screen.getAllByTitle('Click to set the camera angle')).toHaveLength(5);
    expect(screen.queryByLabelText('Add shot')).toBeNull();
  });

  it('hides the delete control at 1 shot (the floor)', () => {
    setShots(1);
    renderStrip();
    expect(screen.queryByLabelText('Remove shot')).toBeNull();
  });

  it('clicking a block requests the Preview3D angle editor for that index', () => {
    setShots(3);
    renderStrip();
    fireEvent.click(screen.getAllByTitle('Click to set the camera angle')[1]!);
    const st = useEditorStore.getState();
    expect(st.preview3DOpen).toBe(true);
    expect(st.preview3DEdit?.index).toBe(1);
  });

  it('Add appends a shot; delete removes one', () => {
    setShots(3);
    renderStrip();
    fireEvent.click(screen.getByLabelText('Add shot'));
    expect(useEditorStore.getState().export3dShots).toHaveLength(4);
    fireEvent.click(screen.getAllByLabelText('Remove shot')[0]!);
    expect(useEditorStore.getState().export3dShots).toHaveLength(3);
  });
});
