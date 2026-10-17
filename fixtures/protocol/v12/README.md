# Protocol v12 - spectator intent on hello

Protocol v12 (D46, MV-280): `hello` may carry `as: 'spectator'`, so the host marks the connection
a declared spectator before its first presence frame and the DM roster never lists it as unseated.
`as` excludes `hostToken`. A v11 peer would reject the field, so v11 and earlier peers are rejected
during hello. `spectator-hello.json` holds synthetic frames: a spectator hello, a plain v12 hello
and the presence frame the DM then receives. Older fixtures remain unchanged.
