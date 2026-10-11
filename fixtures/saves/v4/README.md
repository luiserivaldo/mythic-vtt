# UX-03 seat archive (MV-191)

State/save and protocol v4 add optional `Seat.archived` and host-only `seat.archive`.
Absent means active; existing seats and nested snapshot history migrate without
loss. Archive retains login history and entities, removes seat ownership, denies
joins/assignments/stale actions, and excludes archived records from non-host views.
Old fixture versions remain unchanged.

PR #43 also proposes v4 independently. Before the second schema PR merges, update
it from develop, retain the merged migration unchanged, and advance its own schema,
protocol and golden fixture to the next version. Do not reuse a released version.
