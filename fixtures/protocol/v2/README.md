# Protocol v2 presence (UX-06)

Deploy the host and client together: v1 peers are rejected by the version handshake.
Save files and game actions are unchanged.

Each presence seat includes `latencyMs`, an integer from 0 to 30,000 or `null`.
The host measures round-trip time with WebSocket control-frame ping/pong and a
monotonic clock. A sample must match the outstanding random challenge. The first
probe follows authentication; subsequent probes use the heartbeat interval
(30 seconds by default). Disabling the heartbeat also disables measurement.

Latency-only presence updates are coalesced to at most one per second. Roster
changes publish immediately. An offline seat has `connected: false` and
`latencyMs: null`; an online seat has `null` until measured. If an identity has
multiple connections, the first live connection supplies its display name and RTT.

Presence remains host-only under D39/PERM-03. It contains no socket addresses,
identity secrets, or ping challenges. RTT is ephemeral and never enters campaign
state, saves, or the action log. `presence.json` is the synthetic golden fixture.
