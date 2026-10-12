# Lasting AoEs

Open the Ruler tool, expand Measurement shapes, and choose an AoE shape. Measure it on the canvas, then click **Place AoE**. It becomes a lasting object owned by your seat. Your next measured template replaces only your measuring AoE. Lasting objects remain visible in 2D and 3D and survive reconnection and saving until deleted.

The default limit is one lasting AoE per placing identity in each scene. Changing seats or transferring ownership does not reset that count. In the Ruler panel the DM/co-DM can set **Lasting AoE limit per player** to 0–50; 0 prevents new player placement. Lowering the limit preserves existing objects. The DM and co-DMs are uncapped, and the DM can remove any AoE. Editing and deletion still follow existing entity permissions and layer locks.

The existing seat `interactionEnabled` flag gates measurement and placement. The scene Measure toggle also gates player measurement and lasting placement. There is no additional seat toggle.

## Contract and migration

Candidate save schema v5 adds optional `Entity.measuringAoE: true`, `Entity.lastingAoE: { creatorIdentityId?: Id }`, and `Scene.maxLastingAoEsPerPlayer` (integer 0–50, default 1). The host writes immutable authenticated placement provenance; other viewers receive only an empty lasting marker. Provenance follows the placer across seat rebinding. Snapshots, patches, prefab views and reconnect replay are filtered before transmission.

`aoe.persist { sceneId, sourceId, entityId }` consumes the caller's identity-bound measuring template and creates a distinct lasting object. The host supplies ownership and creator identity, rejects occupied destinations and enforces the scene cap. `aoe.place` rejects client-supplied lifetime markers and cannot overwrite lasting objects. Generic entity edits cannot change either marker. Prefab AoE copies clear source provenance and record their own placing actor.

The pure v4-to-v5 migration defaults scene caps, including nested session snapshots, and preserves existing entities, IDs, ownership and components. It does not guess lifetime metadata for legacy objects. All older golden fixtures remain.

Candidate wire version v6 reserves v5 for the pending MV-217 / PR #46 join-profile contract. The host rejects older versions explicitly. This PR stays draft behind that contract review and must merge the accepted develop contract and reconcile version allocation before review.
