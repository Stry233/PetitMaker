// Register only the renderers used by the editor; asset loaders and worker plugins are excluded.
import '@pixi/mixin-cache-as-bitmap';
import '@pixi/mixin-get-child-by-name';
import '@pixi/mixin-get-global-position';
import '@pixi/canvas-display';
import '@pixi/canvas-text';
export { Application } from '@pixi/app';
export * from '@pixi/core';
export * from '@pixi/display';
export * from '@pixi/graphics';
export * from '@pixi/sprite';
export * from '@pixi/text';
export * from '@pixi/extract';
export * from '@pixi/events';
export * from '@pixi/canvas-extract';
export * from '@pixi/canvas-graphics';
export * from '@pixi/canvas-renderer';
export * from '@pixi/canvas-sprite';
