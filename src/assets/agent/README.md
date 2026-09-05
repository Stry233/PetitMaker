# Assistant character art

`base.png` contains the character body. `badge-idea.png` and `badge-ask.png` contain the two raster badges, all extracted from the project's design source.

The refresh, sleep, pause, error, confirmation, and note badges are inline SVG drawings in `src/ui/agent/character/badges.tsx`.

`agent-art.ts` resolves the raster files to URLs with the same `import.meta.glob` pattern used by the other asset resolvers.
