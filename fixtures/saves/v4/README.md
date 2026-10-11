# M4-20 chat and dice contract (MV-162)

State/save schema v4 adds optional Campaign.chat scrollback. The v3-to-v4 migration
preserves all old fields and updates nested snapshot campaign versions. This fixture
retains the v3 scene data and adds public text plus a DM-only roll; log.jsonl includes
the roll result and its host RNG proof. Older v1-v3 fixtures remain unchanged.

Protocol v4 requires matching host/client schema support. See docs/chat-contract.md
for audience rules, bounded scrollback and the internal dice.record logging boundary.
