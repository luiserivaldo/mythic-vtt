# MV-166 / M4-24 pin contract

State/save and protocol v4 tighten PinComponent to strict text (1..4096) and reveal
hover, click, or nonnegative proximity. Deploy host and client together.

Owner decision (2026-10-11): hover/click text travels immediately with a visible
entity. Player/spectator views omit the entire proximity component until an
explicit host-authorized reveal exists. Co-DMs may read canonical proximity text
under existing entity visibility rules. Hidden entities remain hidden.

The v3→v4 migration covers split scenes, campaign prefab blueprints and nested
snapshot state. Oversized text is clamped; invalid/empty pins have no active
component. Any changed original is preserved as optional Entity.legacyPin.
This backup is host-only, including in prefabs. Older migrations and fixtures
are retained. Unversioned entity.create/update log pins are normalized before
normal reducer replay; live entity.update pin/legacyPin writes are rejected by
permissions, including for the host. Use pin.create/update/remove instead.

This golden scene contains click and proximity pins and a lossless archive.
No coordinate or action-envelope change; no runtime dependency.
