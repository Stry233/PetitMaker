
// The camera pose of each view as the editor hands it between views, sessions and the next
// installed map. A save writes the same fields through its own wire shape (`PersistedCamera`).

/** The 2D viewport's pan offset and zoom, as the viewport reports them. */
export interface View2dCamera { x: number; y: number; zoom: number }

/** A pose for either view, each optional. */
export interface ViewCameras { view2d?: View2dCamera; view3d?: CameraAngle }

/** A saved 3D camera pose: azimuth and elevation in degrees, distance as a multiple of the scene's
 *  base distance, and the orbit target's X/Z offset from the scene centre. */
export interface CameraAngle { az: number; el: number; dist: number; tx?: number; tz?: number }
