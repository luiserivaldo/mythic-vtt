# UX-07 token quick fields (MV-195)

State/save schema v5 adds optional `token.quickFields` (a record of numeric fields, each with
a visibility of `all`, `owner` or `dm`). Absent means no quick fields, and the v4-to-v5 migration
never invents statistics: it only advances the version, including nested snapshots. This fixture
keeps the v4 seat interaction and scene lifecycle data and gives one token an `all` and an
`owner` field.

Protocol v5 requires matching host and client (new `token.setQuickField` intent, and a
per-viewer filtered `quickFields` in token views). Older fixture versions remain supported
through the migration chain.
