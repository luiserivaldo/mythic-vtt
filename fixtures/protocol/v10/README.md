# Protocol v10 - join flow

Protocol v10 follows the accepted v9 initiative contract and save v9. It adds:

- `join.as` (`temporary` | `spectator`) and `join.label` for the revised join screen
  (UI-JOIN-01). A temporary seat is session-only; a spectator is only counted by the host.
- The pre-join `GET /api/join` response (`JoinPayload`), the only data a visitor receives before
  they connect. It is strict: it names no identity, token, permission or spectator count.
- `presence.spectators` now counts spectator connections (watch links and "Join As Spectator"),
  and spectators are no longer listed in `presence.unseated`.

`join-flow.json` holds synthetic frames and a sample payload. v9 and earlier peers are rejected
during hello. Older fixtures remain unchanged.
