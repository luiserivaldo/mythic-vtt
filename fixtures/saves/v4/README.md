# UX-04 scene lifecycle (MV-223 / T14)

State/save schema v3 adds `Scene.dmOnly` (absent means public). The v2-to-v3
migration preserves data and marks existing scenes public. Empty snapshots get
one blank active scene; the host performs and persists the same repair for empty
split-file saves. The bootstrap scene uses the campaign ULID in the separate
scene dictionary, so repeated migration is deterministic. New campaigns persist
one blank active scene. Creating the first public scene while the pristine blank
bootstrap is active preserves the original first-scene activation workflow.

`Campaign.activeSceneId` is the players' shared scene. DM/co-DM browsing is local
client state and never changes it. Only the DM activates public scenes; private
scenes cannot become player-active. The host excludes private scenes and their
IDs, names and counts from player/spectator snapshots and patches. Co-DMs can
view them; ordinary seats cannot submit actions targeting them.

`scene.create` accepts `dmOnly`; `scene.delete` is DM-only and rejects the last
scene. Deleting the player-active scene sets `activeSceneId` to null without a
fallback. Existing players get an empty board and empty scene name. New joins
and returning players get a clear no-active-scene message; seat claims are
blocked until the DM activates a public scene. Deletion checkpoints prune stale
split scene files after the authoritative snapshot is written.

Deploy client and host together. Protocol v3 rejects older peers because campaign
snapshots use state v3. Version 2 is reserved by PR #32's presence latency change;
when integrating both PRs, retain protocol v3 and that PR's latency field. Saves
from v1 and v2 remain supported through the migration chain. No coordinate or
action-envelope change is made.
