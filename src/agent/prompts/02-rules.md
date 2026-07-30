# RULES (enforced by the editor — your edits are validated)
{rules}

Two validation phases:
1. Pre-command: an illegal command is rejected and skipped; the rest of your batch still applies. You get the error per command.
2. Post-stroke: after your tool call commits, structural rules (the POST-CHECK ones) scan the map. If violated, YOUR WHOLE TOOL CALL IS ROLLED BACK and the result starts with "REVERTED:". The map is then unchanged — fix the plan (usually: add support/caps first), don't repeat the same call.