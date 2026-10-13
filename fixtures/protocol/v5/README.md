# Protocol v5 join profile colour (UX-31)

Deploy matching host and client versions together. Protocol v4 clients receive the
fatal `protocol-mismatch` response with `supportedVersion: 5`. The save schema
stays v4: connection colours are ephemeral metadata, not campaign state or actions.

Optional `hello.color`, presence seat/unseated colours and `ruler.preview.data.color`
accept six-digit hex colours. Legacy browser profiles without a colour stay valid.
The host uses the authenticated connection's colour for ruler/cursor previews,
overriding any submitted preview colour. Presence retains its host-only audience.
No identity secret or connection address is added to outbound presence/previews.

`join-profile.json` contains synthetic client and server codec fixtures. Keep older
fixtures, including v2 presence, as compatibility coverage. This branch's protocol
v5 allocation must be reconciled with other contract PRs before merge if develop
advances again.
