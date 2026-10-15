# Save v11 - permission templates and per-seat tools

Save v11 (UX-46, MV-251) removes the table-wide and per-scene player permissions. The 0.0.1
`Scene.playerToggles` (`measure`, `draw`, `pins`) is gone; each seat now has its own optional
`Seat.tools` (`{ measure, draw, pins }`, all booleans). A seat without `tools` uses the Player
template's (`measure` on, `draw` and `pins` off, the old scene defaults). New seats copy their
template's tools once; the DM then overrides each seat in the Seats tab.

The v10-to-v11 migration folds the old scene toggles into every seat: when the scenes players can
be in agree, each seat keeps exactly what it had; when they disagree, the seat gets the stricter
value. Snapshots fold themselves; campaign and scene files are folded by the store when it loads or
imports a pre-v11 campaign, because seats and scenes live in different files. v1-v10 fixtures
remain unchanged.

This synthetic fixture is the v10 fixture with explicit tools on both seats (the archived player
seat has Measure off and Draw and Place pins on).

Matching host and client use protocol v11 (unchanged: no message schema changed).
