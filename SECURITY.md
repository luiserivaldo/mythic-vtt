# Security policy

Mythic VTT is pre-alpha software. Do not expose it to the public internet outside of a game session.

## Reporting a vulnerability

Please report security problems **privately** using GitHub's
[private vulnerability reporting](https://github.com/luiserivaldo/mythic-vtt/security/advisories/new)
(Security tab, then "Report a vulnerability"). Do not open a public issue for a vulnerability.

Include what you found, how to reproduce it and the version or commit you tested. Fixes are released
first, and the report is made public afterwards.

## What is in scope

Reports about the game host and client in this repository are welcome, in particular:

- **Hidden-information leaks.** Anything that lets a player or spectator receive data they may not see (for example DM-only layers).
- **Authority and permission bypasses.** Changing game state without going through the permission checks.
- **Authentication problems** with seat identities, the host link, or HTTP uploads and exports.
- **Unsafe handling of uploaded files** and saved campaigns.

## Supported versions

There are no tagged releases yet. Only the latest `develop` and `main` commits are supported.
