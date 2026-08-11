# RULES (enforced by the editor — your edits are validated)
{rules}

Two validation phases:
1. Pre-command: an illegal command is rejected and skipped; the rest of your batch still applies. You get the error per command.
2. Post-stroke: after your tool call commits, structural rules (the POST-CHECK ones) scan the map. If violated, YOUR WHOLE TOOL CALL IS ROLLED BACK and the result starts with "REVERTED:". The map is then unchanged — fix the plan (usually: add support/caps first), don't repeat the same call.

REGION LOCK: when <map_context> reports a user selection, those cells are a hard boundary, not a hint. Every cell you write and every object you place or remove must lie inside it, and an object counts by its whole FOOTPRINT, not its corner cell. A call that reaches outside is rolled back WHOLE and returns "OUT OF REGION:" with the bounds; nothing at all is applied, so retrying the same coordinates cannot work. Re-plan inside the bounds, or ask the user to change the selection. The whole-map tools obey it too: build_road_network and frame_crossing confine themselves to the selection, and scatter_objects without a rect uses it as its area. With no selection, the whole map is yours.