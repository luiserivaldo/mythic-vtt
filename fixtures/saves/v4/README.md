# UX-02 seat interaction (MV-190)

State/save schema v4 adds optional Seat.interactionEnabled (absent means enabled).
The v3-to-v4 migration defaults existing seats on in campaign files and nested
snapshots, preserving explicit false and all other data. This fixture retains
scene lifecycle v3 data and demonstrates explicit enabled seats.

Protocol v4 requires matching host and client. Action envelopes and coordinates
are unchanged. Older fixture versions remain supported through the migration chain.
