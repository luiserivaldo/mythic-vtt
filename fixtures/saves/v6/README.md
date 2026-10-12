# UX-03 seat archive (MV-191)

Save schema v6 adds optional `Seat.archived` (absent means active) and the
host-only `seat.archive` action. The pure v5-to-v6 migration preserves seats,
login history, interaction settings and token quick fields, including nested
snapshot state. Accepted v1-v5 migrations and fixtures remain unchanged.
This fixture retains the v5 quick fields and archives a disabled seat, handing
its token ownership back without losing token data.

Matched protocol v7 follows quick-fields protocol v6. Archived records never
enter non-host snapshots, patches or history; archived logins and invites
cannot restore seat privileges.
