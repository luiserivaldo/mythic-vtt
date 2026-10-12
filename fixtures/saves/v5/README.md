# UX-03 seat archive (MV-191)

Save schema v5 adds optional `Seat.archived` (absent means active) and the
host-only `seat.archive` action. The pure v4-to-v5 migration preserves seats,
login history and `interactionEnabled`, including nested snapshot state.
The accepted v3-to-v4 interaction migration and v1-v4 fixtures are unchanged.
This fixture includes an archived seat with interaction disabled.

Matched protocol v6 follows develop protocol v5 (join profile colour and seat
invites). Archived records never enter non-host snapshots or patches. Archive
removes entity ownership without deleting tokens or character links.
