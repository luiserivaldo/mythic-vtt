# Save schema v5 — lasting AoEs

`Entity.lastingAoE` marks a lasting object and records immutable `creatorIdentityId` on the host. Non-host views omit that identity except for the placing identity's current seat. `Entity.measuringAoE: true` identifies an authenticated one-per-identity template. Both markers are protected from generic edits. The host/placer sees provenance; other viewers still see the lasting object.

`Scene.maxLastingAoEsPerPlayer` defaults to 1 and accepts 0–50. It limits each placing identity in that scene, including after seat or ownership changes. Host/co-DM placement is uncapped. Existing admin ownership/permission controls still apply.

The pure v4-to-v5 migration defaults scene caps, including nested snapshots, without changing old entities, ownership or IDs. Historical v1–v4 fixtures remain. Prefab placement clears template provenance and records its own placing actor for AoE copies.
