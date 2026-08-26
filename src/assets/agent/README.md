# The one-character system's art

`base.png` (the character body) and its two PNG badges (`badge-idea.png`, `badge-ask.png`) are extracted layers of the project's design source, pulled by hand for this character rather than through the interface frame's own art extractor (that extractor's shape-layer/painted-layer split is built for the frame's PSD, not this one).

The other six badges the character wears (refresh, zzz, pause, exclaim, spark, note) are drawn as SVG rather than shipped as art, transcribed from the normative prototype's `SVG_BADGES` table — see `src/ui/agent/character/badges.tsx`. `refresh` was pulled as a PNG at first and retired: the prototype draws it, and the layer that was pulled is a two-arrow sync mark rather than the single arc the design has.

Resolved to URLs by `agent-art.ts` beside this file, the same `import.meta.glob` pattern as `src/assets/cursors/cursor-art.ts` and `src/assets/icon-urls.ts`.
