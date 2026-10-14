# Save v7 - seat archive

Save v7 adds optional `Seat.archived` (absent means active) and host-only
`seat.archive`. The pure v6-to-v7 migration preserves seats, login history,
interaction settings, quick fields, lasting AoEs and nested snapshots.
PR #56 supplies the preceding v5-to-v6 lasting-AoE migration; v1-v6 fixtures
remain unchanged.

This synthetic fixture retains lasting-AoE provenance and quick fields while
archiving Mira's seat, retaining its login and handing back its token ownership.
Archived seats cannot join, act or own entities. Undo and history rollback
restore entities while removing archived owners and preserving active co-owners.
The normalization runs inside the shared action reducers, including log replay.

Matching host and client use protocol v8. Archived records remain host-only
across snapshots, patches, history, reconnects, HTTP authentication and invites.
