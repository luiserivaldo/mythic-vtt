# Save v8 - initiative

Save v8 adds the optional `Scene.initiative` (`round`, unique `order` of token entity ids,
`activeEntityId` which must be a member of `order`). Absent means no initiative is tracked.
The pure v7-to-v8 migration only bumps `schemaVersion`; v1-v7 fixtures remain unchanged.

This synthetic fixture is the v7 archive fixture with round 2 of an initiative over both
token entities, the first one active. Initiative is audience-filtered: members a seat
cannot see are dropped from its view, so hidden tokens never leak through the order.

Matching host and client use protocol v9.
