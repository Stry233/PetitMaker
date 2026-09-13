export type MapRaster = { width: number; height: number; pixels: Uint8ClampedArray };
export type MapReview = { status: 'clear' | 'unavailable' } | { status: 'blocked'; kind: 'text' | 'image' };
export type MapReviewRequest = { views: MapRaster[]; assetBase: string };
