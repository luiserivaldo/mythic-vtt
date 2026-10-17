# Save v12 - vision contract (walls, doors, sight blocking, fog regions)

Save v12 (FOG-01, MV-295; `TECHNICAL.md` D47 as amended by the MV-303 owner decisions) adds the
vision data for fog of war. Every field is optional, so the v11-to-v12 migration is the identity
(only a snapshot's `schemaVersion` changes). The bump exists so that an older host refuses a v12
save instead of loading it and sending secret doors and DM fog regions to players unfiltered.

- `Entity.wall { points, door? { state: 'open' | 'closed' | 'locked', secret? } }`: 2-64 points
  in the entity's local XZ frame (a door has exactly 2), on the `map` layer, with no other
  components and never `perms.view: false`.
- `Entity.blocksSight: true`: only on a `shape` or `model` prop, never on the `dm` layer.
- `Entity.fogRegion { points, hidden }`: a 3-64 point simple polygon on the `dm` layer, with no
  other components (DM fog regions; filtering is FOG-03).
- `Scene.vision { dynamicLighting }`: absent means off.
- `SeatTools.doors` (optional, absent = off): may this player seat open and close ordinary doors.

This synthetic fixture is the v11 fixture plus: a three-point wall, a closed door, a locked door,
a closed secret door (rotated 90 degrees), the Altar box marked `blocksSight`, a hidden fog region
on the dm layer, `vision: { dynamicLighting: true }` on the scene, and `doors: true` on the
archived player seat (the Co-DM seat has no `doors` key). v1-v11 fixtures remain unchanged.

Matching host and client use protocol v11 (unchanged: no message schema changed).
