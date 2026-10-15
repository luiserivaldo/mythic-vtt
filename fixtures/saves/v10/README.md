# Save v10 - initiative scores

Save v10 adds two optional initiative fields (UX-38, UI-TOOL-05): `Initiative.values`, a score
per listed combatant (finite, at most 9999 either way, decimals allowed for tie-breaks), and
`Initiative.ascending` (absent means highest first). The pure v9-to-v10 migration only bumps
`schemaVersion`; an unscored v9 initiative keeps its order. v1-v9 fixtures remain unchanged.

This synthetic fixture is the v9 fixture with a score on both combatants.

Matching host and client use protocol v11.
