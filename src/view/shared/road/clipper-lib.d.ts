declare module 'clipper-lib' {
  namespace ClipperLib {
    interface IntPoint { X: number; Y: number }
    type Paths = IntPoint[][];
    class PolyNode {
      Contour(): IntPoint[];
      Childs(): PolyNode[];
      IsHole(): boolean;
    }
    class PolyTree extends PolyNode {}
    const JoinType: { jtSquare: number };
    const EndType: { etClosedPolygon: number };
    const PolyType: { ptSubject: number; ptClip: number };
    const ClipType: { ctDifference: number; ctIntersection: number };
    const PolyFillType: { pftNonZero: number };
    class ClipperOffset {
      AddPaths(paths: Paths, join: number, end: number): void;
      Execute(solution: Paths, delta: number): void;
    }
    class Clipper {
      AddPaths(paths: Paths, type: number, closed: boolean): boolean;
      Execute(type: number, result: PolyTree | Paths, subjectFill: number, clipFill: number): boolean;
    }
  }
  export = ClipperLib;
}
