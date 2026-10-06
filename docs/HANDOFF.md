# Orchestration hand-off

Snapshot: 2026-10-06 ~18:00 WIB. `develop` = the commit that contains this file. Last verified gate on `develop`:
800 unit tests and 25 e2e tests passing (`pnpm check` and `pnpm test:e2e`). Claude usage is exhausted, so all
development is halted. Nothing is in flight: every agent has finished and every finished branch is merged.

## Progress: 45 of 58 MVP tasks done

(Earlier messages said 70 tasks. The MVP is M0-M3 = 14 + 25 + 11 + 8 = 58 tasks.)

| Milestone  | Done                  | Remaining                                                                                            |
| ---------- | --------------------- | ---------------------------------------------------------------------------------------------------- |
| M0 (13/14) | 01-13                 | M0-14 exit test (needs nothing else now; write the restart-keeps-state e2e)                          |
| M1 (21/25) | 01-17, 19, 20, 22, 23 | 18 token drag and snap, 21 2D ruler, 24 load test, 25 playtest                                       |
| M2 (8/11)  | 01-07, 09             | 08 3D gizmo, 10 lighting and performance pass, 11 exit test and playtest                             |
| M3 (3/8)   | 01, 02, 03            | 04 AoE placement tool, 05 affected highlight, 06 3D ruler, 07 grid on elevated surfaces, 08 playtest |

Next up, all unblocked: M1-18 (token drag; also applies the platform surface height on drop via `dropElevation`),
M1-21 (ruler), M3-04, M3-05, M3-06, M3-07, M2-08, M2-10, then M0-14, M1-24, M2-11, M1-25, M3-08.

## What works today (checked by tests, plus one live test)

Host (`mythic-host`): game engine with per-audience filtering and reconnect replay, autosave and crash recovery,
join flow with seats, presence and ephemeral relay, host-only DM link with a single-use token, image upload,
campaign export and import (zip), authenticated HTTP routes, a one-command CLI that also serves the built client.
Client: connection with reconnect, join screen, DM panels (Scenes, Layers, Map, Seats, Entities), 2D board with a
finite scene canvas, pan and zoom, picking and selection, transform gizmo, image tokens with labels, battlemap
calibration, primitives, AoE volume rendering, a 2D/3D toggle with an orbit camera and standee tokens, drop lines,
skybox gradient, elevation controls and badge.

## Known gaps and risks

- **Almost nothing was verified by eye.** The user ran one live test (the first build had a host-flow crash, fixed in
  `1058475`). Agents looked at headless screenshots, but real mouse, trackpad and touch behaviour, gizmo feel,
  3D appearance, uploads with real images and multi-player sessions are unverified. Run a manual playtest first.
- Token dragging is not built (gizmo and typed values only), so there is no live drag preview yet.
- `seat.identityId` is included in every audience's snapshot and patches (PERM-03 gap, low severity: ids are not
  credentials). Redact it in `shared/visibility`.
- `pin.text` and `token.image` go to every audience that can see an entity; only names are label-gated (D35).
- `log.jsonl` lines carry no `schemaVersion`. There is no campaign or session id on the wire, so `lastSeq` alone
  could match the wrong campaign. Both are protocol/save-format decisions.
- Rate limits: HTTP has in-memory limits; engine intents have none yet (TECHNICAL §18).
- A single "connection rate limit per IP" is shared by a NAT'd table (D36).
- The e2e suite is load sensitive: with other heavy jobs running it flakes occasionally (upload rate-limit and
  other timing tests). Re-run before assuming a regression.

## Decisions

All recorded in `TECHNICAL.md` §20 (a local, gitignored file): D19-D39. Accepted by the user: D23 (props host
only), D24 and D33 (host authority; a fresh startup token rebinds the host), D25 (elevation snaps by default),
D26 (AoE centre inclusion), D27 (AGPL-3.0 + DCO), D32 (co-DM sees the DM layer read-only), D34 (server order
wins), D35 (names withheld), D37 (fixed scene canvas, default 40 x 30 cells), D38 (token colour), D39 (join flow
and presence roster). D29 is partly superseded by D33.

Proposed by agents but not yet written to the decision log (each is a small local choice; their final reports are
in the git history and agent logs): M2-02 primitive sizing and footprint rules; M2-06 standee proportions
(height 1.2x, width 0.9x footprint); M2-09 `environment.zenith`; M1-19 map-image maths; M1-20 gizmo snapping
(rotate 15 degrees, whole-unit scale when `grid.snap`); M1-09 archive layout and the "never overwrite an existing
campaign id" rule; D36 HTTP auth scheme (`Authorization: Mythic <identityId>.<secret>`, host and co-DM uploads,
host-only export/import); M2-03 step rules (`maxStepUp` 0.5 cells); M2-05 tween (250 ms); M3-03 ring sampling
(0.2 cells); M0-11 autosave interval (200 actions).

## Open questions for the user

1. A per-seat "DM-layer write" grant would be a `SeatPermissions` schema change (co-DMs currently get write
   access only per entity).
2. Should the internet guide keep recommending Tailscale Funnel? It contradicts the fleet rule in
   `Server_Architecture v2.md`.
3. Add a `role` flag (`host | seat | spectator`) to the snapshot to replace the client's localStorage host hint?
4. Free-control tables (everyone admin) under server-order-wins: explore in M1-24.

## How to resume

Worktrees live in `../mythic-vtt-worktrees/<name>` (many are finished and can be removed with `git worktree remove`
once their branch is merged, which all are). The branch for each task is `feature/<slug>`.

1. New worktree: `git worktree add ../mythic-vtt-worktrees/<name> -b feature/<slug> develop`, then symlink the
   gitignored docs from the main checkout (`AGENTS.md CLAUDE.md DESIGN.md TECHNICAL.md TASKS.md .claude`), then
   `pnpm install --frozen-lockfile && pnpm build`. `.claude` is excluded via `.git/info/exclude`.
2. Brief each agent with: the task row, the relevant decisions, "no attribution lines in commits", "run pnpm build,
   pnpm check and pnpm test:e2e", "use stable fallbacks in store selectors", and for UI work "take a headless
   screenshot and read it".
3. Merge gate (always): merge `develop` into the branch and resolve there; then in the main checkout
   `git merge --no-ff --no-commit feature/<slug>`, abort on conflict, run `pnpm build`, `pnpm check`,
   `pnpm test:e2e`, and commit only if all pass. Never leave a conflicted merge in the main checkout. Conflicts so far
   are the action registry (`registry.ts` and `index.ts`: keep both sides), `pnpm-lock.yaml` (take develop's, then
   `pnpm install --no-frozen-lockfile`), and shared render files (`BoardCanvas.tsx`, `PickableEntities.tsx`,
   `scene-model.ts`, `GridLines.tsx`, `DmPanels.tsx`).
4. The e2e suite is the real gate for client work. The first host-flow bug and the picking crash both passed all unit
   tests and were caught only in a browser.

Sandbox note: Claude's Bash sandbox can only write inside the main repo folder, so worktree work and `pnpm check`
need `dangerouslyDisableSandbox` (the sandbox puts unreadable placeholder dotfiles in the repo root, which breaks
prettier and ESLint). Running the commands from a normal terminal has no such limit.

## Codex and Hermes

- Codex CLI (0.157) is logged in. Slugs: `gpt-6-sol` for higher-risk work, `gpt-5.6-sol` for regular tasks, medium
  reasoning. Launch: `codex exec -m <slug> -c model_reasoning_effort=medium -s workspace-write --add-dir <repo>/.git -C <worktree> "<brief>"`.
  It stops when its quota runs out (resets about every 5 hours) and sometimes returns "model at capacity": retry.
  Its sandbox needs the gitignored docs symlinked into the worktree or it stalls asking for them.
- Hermes on `razer-debian` works (default model `nvidia/nemotron-3-ultra-550b-a55b`; `qwen/qwen3.8-27b:free` through
  OpenRouter is configured). Its launch with `--yolo` was blocked by the permission classifier; run it yourself or
  allow it explicitly. `luisepc-debian` is reachable over SSH and its Hermes answers, but its Ollama service is
  crash-looping (`systemctl status ollama`, `journalctl -u ollama`), so local Qwen3.8-27b is not available until that
  is fixed. Hermes suits low-difficulty, well-specified tasks: docs, fixtures, small actions that copy an existing
  pattern, test additions.

## Update 2026-10-06 ~19:45: alpha wave 1 stalled on Codex quota

Five Codex tasks were launched in parallel (about 480k tokens used) and the usage limit hit before any finished.
Partial, uncommitted work is saved in these worktrees (no commits, nothing merged, `develop` is unchanged at
`f474722`):

| Task                            | Worktree           | Notes                                                                              |
| ------------------------------- | ------------------ | ---------------------------------------------------------------------------------- |
| M1-18 token drag and snap       | `m1-18-token-drag` | highest priority; was wiring `sendEphemeral`/`onEphemeral` into the client context |
| M1-21 2D ruler                  | `m1-21-ruler-2d`   | adding a ruler ephemeral kind in packages/protocol (additive)                      |
| M3-04 AoE placement tool        | `m3-04-aoe-tool`   | had 17 lint errors left to fix                                                     |
| M2-08 3D gizmo                  | `m2-08-gizmo-3d`   |                                                                                    |
| M3-07 grid on elevated surfaces | `m3-07-grid-tops`  |                                                                                    |

Resume after the Codex reset (8:55 PM): run at most **two or three Codex agents at once**, in the order above, and tell
each to commit WIP early, then `git merge develop`, then run the gates once. Do not run five at a time: the docs
reading and parallel build/e2e runs use up a window before anything lands. After these, M3-05 (needs M3-04) and
M3-06 (needs M1-21), then M0-14, M1-24 and the alpha build.

## Update 2026-10-06 ~20:30: alpha candidate reached

`develop` = `dee3d01` and later docs commits. Merged since the previous update: M1-18 token drag, M1-21 2D ruler,
M2-08 3D gizmo, M3-04 AoE placement tool, M3-07 grid on elevated surfaces (the partial Codex work was finished by Claude
agents; nothing from the stalled Codex worktrees is still pending). Combined gate: 837 unit tests, 30 e2e tests.

**Progress: 50 of 58 MVP tasks done.** Remaining 8: M0-14 (exit test), M1-24 (load test), M1-25 (playtest), M2-10
(lighting and performance pass), M2-11 (exit test and playtest), M3-05 (AoE affected highlight), M3-06 (3D ruler),
M3-08 (final playtest). The sections above that list older "remaining" work are superseded by this one.

Alpha caveats (nothing below was verified by eye or on real devices): drag, ruler, AoE tool, gizmos, grid-on-tops and the
3D view are covered by unit tests and "mounts without page errors" e2e checks only; the 3D mesh renderer applies yaw only,
so a pitch or roll set with the 3D gizmo is stored but not drawn; AoE affected-token highlighting (M3-05) and the 3D
ruler (M3-06) are not built, so an AoE does not yet show who is inside it; ghosts for remote token drags fade 1.5 s after
the last preview (no "drag ended" message).
