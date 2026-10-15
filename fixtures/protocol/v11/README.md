# Protocol v11 - initiative scores

Protocol v11 follows save v10 (UX-38): an `initiative` value in an `initiative.set` intent, a
snapshot or a patch may now carry `values` (a score per listed combatant) and `ascending`. A v10
peer would reject those fields, so v10 and earlier peers are rejected during hello.
`initiative-scores.json` holds synthetic frames. Older fixtures remain unchanged.
