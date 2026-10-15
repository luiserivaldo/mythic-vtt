# Save v9 - seat icons, campaign branding

Save v9 adds four optional fields: `Seat.icon` (a `glyph` of at most 8 characters, or an
`image` content hash), `Seat.temporary`, and `Campaign.icon` / `Campaign.screenshot` for the
join screen. The pure v8-to-v9 migration only bumps `schemaVersion`; v1-v8 fixtures remain
unchanged.

This synthetic fixture is the v8 fixture with a campaign icon and screenshot hash and an icon on
each seat. It deliberately holds **no** temporary seat: a temporary seat (`Seat.temporary`) is
session-only and the host never writes one to disk (`withoutTemporarySeats`).

Matching host and client use protocol v10.
