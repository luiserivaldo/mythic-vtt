# Protocol v8 - seat archive

Seat archive follows PR #56's protocol v7 lasting-AoE contract and save v6.
Matching peers use protocol v8 and save v7; v7 and earlier peers are rejected
during hello. The synthetic fixture includes a v8 handshake, seat.archive
intent and existing profile colour/presence frames. Historical fixtures remain
available for codec compatibility and handshake rejection tests.
